import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppSettings, OperationRecord, RepoRecord } from "../src/types";

type AppState = {
  repos: RepoRecord[];
  operations: OperationRecord[];
  settings: AppSettings;
};

const defaultState: AppState = {
  repos: [],
  operations: [],
  settings: {
    safeMode: true,
    integrations: {
      editor: "auto",
      terminal: "auto"
    }
  }
};

export class AppStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly stateFile = path.join(process.cwd(), ".worktree-manager", "state.json"),
    private readonly fallbackStateFiles: string[] = []
  ) {}

  stateFilePath(): string {
    return this.stateFile;
  }

  async listRepos(): Promise<RepoRecord[]> {
    const state = await this.readState();
    return state.repos;
  }

  async getRepo(repoId: string): Promise<RepoRecord | null> {
    const state = await this.readState();
    return state.repos.find((repo) => repo.id === repoId) ?? null;
  }

  async upsertRepo(repoPath: string): Promise<RepoRecord> {
    const resolvedPath = path.resolve(repoPath);
    const repo: RepoRecord = {
      id: createHash("sha1").update(resolvedPath).digest("hex").slice(0, 16),
      name: path.basename(resolvedPath),
      path: resolvedPath,
      lastOpenedAt: new Date().toISOString()
    };

    return this.updateState((state) => {
      state.repos = [repo, ...state.repos.filter((item) => item.id !== repo.id)].slice(0, 12);
      return repo;
    });
  }

  async getSettings(): Promise<AppSettings> {
    const state = await this.readState();
    return state.settings;
  }

  async updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    return this.updateState((state) => {
      state.settings = normalizeSettings({ ...state.settings, ...settings });
      return state.settings;
    });
  }

  async recordOperation(
    operation: Omit<OperationRecord, "id" | "finishedAt">
  ): Promise<OperationRecord> {
    const record: OperationRecord = {
      ...operation,
      id: randomUUID(),
      finishedAt: new Date().toISOString()
    };

    return this.updateState((state) => {
      state.operations = [record, ...state.operations].slice(0, 60);
      return record;
    });
  }

  async listOperations(): Promise<OperationRecord[]> {
    const state = await this.readState();
    return state.operations;
  }

  async getOperation(operationId: string): Promise<OperationRecord | null> {
    const state = await this.readState();
    return state.operations.find((operation) => operation.id === operationId) ?? null;
  }

  private async readState(): Promise<AppState> {
    try {
      return parseState(await fs.readFile(this.stateFile, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        for (const fallbackFile of this.fallbackStateFiles) {
          try {
            const state = parseState(await fs.readFile(fallbackFile, "utf8"));
            await this.writeState(state);
            return state;
          } catch (fallbackError) {
            if ((fallbackError as NodeJS.ErrnoException).code !== "ENOENT") {
              throw fallbackError;
            }
          }
        }

        return { ...defaultState };
      }

      throw error;
    }
  }

  private async writeState(state: AppState): Promise<void> {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    const tempFile = `${this.stateFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(state, null, 2));
    await fs.rename(tempFile, this.stateFile);
  }

  private async updateState<T>(mutator: (state: AppState) => T): Promise<T> {
    let result: T;
    const update = this.writeQueue.then(async () => {
      const state = await this.readState();
      result = mutator(state);
      await this.writeState(state);
    });

    this.writeQueue = update.then(
      () => undefined,
      () => undefined
    );
    await update;
    return result!;
  }
}

export function createDefaultStore(): AppStore {
  return new AppStore(defaultStateFile(), [legacyStateFile()]);
}

function parseState(contents: string): AppState {
  const parsed = JSON.parse(contents) as AppState;
  return {
    repos: Array.isArray(parsed.repos) ? parsed.repos : [],
    operations: Array.isArray(parsed.operations) ? parsed.operations : [],
    settings: normalizeSettings(parsed.settings)
  };
}

function normalizeSettings(value: unknown): AppSettings {
  const settings = value as Partial<AppSettings> | null;
  return {
    safeMode: typeof settings?.safeMode === "boolean" ? settings.safeMode : true,
    integrations: {
      editor: isEditorIntegration(settings?.integrations?.editor)
        ? settings.integrations.editor
        : "auto",
      terminal: isTerminalIntegration(settings?.integrations?.terminal)
        ? settings.integrations.terminal
        : "auto"
    }
  };
}

function isEditorIntegration(value: unknown): value is AppSettings["integrations"]["editor"] {
  return (
    value === "auto" ||
    value === "vscode" ||
    value === "cursor" ||
    value === "windsurf" ||
    value === "zed" ||
    value === "sublime"
  );
}

function isTerminalIntegration(value: unknown): value is AppSettings["integrations"]["terminal"] {
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

function defaultStateFile(): string {
  const configuredDir = process.env.WORKTREE_MANAGER_STATE_DIR;
  if (configuredDir) return path.join(configuredDir, "state.json");

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Worktree Manager", "state.json");
  }

  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
      "Worktree Manager",
      "state.json"
    );
  }

  return path.join(
    process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"),
    "worktree-manager",
    "state.json"
  );
}

function legacyStateFile(): string {
  return path.join(process.cwd(), ".worktree-manager", "state.json");
}
