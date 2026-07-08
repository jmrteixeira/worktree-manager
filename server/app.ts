import cors from "cors";
import express from "express";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Request, Response, NextFunction } from "express";
import type {
  AppIntegrations,
  AppSettings,
  EditorIntegrationId,
  IntegrationCatalog,
  IntegrationRecord,
  OpenTarget,
  TerminalIntegrationId
} from "../src/types";
import {
  assertCleanWorktreeForSafeOperation,
  assertNoConflictsForSafeOperation,
  assertSafeBranchDeletion,
  checkoutBranch,
  createBranch,
  createWorktree,
  decodePathId,
  getBranches,
  getRepoDetail,
  getRepoSummary,
  getWorktrees,
  GitCommandError,
  handoffWorktreeBranchToLocal,
  moveLocalBranchToWorktree,
  resolveRepoWorktreePath,
  runGit,
  validateRepository
} from "./git";
import { diagnosticEventFromBody, getDiagnosticsSnapshot, recordDiagnosticEvent } from "./diagnostics";
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

  app.post(
    "/api/fs/pick-folder",
    asyncHandler(async (_req, res) => {
      const folderPath = await pickFolder();
      res.json(folderPath ? { path: folderPath } : null);
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
    "/api/settings",
    asyncHandler(async (_req, res) => {
      res.json(await store.getSettings());
    })
  );

  app.patch(
    "/api/settings",
    asyncHandler(async (req, res) => {
      res.json(await store.updateSettings(settingsFromBody(req.body)));
    })
  );

  app.get(
    "/api/integrations",
    asyncHandler(async (_req, res) => {
      res.json(await getIntegrationCatalog(await store.getSettings()));
    })
  );

  app.get(
    "/api/diagnostics",
    asyncHandler(async (_req, res) => {
      res.json(await getDiagnosticsSnapshot(store, "node"));
    })
  );

  app.post(
    "/api/diagnostics/events",
    asyncHandler(async (req, res) => {
      res.status(201).json(await recordDiagnosticEvent(store, diagnosticEventFromBody(req.body)));
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

      await runExclusiveRepoTask(repo.id, async () => {
        const settings = await store.getSettings();
        const targetPath = await createWorktree(
          repo,
          {
            branch,
            newBranch: req.body?.newBranch === true,
            name: optionalBodyString(req.body, "name"),
            path: optionalBodyString(req.body, "path"),
            basePath: settings.worktreeDirectory
          },
          store
        );
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
        const settings = await store.getSettings();
        const focusedPath = await resolveRepoWorktreePath(repo.path, worktreePath, store);
        if (settings.safeMode) {
          await assertCleanWorktreeForSafeOperation(focusedPath, "remover worktree", store);
        }
        await runGit(repo.path, ["worktree", "remove", focusedPath], store, {
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
        await runExclusiveRepoTask(repo.id, async () => {
          const settings = await store.getSettings();
          if (settings.safeMode) {
            await assertNoConflictsForSafeOperation(repo.path, "mover para worktree", store);
          }
          return moveLocalBranchToWorktree(
            repo,
            {
              name: optionalBodyString(req.body, "name"),
              path: optionalBodyString(req.body, "path"),
              basePath: settings.worktreeDirectory
            },
            store,
            { safeMode: settings.safeMode }
          );
        })
      );
    })
  );

  app.post(
    "/api/repos/:repoId/worktrees/:worktreeId/handoff-local",
    withRepo(store, async (repo, req, res) => {
      const worktreePath = decodePathId(req.params.worktreeId);
      const focusedPath = await resolveRepoWorktreePath(repo.path, worktreePath, store);
      res.json(
        await runExclusiveRepoTask(repo.id, async () => {
          const settings = await store.getSettings();
          if (settings.safeMode) {
            await assertNoConflictsForSafeOperation(focusedPath, "handoff para local", store);
            await assertNoConflictsForSafeOperation(repo.path, "handoff para local", store);
          }
          return handoffWorktreeBranchToLocal(repo.path, focusedPath, store);
        })
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
        const branchName = await createBranch(focusedPath, name, from, store);
        res.status(201).json({ name: branchName });
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
        const settings = await store.getSettings();
        if (settings.safeMode) {
          await assertCleanWorktreeForSafeOperation(focusedPath, "checkout de branch", store);
        }
        const branch = await checkoutBranch(repo.path, req.params.name, focusedPath, store);
        res.json({ branch });
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
        const settings = await store.getSettings();
        if (settings.safeMode) {
          await assertSafeBranchDeletion(repo.path, name, store);
        }
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
        const settings = await store.getSettings();
        if (settings.safeMode) {
          await assertCleanWorktreeForSafeOperation(focusedPath, "pull", store);
        }
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
      await openPath(targetPath, target, await store.getSettings());
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

function settingsFromBody(body: unknown): Partial<AppSettings> {
  const payload = body as Record<string, unknown> | null;
  const safeMode = payload?.safeMode;
  if (safeMode !== undefined && typeof safeMode !== "boolean") {
    throw new Error("Valor inválido para modo seguro.");
  }
  const locale = payload?.locale;
  if (locale !== undefined && !isLocale(locale)) {
    throw new Error("Idioma inválido.");
  }

  const integrations = integrationsFromBody(payload?.integrations);
  const branchPrefix = settingsTextFromBody(payload, "branchPrefix", "Prefixo de branch inválido.");
  const worktreeDirectory = settingsDirectoryFromBody(payload, "worktreeDirectory");

  return {
    ...(typeof safeMode === "boolean" ? { safeMode } : {}),
    ...(isLocale(locale) ? { locale } : {}),
    ...(branchPrefix !== undefined ? { branchPrefix } : {}),
    ...(worktreeDirectory !== undefined ? { worktreeDirectory } : {}),
    ...(integrations ? { integrations } : {})
  };
}

function settingsTextFromBody(
  payload: Record<string, unknown> | null,
  key: string,
  errorMessage: string
): string | undefined {
  const value = payload?.[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(errorMessage);
  return value.trim();
}

function settingsDirectoryFromBody(
  payload: Record<string, unknown> | null,
  key: string
): string | undefined {
  const value = settingsTextFromBody(payload, key, "Local default das worktrees inválido.");
  if (value === undefined || !value) return value;
  if (!path.isAbsolute(value)) {
    throw new Error("O local default das worktrees deve ser um caminho absoluto.");
  }
  return path.resolve(value);
}

function isLocale(value: unknown): value is AppSettings["locale"] {
  return value === "pt" || value === "en";
}

function integrationsFromBody(value: unknown): AppIntegrations | null {
  if (value === undefined) return null;
  const integrations = value as Partial<AppIntegrations> | null;
  if (!integrations || typeof integrations !== "object") {
    throw new Error("Integrações inválidas.");
  }

  const editor = integrations.editor;
  const terminal = integrations.terminal;
  if (!isEditorIntegration(editor)) {
    throw new Error("Editor externo inválido.");
  }
  if (!isTerminalIntegration(terminal)) {
    throw new Error("Terminal externo inválido.");
  }

  return { editor, terminal };
}

function openTargetFromBody(body: unknown): OpenTarget {
  const value = (body as Record<string, unknown> | null)?.target;
  if (value === undefined || value === null || value === "") return "folder";
  if (value === "folder" || value === "editor" || value === "terminal") return value;
  throw new Error("Destino de abertura inválido.");
}

function isEditorIntegration(value: unknown): value is EditorIntegrationId {
  return (
    value === "auto" ||
    value === "vscode" ||
    value === "cursor" ||
    value === "windsurf" ||
    value === "zed" ||
    value === "sublime"
  );
}

function isTerminalIntegration(value: unknown): value is TerminalIntegrationId {
  return (
    value === "auto" ||
    value === "system" ||
    value === "iterm" ||
    value === "warp" ||
    value === "windows-terminal" ||
    value === "x-terminal-emulator" ||
    value === "gnome-terminal" ||
    value === "konsole"
  );
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

async function pickFolder(platform: NodeJS.Platform = process.platform): Promise<string | null> {
  const picker = folderPickerCommand(platform);
  if (!picker) {
    throw new Error("O seletor nativo de pastas não está disponível neste sistema.");
  }

  return runFolderPickerCommand(picker);
}

function folderPickerCommand(platform: NodeJS.Platform): OpenCommand | null {
  if (platform === "darwin") {
    return {
      command: "osascript",
      args: ["-e", 'POSIX path of (choose folder with prompt "Selecionar repositório Git")']
    };
  }

  if (platform === "win32") {
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-STA",
        "-Command",
        [
          "Add-Type -AssemblyName System.Windows.Forms;",
          "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;",
          "$dialog.Description = 'Selecionar repositório Git';",
          "$dialog.ShowNewFolderButton = $false;",
          "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }"
        ].join(" ")
      ]
    };
  }

  return {
    command: "zenity",
    args: ["--file-selection", "--directory", "--title=Selecionar repositório Git"]
  };
}

async function runFolderPickerCommand(picker: OpenCommand): Promise<string | null> {
  const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const child = spawn(picker.command, picker.args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  }).catch(async (error: NodeJS.ErrnoException) => {
    if (picker.command !== "zenity" || error.code !== "ENOENT") {
      throw error;
    }
    return runFolderPickerCommand({
      command: "kdialog",
      args: ["--getexistingdirectory", os.homedir(), "Selecionar repositório Git"]
    }).then((path) => ({ stdout: path ?? "", stderr: "", code: path ? 0 : 1 }));
  });

  if (result.code !== 0) {
    return null;
  }

  const selectedPath = result.stdout.trim();
  if (!selectedPath) return null;
  const resolvedPath = path.resolve(selectedPath);
  const stat = await fs.stat(resolvedPath);
  if (!stat.isDirectory()) {
    throw new Error("A seleção não é uma pasta.");
  }
  return resolvedPath;
}

async function openPath(targetPath: string, target: OpenTarget, settings: AppSettings): Promise<void> {
  const opener = buildOpenCommand(targetPath, target, process.platform, process.env, settings);
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
  env: NodeJS.ProcessEnv = process.env,
  settings?: AppSettings
): OpenCommand {
  if (target === "folder") return folderOpenCommand(targetPath, platform);

  if (target === "editor") {
    const editor = settings?.integrations.editor ?? "auto";
    if (editor !== "auto") return editorOpenCommand(editor, targetPath, platform);

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

  const terminal = settings?.integrations.terminal ?? "auto";
  if (terminal !== "auto" && terminal !== "system") {
    return terminalOpenCommand(terminal, targetPath, platform);
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

function editorOpenCommand(editor: EditorIntegrationId, targetPath: string, platform: NodeJS.Platform): OpenCommand {
  if (editor === "vscode") return { command: platform === "win32" ? "code.cmd" : "code", args: [targetPath] };
  if (editor === "cursor") return { command: platform === "win32" ? "cursor.cmd" : "cursor", args: [targetPath] };
  if (editor === "windsurf") return { command: platform === "win32" ? "windsurf.cmd" : "windsurf", args: [targetPath] };
  if (editor === "zed") return { command: platform === "win32" ? "zed.exe" : "zed", args: [targetPath] };
  return { command: platform === "win32" ? "sublime_text.exe" : "subl", args: [targetPath] };
}

function terminalOpenCommand(terminal: TerminalIntegrationId, targetPath: string, platform: NodeJS.Platform): OpenCommand {
  if (terminal === "iterm") return { command: "open", args: ["-a", "iTerm", targetPath] };
  if (terminal === "warp") {
    if (platform === "darwin") return { command: "open", args: ["-a", "Warp", targetPath] };
    return { command: "warp-terminal", args: ["--working-directory", targetPath] };
  }
  if (terminal === "windows-terminal") return { command: "wt.exe", args: ["-d", targetPath] };
  if (terminal === "gnome-terminal") return { command: "gnome-terminal", args: ["--working-directory", targetPath] };
  if (terminal === "konsole") return { command: "konsole", args: ["--workdir", targetPath] };
  return { command: "x-terminal-emulator", args: ["--working-directory", targetPath] };
}

async function getIntegrationCatalog(settings: AppSettings): Promise<IntegrationCatalog> {
  const integrations = settings.integrations;
  const editors = await Promise.all(
    editorIntegrationDefinitions().map(async (item) => ({
      ...item,
      selected: item.id === integrations.editor,
      available: item.id === "auto" || (await integrationAvailable(item.id, item.kind)),
      command: item.id === "auto" ? null : integrationCommandLabel(item.id, item.kind)
    }))
  );
  const terminals = await Promise.all(
    terminalIntegrationDefinitions().map(async (item) => ({
      ...item,
      selected: item.id === integrations.terminal,
      available: item.id === "auto" || item.id === "system" || (await integrationAvailable(item.id, item.kind)),
      command: item.id === "auto" || item.id === "system" ? null : integrationCommandLabel(item.id, item.kind)
    }))
  );

  return { editors, terminals, settings: integrations };
}

function editorIntegrationDefinitions(): Array<Omit<IntegrationRecord<EditorIntegrationId>, "available" | "selected" | "command">> {
  return [
    {
      id: "auto",
      kind: "editor",
      label: "Auto",
      description: "Usa o comportamento padrão da aplicação."
    },
    {
      id: "vscode",
      kind: "editor",
      label: "Visual Studio Code",
      description: "Abre worktrees com o comando code."
    },
    {
      id: "cursor",
      kind: "editor",
      label: "Cursor",
      description: "Abre worktrees com o comando cursor."
    },
    {
      id: "windsurf",
      kind: "editor",
      label: "Windsurf",
      description: "Abre worktrees com o comando windsurf."
    },
    {
      id: "zed",
      kind: "editor",
      label: "Zed",
      description: "Abre worktrees com o comando zed."
    },
    {
      id: "sublime",
      kind: "editor",
      label: "Sublime Text",
      description: "Abre worktrees com o comando subl."
    }
  ];
}

function terminalIntegrationDefinitions(): Array<Omit<IntegrationRecord<TerminalIntegrationId>, "available" | "selected" | "command">> {
  return [
    {
      id: "auto",
      kind: "terminal",
      label: "Auto",
      description: "Usa o comportamento padrão da aplicação."
    },
    {
      id: "system",
      kind: "terminal",
      label: "Terminal do sistema",
      description: "Usa Terminal, cmd.exe ou x-terminal-emulator."
    },
    {
      id: "iterm",
      kind: "terminal",
      label: "iTerm",
      description: "Abre worktrees no iTerm em macOS."
    },
    {
      id: "warp",
      kind: "terminal",
      label: "Warp",
      description: "Abre worktrees no Warp."
    },
    {
      id: "windows-terminal",
      kind: "terminal",
      label: "Windows Terminal",
      description: "Abre worktrees com wt.exe."
    },
    {
      id: "x-terminal-emulator",
      kind: "terminal",
      label: "x-terminal-emulator",
      description: "Abre worktrees no terminal padrão Linux."
    },
    {
      id: "gnome-terminal",
      kind: "terminal",
      label: "GNOME Terminal",
      description: "Abre worktrees no GNOME Terminal."
    },
    {
      id: "konsole",
      kind: "terminal",
      label: "Konsole",
      description: "Abre worktrees no Konsole."
    }
  ];
}

async function integrationAvailable(id: EditorIntegrationId | TerminalIntegrationId, kind: "editor" | "terminal"): Promise<boolean> {
  const command = integrationCommandName(id, kind);
  if (command && (await commandExists(command))) return true;

  if (process.platform !== "darwin") return false;
  const appName = macIntegrationAppName(id);
  return appName ? pathExists(path.join("/Applications", `${appName}.app`)) : false;
}

function integrationCommandName(id: EditorIntegrationId | TerminalIntegrationId, kind: "editor" | "terminal"): string | null {
  if (kind === "editor") {
    if (id === "vscode") return process.platform === "win32" ? "code.cmd" : "code";
    if (id === "sublime") return process.platform === "win32" ? "sublime_text.exe" : "subl";
    if (id === "auto") return null;
    return process.platform === "win32" ? `${id}.cmd` : id;
  }

  if (id === "warp") return process.platform === "darwin" ? null : "warp-terminal";
  if (id === "windows-terminal") return "wt.exe";
  if (id === "x-terminal-emulator" || id === "gnome-terminal" || id === "konsole") return id;
  return null;
}

function integrationCommandLabel(id: EditorIntegrationId | TerminalIntegrationId, kind: "editor" | "terminal"): string | null {
  const command = integrationCommandName(id, kind);
  if (command) return command;
  if (id === "iterm") return "open -a iTerm";
  if (id === "warp") return process.platform === "darwin" ? "open -a Warp" : "warp-terminal";
  return null;
}

function macIntegrationAppName(id: EditorIntegrationId | TerminalIntegrationId): string | null {
  if (id === "vscode") return "Visual Studio Code";
  if (id === "cursor") return "Cursor";
  if (id === "windsurf") return "Windsurf";
  if (id === "zed") return "Zed";
  if (id === "sublime") return "Sublime Text";
  if (id === "iterm") return "iTerm";
  if (id === "warp") return "Warp";
  return null;
}

async function commandExists(command: string): Promise<boolean> {
  const candidates = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((directory) => {
      const base = path.join(directory, command);
      if (process.platform !== "win32") return [base];
      const extensions = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";");
      return path.extname(command) ? [base] : extensions.map((extension) => `${base}${extension.toLowerCase()}`);
    });

  for (const candidate of candidates) {
    try {
      await fs.access(candidate, fsConstants.X_OK);
      return true;
    } catch {
      // Keep scanning PATH entries.
    }
  }

  return false;
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
