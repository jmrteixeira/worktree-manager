import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Request, Response, NextFunction } from "express";
import type { OpenTarget } from "../src/types";
import {
  decodePathId,
  defaultWorktreeName,
  getBranches,
  getRepoDetail,
  getRepoSummary,
  getWorktrees,
  GitCommandError,
  handoffWorktreeBranchToLocal,
  moveLocalBranchToWorktree,
  resolveRepoWorktreePath,
  runGit,
  sanitizeFilePart,
  validateRepository
} from "./git";
import { AppStore, createDefaultStore } from "./store";

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function createApp(store: AppStore = createDefaultStore()) {
  const app = express();
  const runExclusiveRepoTask = createRepoTaskQueue();

  app.disable("x-powered-by");
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || isAllowedOrigin(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error("Origem não permitida."));
      }
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.get(
    "/api/fs",
    asyncHandler(async (req, res) => {
      const requestedPath = stringQuery(req.query.path) || os.homedir();
      const directoryPath = path.resolve(requestedPath);
      const stat = await fs.stat(directoryPath);
      if (!stat.isDirectory()) {
        res.status(400).json({ error: "O caminho não é uma pasta." });
        return;
      }

      const entries = await fs.readdir(directoryPath, { withFileTypes: true });
      const directories = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            const entryPath = path.join(directoryPath, entry.name);
            return {
              name: entry.name,
              path: entryPath,
              isDirectory: true,
              isGitRepo: await pathExists(path.join(entryPath, ".git"))
            };
          })
      );

      res.json({
        path: directoryPath,
        parent: path.dirname(directoryPath) === directoryPath ? null : path.dirname(directoryPath),
        isGitRepo: await pathExists(path.join(directoryPath, ".git")),
        entries: directories.sort((a, b) => {
          if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
          return a.name.localeCompare(b.name);
        })
      });
    })
  );

  app.get(
    "/api/repos",
    asyncHandler(async (_req, res) => {
      res.json(await store.listRepos());
    })
  );

  app.post(
    "/api/repos",
    asyncHandler(async (req, res) => {
      const repoPath = requiredBodyString(req.body, "path");
      const topLevelPath = await validateRepository(repoPath, store);
      const repo = await store.upsertRepo(topLevelPath);
      res.status(201).json(repo);
    })
  );

  app.get(
    "/api/repos/:repoId/summary",
    withRepo(store, async (repo, req, res) => {
      const focusedPath = await resolveRepoWorktreePath(
        repo.path,
        stringQuery(req.query.worktreePath),
        store
      );
      res.json(await getRepoSummary(repo, focusedPath, store));
    })
  );

  app.get(
    "/api/repos/:repoId/worktrees",
    withRepo(store, async (repo, req, res) => {
      const focusedPath = await resolveRepoWorktreePath(
        repo.path,
        stringQuery(req.query.worktreePath),
        store
      );
      res.json(await getWorktrees(repo.path, focusedPath, store));
    })
  );

  app.get(
    "/api/repos/:repoId/detail",
    withRepo(store, async (repo, req, res) => {
      const focusedPath = await resolveRepoWorktreePath(
        repo.path,
        stringQuery(req.query.worktreePath),
        store
      );
      res.json(await getRepoDetail(repo, focusedPath, store));
    })
  );

  app.post(
    "/api/repos/:repoId/worktrees",
    withRepo(store, async (repo, req, res) => {
      const branch = requiredBodyString(req.body, "branch");
      const requestedPath = optionalBodyString(req.body, "path");
      const requestedName = optionalBodyString(req.body, "name");
      const targetPath = requestedPath
        ? path.resolve(requestedPath)
        : path.join(
            path.dirname(repo.path),
            requestedName ? sanitizeFilePart(requestedName) : defaultWorktreeName(repo.name, branch)
          );

      if (await pathExists(targetPath)) {
        res.status(409).json({ error: "Já existe uma pasta com esse nome.", detail: targetPath });
        return;
      }

      const args =
        req.body?.newBranch === true
          ? ["worktree", "add", "-b", branch, targetPath]
          : ["worktree", "add", targetPath, branch];

      await runExclusiveRepoTask(repo.id, async () => {
        await runGit(repo.path, args, store, { timeoutMs: 120_000 });
        res.status(201).json({ path: targetPath });
      });
    })
  );

  app.delete(
    "/api/repos/:repoId/worktrees/:worktreeId",
    withRepo(store, async (repo, req, res) => {
      const worktreePath = decodePathId(req.params.worktreeId);
      const confirmation = requiredBodyString(req.body, "confirm");
      const shortName = path.basename(worktreePath);
      if (confirmation !== shortName && confirmation !== worktreePath) {
        res.status(400).json({ error: `Escreve "${shortName}" para confirmar.` });
        return;
      }

      await runExclusiveRepoTask(repo.id, async () => {
        await runGit(repo.path, ["worktree", "remove", worktreePath], store, {
          timeoutMs: 120_000
        });
        res.status(204).end();
      });
    })
  );

  app.post(
    "/api/repos/:repoId/worktrees/move-local",
    withRepo(store, async (repo, req, res) => {
      res.json(
        await runExclusiveRepoTask(repo.id, () =>
          moveLocalBranchToWorktree(
            repo,
            {
              name: optionalBodyString(req.body, "name"),
              path: optionalBodyString(req.body, "path")
            },
            store
          )
        )
      );
    })
  );

  app.post(
    "/api/repos/:repoId/worktrees/:worktreeId/handoff-local",
    withRepo(store, async (repo, req, res) => {
      const worktreePath = decodePathId(req.params.worktreeId);
      const focusedPath = await resolveRepoWorktreePath(repo.path, worktreePath, store);
      res.json(
        await runExclusiveRepoTask(repo.id, () =>
          handoffWorktreeBranchToLocal(repo.path, focusedPath, store)
        )
      );
    })
  );

  app.get(
    "/api/repos/:repoId/branches",
    withRepo(store, async (repo, req, res) => {
      const focusedPath = await resolveRepoWorktreePath(
        repo.path,
        stringQuery(req.query.worktreePath),
        store
      );
      res.json(await getBranches(focusedPath, store));
    })
  );

  app.post(
    "/api/repos/:repoId/branches",
    withRepo(store, async (repo, req, res) => {
      const name = requiredBodyString(req.body, "name");
      const from = optionalBodyString(req.body, "from");
      const focusedPath = await resolveRepoWorktreePath(
        repo.path,
        optionalBodyString(req.body, "worktreePath"),
        store
      );
      await runExclusiveRepoTask(repo.id, async () => {
        await runGit(focusedPath, ["branch", name, ...(from ? [from] : [])], store);
        res.status(201).json({ name });
      });
    })
  );

  app.post(
    "/api/repos/:repoId/branches/:name/checkout",
    withRepo(store, async (repo, req, res) => {
      const focusedPath = await resolveRepoWorktreePath(
        repo.path,
        optionalBodyString(req.body, "worktreePath"),
        store
      );
      await runExclusiveRepoTask(repo.id, async () => {
        await runGit(focusedPath, ["switch", req.params.name], store);
        res.json({ branch: req.params.name });
      });
    })
  );

  app.delete(
    "/api/repos/:repoId/branches/:name",
    withRepo(store, async (repo, req, res) => {
      const name = req.params.name;
      const confirmation = requiredBodyString(req.body, "confirm");
      if (confirmation !== name) {
        res.status(400).json({ error: `Escreve "${name}" para confirmar.` });
        return;
      }

      const focusedPath = await resolveRepoWorktreePath(
        repo.path,
        optionalBodyString(req.body, "worktreePath"),
        store
      );
      await runExclusiveRepoTask(repo.id, async () => {
        await runGit(focusedPath, ["branch", req.body?.force === true ? "-D" : "-d", name], store);
        res.status(204).end();
      });
    })
  );

  app.post(
    "/api/repos/:repoId/fetch",
    withRepo(store, async (repo, req, res) => {
      const focusedPath = await resolveRepoWorktreePath(
        repo.path,
        optionalBodyString(req.body, "worktreePath"),
        store
      );
      await runExclusiveRepoTask(repo.id, async () => {
        await runGit(focusedPath, ["fetch", "--prune"], store, { timeoutMs: 120_000 });
        res.json({ ok: true });
      });
    })
  );

  app.post(
    "/api/repos/:repoId/pull",
    withRepo(store, async (repo, req, res) => {
      const focusedPath = await resolveRepoWorktreePath(
        repo.path,
        optionalBodyString(req.body, "worktreePath"),
        store
      );
      await runExclusiveRepoTask(repo.id, async () => {
        await runGit(focusedPath, ["pull", "--ff-only"], store, { timeoutMs: 120_000 });
        res.json({ ok: true });
      });
    })
  );

  app.post(
    "/api/open",
    asyncHandler(async (req, res) => {
      const targetPath = await validateOpenTarget(store, requiredBodyString(req.body, "path"));
      const target = openTargetFromBody(req.body);
      await openPath(targetPath, target);
      res.json({ ok: true, target });
    })
  );

  app.get(
    "/api/operations",
    asyncHandler(async (_req, res) => {
      res.json(await store.listOperations());
    })
  );

  app.get(
    "/api/operations/:operationId",
    asyncHandler(async (req, res) => {
      const operation = await store.getOperation(req.params.operationId);
      if (!operation) {
        res.status(404).json({ error: "Operação não encontrada." });
        return;
      }

      res.json(operation);
    })
  );

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof GitCommandError) {
      res.status(400).json({
        error: error.message,
        detail: error.result.stderr.trim() || error.result.stdout.trim()
      });
      return;
    }

    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: "Erro inesperado." });
  });

  return app;
}

function withRepo(
  store: AppStore,
  handler: (repo: Awaited<ReturnType<AppStore["getRepo"]>> & {}, req: Request, res: Response) => Promise<void>
) {
  return asyncHandler(async (req, res) => {
    const repo = await store.getRepo(req.params.repoId);
    if (!repo) {
      res.status(404).json({ error: "Repositório não encontrado." });
      return;
    }

    await handler(repo, req, res);
  });
}

function asyncHandler(route: AsyncRoute) {
  return (req: Request, res: Response, next: NextFunction) => {
    void route(req, res, next).catch(next);
  };
}

function stringQuery(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function requiredBodyString(body: unknown, key: string): string {
  const value = (body as Record<string, unknown> | null)?.[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Campo obrigatório em falta: ${key}.`);
  }

  return value.trim();
}

function optionalBodyString(body: unknown, key: string): string | null {
  const value = (body as Record<string, unknown> | null)?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function openTargetFromBody(body: unknown): OpenTarget {
  const value = (body as Record<string, unknown> | null)?.target;
  if (value === undefined || value === null || value === "") return "folder";
  if (value === "folder" || value === "editor" || value === "terminal") return value;
  throw new Error("Destino de abertura inválido.");
}

function createRepoTaskQueue() {
  const queues = new Map<string, Promise<void>>();

  return async function runExclusiveRepoTask<T>(repoId: string, task: () => Promise<T>): Promise<T> {
    const previous = queues.get(repoId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const normalized = run.then(
      () => undefined,
      () => undefined
    );

    queues.set(repoId, normalized);

    try {
      return await run;
    } finally {
      if (queues.get(repoId) === normalized) {
        queues.delete(repoId);
      }
    }
  };
}

export function isAllowedOrigin(origin: string): boolean {
  return getAllowedOrigins().has(origin);
}

function getAllowedOrigins(): Set<string> {
  const configured = process.env.WORKTREE_MANAGER_ALLOWED_ORIGINS;
  const values = configured
    ? configured.split(",")
    : ["http://localhost:5173", "http://127.0.0.1:5173"];

  return new Set(values.map((value) => value.trim()).filter(Boolean));
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function validateOpenTarget(store: AppStore, targetPath: string): Promise<string> {
  const resolvedTarget = path.resolve(targetPath);
  const target = await realExistingPath(resolvedTarget);
  const repos = await store.listRepos();

  for (const repo of repos) {
    const roots = new Set<string>([repo.path]);

    try {
      const worktrees = await getWorktrees(repo.path, repo.path, store);
      for (const worktree of worktrees) {
        if (worktree.path) roots.add(worktree.path);
      }
    } catch {
      roots.add(repo.path);
    }

    for (const root of roots) {
      const comparableRoot = await realPathOrResolved(root);
      if (isSameOrInside(target, comparableRoot)) {
        return target;
      }
    }
  }

  throw new Error("Só é possível abrir caminhos dentro de repositórios ou worktrees conhecidos.");
}

async function realExistingPath(targetPath: string): Promise<string> {
  try {
    return await fs.realpath(targetPath);
  } catch {
    throw new Error("O caminho indicado não existe.");
  }
}

async function realPathOrResolved(targetPath: string): Promise<string> {
  return fs.realpath(path.resolve(targetPath)).catch(() => path.resolve(targetPath));
}

function isSameOrInside(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative));
}

type OpenCommand = {
  command: string;
  args: string[];
};

async function openPath(targetPath: string, target: OpenTarget): Promise<void> {
  const opener = buildOpenCommand(targetPath, target);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(opener.command, opener.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: target !== "terminal"
    });
    child.on("error", reject);
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export function buildOpenCommand(
  targetPath: string,
  target: OpenTarget,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): OpenCommand {
  if (target === "folder") return folderOpenCommand(targetPath, platform);

  if (target === "editor") {
    const configured = env.WORKTREE_MANAGER_EDITOR?.trim();
    if (configured) return configuredOpenCommand(configured, targetPath);

    if (platform === "darwin") {
      return {
        command: "open",
        args: ["-a", env.WORKTREE_MANAGER_EDITOR_APP?.trim() || "Visual Studio Code", targetPath]
      };
    }

    return { command: platform === "win32" ? "code.cmd" : "code", args: [targetPath] };
  }

  const configured = env.WORKTREE_MANAGER_TERMINAL?.trim();
  if (configured) return configuredOpenCommand(configured, targetPath);

  if (platform === "darwin") {
    return { command: "open", args: ["-a", env.WORKTREE_MANAGER_TERMINAL_APP?.trim() || "Terminal", targetPath] };
  }

  if (platform === "win32") {
    return { command: "cmd.exe", args: ["/K", "cd", "/d", targetPath] };
  }

  return { command: "x-terminal-emulator", args: ["--working-directory", targetPath] };
}

function folderOpenCommand(targetPath: string, platform: NodeJS.Platform): OpenCommand {
  if (platform === "darwin") return { command: "open", args: [targetPath] };
  if (platform === "win32") return { command: "explorer.exe", args: [targetPath] };
  return { command: "xdg-open", args: [targetPath] };
}

function configuredOpenCommand(configured: string, targetPath: string): OpenCommand {
  const parts = splitCommand(configured);
  if (!parts.length) {
    throw new Error("Comando de abertura inválido.");
  }

  const replaced = parts.map((part) => part.replace(/\{path\}/g, targetPath));
  if (!parts.some((part) => part.includes("{path}"))) {
    replaced.push(targetPath);
  }

  return {
    command: replaced[0],
    args: replaced.slice(1)
  };
}

function splitCommand(value: string): string[] {
  const parts: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    parts.push(match[1] ?? match[2] ?? match[3]);
  }

  return parts;
}
