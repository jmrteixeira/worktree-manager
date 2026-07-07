import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Request, Response, NextFunction } from "express";
import {
  decodePathId,
  defaultWorktreeName,
  getBranches,
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
  app.use(cors());
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

      await runGit(repo.path, args, store);
      res.status(201).json({ path: targetPath });
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

      await runGit(repo.path, ["worktree", "remove", worktreePath], store);
      res.status(204).end();
    })
  );

  app.post(
    "/api/repos/:repoId/worktrees/move-local",
    withRepo(store, async (repo, req, res) => {
      res.json(
        await moveLocalBranchToWorktree(
          repo,
          {
            name: optionalBodyString(req.body, "name"),
            path: optionalBodyString(req.body, "path")
          },
          store
        )
      );
    })
  );

  app.post(
    "/api/repos/:repoId/worktrees/:worktreeId/handoff-local",
    withRepo(store, async (repo, req, res) => {
      const worktreePath = decodePathId(req.params.worktreeId);
      const focusedPath = await resolveRepoWorktreePath(repo.path, worktreePath, store);
      res.json(await handoffWorktreeBranchToLocal(repo.path, focusedPath, store));
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
      await runGit(focusedPath, ["branch", name, ...(from ? [from] : [])], store);
      res.status(201).json({ name });
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
      await runGit(focusedPath, ["switch", req.params.name], store);
      res.json({ branch: req.params.name });
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
      await runGit(focusedPath, ["branch", req.body?.force === true ? "-D" : "-d", name], store);
      res.status(204).end();
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
      await runGit(focusedPath, ["fetch", "--prune"], store);
      res.json({ ok: true });
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
      await runGit(focusedPath, ["pull", "--ff-only"], store);
      res.json({ ok: true });
    })
  );

  app.post(
    "/api/open",
    asyncHandler(async (req, res) => {
      const targetPath = requiredBodyString(req.body, "path");
      await openPath(targetPath);
      res.json({ ok: true });
    })
  );

  app.get(
    "/api/operations",
    asyncHandler(async (_req, res) => {
      res.json(await store.listOperations());
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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function openPath(targetPath: string): Promise<void> {
  const opener =
    process.platform === "darwin"
      ? { command: "open", args: [targetPath] }
      : process.platform === "win32"
        ? { command: "explorer.exe", args: [targetPath] }
        : { command: "xdg-open", args: [targetPath] };

  await new Promise<void>((resolve, reject) => {
    const child = spawn(opener.command, opener.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.on("error", reject);
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
