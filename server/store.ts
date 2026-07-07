import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OperationRecord, RepoRecord } from "../src/types";

type AppState = {
  repos: RepoRecord[];
  operations: OperationRecord[];
};

const defaultState: AppState = {
  repos: [],
  operations: []
};

export class AppStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly stateFile = path.join(process.cwd(), ".worktree-manager", "state.json")
  ) {}

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

  private async readState(): Promise<AppState> {
    try {
      const contents = await fs.readFile(this.stateFile, "utf8");
      const parsed = JSON.parse(contents) as AppState;
      return {
        repos: Array.isArray(parsed.repos) ? parsed.repos : [],
        operations: Array.isArray(parsed.operations) ? parsed.operations : []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
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
  return new AppStore();
}
