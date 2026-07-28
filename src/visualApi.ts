import type {
  ArchivedWorktreeRecord,
  BranchRecord,
  DiagnosticEventInput,
  DiagnosticsSnapshot,
  FsListResponse,
  IntegrationCatalog,
  LocalBranchWorktreeResult,
  OpenTarget,
  AppSettings,
  OperationRecord,
  RepoDetail,
  RepoRecord,
  ReviewDiffResponse,
  RepoSummary,
  WorktreeHandoffResult,
  WorktreeRecord
} from "./types";

const repo: RepoRecord = {
  id: "visual-repo",
  name: "WorktreeManager",
  path: "/Users/demo/Projects/WorktreeManager",
  lastOpenedAt: "2026-07-07T18:00:00.000Z"
};

const localPath = repo.path;
const authPath = "/Users/demo/Projects/WorktreeManager-feature-auth";
const dashboardPath = "/Users/demo/Projects/WorktreeManager-feature-dashboard";

const worktreeStatus = {
  staged: 1,
  unstaged: 2,
  untracked: 1,
  conflicted: 0,
  total: 4,
  clean: false
};

const cleanStatus = {
  staged: 0,
  unstaged: 0,
  untracked: 0,
  conflicted: 0,
  total: 0,
  clean: true
};

const worktrees: WorktreeRecord[] = [
  {
    id: "visual-local",
    path: localPath,
    branch: "main",
    head: "a1b2c3d4",
    isCurrent: false,
    detached: false,
    bare: false,
    upstream: "origin/main",
    ahead: 0,
    behind: 1,
    status: cleanStatus,
    lastCommit: {
      sha: "a1b2c3d",
      subject: "feat: add worktree manager dashboard",
      date: "2026-07-07T14:00:00.000Z"
    }
  },
  {
    id: "visual-auth",
    path: authPath,
    branch: "feature/auth",
    head: "d4e5f6a7",
    isCurrent: true,
    detached: false,
    bare: false,
    upstream: "origin/feature/auth",
    ahead: 2,
    behind: 0,
    status: worktreeStatus,
    lastCommit: {
      sha: "d4e5f6a",
      subject: "feat(auth): implement login handoff",
      date: "2026-07-07T16:30:00.000Z"
    }
  },
  {
    id: "visual-dashboard",
    path: dashboardPath,
    branch: "feature/dashboard",
    head: "c8d9e0f1",
    isCurrent: false,
    detached: false,
    bare: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    status: cleanStatus,
    lastCommit: {
      sha: "c8d9e0f",
      subject: "feat(ui): refine repository detail view",
      date: "2026-07-06T11:15:00.000Z"
    }
  }
];

let archivedWorktrees: ArchivedWorktreeRecord[] = [];

const branches: BranchRecord[] = [
  {
    name: "main",
    current: false,
    upstream: "origin/main",
    isRemote: false,
    head: "a1b2c3d",
    ahead: 0,
    behind: 1,
    lastCommit: {
      sha: "a1b2c3d",
      subject: "feat: add worktree manager dashboard",
      date: "2026-07-07T14:00:00.000Z"
    }
  },
  {
    name: "feature/auth",
    current: true,
    upstream: "origin/feature/auth",
    isRemote: false,
    head: "d4e5f6a",
    ahead: 2,
    behind: 0,
    lastCommit: {
      sha: "d4e5f6a",
      subject: "feat(auth): implement login handoff",
      date: "2026-07-07T16:30:00.000Z"
    }
  },
  {
    name: "feature/dashboard",
    current: false,
    upstream: null,
    isRemote: false,
    head: "c8d9e0f",
    ahead: 0,
    behind: 0,
    lastCommit: {
      sha: "c8d9e0f",
      subject: "feat(ui): refine repository detail view",
      date: "2026-07-06T11:15:00.000Z"
    }
  },
  {
    name: "origin/main",
    current: false,
    upstream: null,
    isRemote: true,
    head: "b7c8d9e",
    ahead: 0,
    behind: 0,
    lastCommit: {
      sha: "b7c8d9e",
      subject: "chore: update git operation logging",
      date: "2026-07-07T17:00:00.000Z"
    }
  }
];

let operations: OperationRecord[] = [
  {
    id: "visual-op-1",
    command: "git",
    args: ["status", "--porcelain=v1", "-uall"],
    cwd: authPath,
    startedAt: "2026-07-07T17:55:00.000Z",
    finishedAt: "2026-07-07T17:55:00.084Z",
    status: "success",
    exitCode: 0,
    summary: "M src/App.tsx",
    stdout: "M src/App.tsx\nA src/visualApi.ts\n?? docs/visual-e2e.md",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 84,
    timeoutMs: 30000,
    timedOut: false,
    signal: null
  },
  {
    id: "visual-op-2",
    command: "git",
    args: ["pull", "--ff-only"],
    cwd: localPath,
    startedAt: "2026-07-07T17:45:00.000Z",
    finishedAt: "2026-07-07T17:45:02.450Z",
    status: "error",
    exitCode: 1,
    summary: "Not possible to fast-forward",
    stdout: "",
    stderr: "fatal: Not possible to fast-forward, aborting.",
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 2450,
    timeoutMs: 120000,
    timedOut: false,
    signal: null
  }
];

let settings: AppSettings = {
  safeMode: true,
  locale: "pt",
  branchPrefix: "",
  worktreeDirectory: "",
  integrations: {
    editor: "auto",
    terminal: "auto"
  }
};

export const visualApi = {
  async listFs(): Promise<FsListResponse> {
    return {
      path: "/Users/demo/Projects",
      parent: "/Users/demo",
      isGitRepo: false,
      entries: [
        {
          name: "WorktreeManager",
          path: localPath,
          isDirectory: true,
          isGitRepo: true
        }
      ]
    };
  },
  async pickFolder(): Promise<{ path: string }> {
    return { path: localPath };
  },
  async listRepos(): Promise<RepoRecord[]> {
    return [repo];
  },
  async addRepo(): Promise<RepoRecord> {
    return repo;
  },
  async getSettings(): Promise<AppSettings> {
    return settings;
  },
  async updateSettings(nextSettings: Partial<AppSettings>): Promise<AppSettings> {
    settings = {
      ...settings,
      ...nextSettings,
      integrations: nextSettings.integrations
        ? { ...settings.integrations, ...nextSettings.integrations }
        : settings.integrations
    };
    return settings;
  },
  async integrations(): Promise<IntegrationCatalog> {
    return {
      settings: settings.integrations,
      editors: [
        {
          id: "auto",
          kind: "editor",
          label: "Auto",
          description: "Usa o comportamento padrão da aplicação.",
          available: true,
          selected: settings.integrations.editor === "auto",
          command: null
        },
        {
          id: "vscode",
          kind: "editor",
          label: "Visual Studio Code",
          description: "Abre worktrees com o comando code.",
          available: true,
          selected: settings.integrations.editor === "vscode",
          command: "code"
        },
        {
          id: "cursor",
          kind: "editor",
          label: "Cursor",
          description: "Abre worktrees com o comando cursor.",
          available: true,
          selected: settings.integrations.editor === "cursor",
          command: "cursor"
        },
        {
          id: "zed",
          kind: "editor",
          label: "Zed",
          description: "Abre worktrees com o comando zed.",
          available: false,
          selected: settings.integrations.editor === "zed",
          command: "zed"
        }
      ],
      terminals: [
        {
          id: "auto",
          kind: "terminal",
          label: "Auto",
          description: "Usa o comportamento padrão da aplicação.",
          available: true,
          selected: settings.integrations.terminal === "auto",
          command: null
        },
        {
          id: "system",
          kind: "terminal",
          label: "Terminal do sistema",
          description: "Usa Terminal, cmd.exe ou x-terminal-emulator.",
          available: true,
          selected: settings.integrations.terminal === "system",
          command: null
        },
        {
          id: "iterm",
          kind: "terminal",
          label: "iTerm",
          description: "Abre worktrees no iTerm em macOS.",
          available: true,
          selected: settings.integrations.terminal === "iterm",
          command: "open -a iTerm"
        },
        {
          id: "warp",
          kind: "terminal",
          label: "Warp",
          description: "Abre worktrees no Warp.",
          available: false,
          selected: settings.integrations.terminal === "warp",
          command: "open -a Warp"
        }
      ]
    };
  },
  async diagnostics(): Promise<DiagnosticsSnapshot> {
    return buildVisualDiagnostics();
  },
  async recordDiagnosticEvent(event: DiagnosticEventInput): Promise<OperationRecord> {
    const now = new Date().toISOString();
    const record: OperationRecord = {
      id: `visual-op-${operations.length + 1}`,
      command: "app",
      args: ["diagnostic", event.level, event.name],
      cwd: "worktree-manager",
      startedAt: now,
      finishedAt: now,
      status: event.level === "error" ? "error" : "success",
      exitCode: event.level === "error" ? 1 : 0,
      summary: event.message,
      stdout: event.context ? JSON.stringify(event.context, null, 2) : "",
      stderr: event.detail ?? "",
      stdoutTruncated: false,
      stderrTruncated: false,
      durationMs: 0,
      timeoutMs: 0,
      timedOut: false,
      signal: null
    };
    operations = [record, ...operations].slice(0, 60);
    return record;
  },
  async summary(_repoId: string, worktreePath?: string): Promise<RepoSummary> {
    const visibleWorktrees = visibleWorktreesForVisualApi(worktreePath);
    const focused = worktreeForPath(worktreePath ?? authPath);
    return {
      repo,
      valid: true,
      gitVersion: "git version 2.50.1",
      focusedWorktreePath: focused.path,
      currentBranch: focused.branch ?? "detached",
      commitCount: 142,
      branchCount: branches.filter((branch) => !branch.isRemote).length,
      worktreeCount: visibleWorktrees.length,
      dirtyWorktreeCount: visibleWorktrees.filter((worktree) => worktree.status && !worktree.status.clean).length,
      changedFileCount: visibleWorktrees.reduce((total, worktree) => total + (worktree.status?.total ?? 0), 0),
      stashCount: 1,
      ahead: focused.ahead ?? 0,
      behind: focused.behind ?? 0,
      branchAheadCount: branches.filter((branch) => (branch.ahead ?? 0) > 0).length,
      branchBehindCount: branches.filter((branch) => (branch.behind ?? 0) > 0).length,
      lastUpdatedAt: "2026-07-07T18:00:00.000Z"
    };
  },
  async worktrees(_repoId: string, worktreePath?: string): Promise<WorktreeRecord[]> {
    return visibleWorktreesForVisualApi(worktreePath);
  },
  async archivedWorktrees(): Promise<ArchivedWorktreeRecord[]> {
    return archivedWorktrees;
  },
  async detail(_repoId: string, worktreePath?: string): Promise<RepoDetail> {
    const worktree = worktreeForPath(worktreePath ?? authPath);
    const status = worktree.status ?? cleanStatus;

    return {
      repo,
      worktree,
      branch: worktree.branch,
      upstream: worktree.upstream ?? null,
      ahead: worktree.ahead ?? 0,
      behind: worktree.behind ?? 0,
      lastFetchAt: "2026-07-07T17:10:00.000Z",
      stashCount: 1,
      status,
      files: status.clean
        ? []
        : [
            {
              path: "src/App.tsx",
              originalPath: null,
              indexStatus: " ",
              worktreeStatus: "M",
              label: "Modificado"
            },
            {
              path: "src/visualApi.ts",
              originalPath: null,
              indexStatus: "A",
              worktreeStatus: " ",
              label: "Adicionado"
            },
            {
              path: "docs/visual-e2e.md",
              originalPath: null,
              indexStatus: "?",
              worktreeStatus: "?",
              label: "Por seguir"
            }
          ],
      worktrees: visibleWorktreesForVisualApi(worktreePath),
      lastUpdatedAt: "2026-07-07T18:00:00.000Z"
    };
  },
  async review(_repoId: string, worktreePath?: string): Promise<ReviewDiffResponse> {
    const worktree = worktreeForPath(worktreePath ?? authPath);
    const status = worktree.status ?? cleanStatus;
    return {
      repo,
      worktree,
      branch: worktree.branch,
      status,
      generatedAt: "2026-07-07T18:00:00.000Z",
      files: status.clean
        ? []
        : [
            {
              id: "unstaged:src/App.tsx",
              path: "src/App.tsx",
              originalPath: null,
              mode: "unstaged",
              statusLabel: "Modificado",
              binary: false,
              tooLarge: false,
              truncated: false,
              additions: 2,
              deletions: 1,
              error: null,
              hunks: [
                {
                  header: "@@ -10,3 +10,4 @@",
                  oldStart: 10,
                  oldLines: 3,
                  newStart: 10,
                  newLines: 4,
                  lines: [
                    { type: "context", oldLineNumber: 10, newLineNumber: 10, content: "function App() {" },
                    { type: "delete", oldLineNumber: 11, newLineNumber: null, content: "  return null;" },
                    { type: "add", oldLineNumber: null, newLineNumber: 11, content: "  return <ReviewPage />;" },
                    { type: "add", oldLineNumber: null, newLineNumber: 12, content: "}" }
                  ]
                }
              ]
            },
            {
              id: "untracked:docs/visual-e2e.md",
              path: "docs/visual-e2e.md",
              originalPath: null,
              mode: "untracked",
              statusLabel: "Por seguir",
              binary: false,
              tooLarge: false,
              truncated: false,
              additions: 1,
              deletions: 0,
              error: null,
              hunks: [
                {
                  header: "@@ -0,0 +1,1 @@",
                  oldStart: 0,
                  oldLines: 0,
                  newStart: 1,
                  newLines: 1,
                  lines: [{ type: "add", oldLineNumber: null, newLineNumber: 1, content: "Visual review checklist" }]
                }
              ]
            }
          ]
    };
  },
  async createWorktree(): Promise<{ path: string }> {
    return { path: dashboardPath };
  },
  async archiveWorktree(_repoId: string, worktreeId: string): Promise<ArchivedWorktreeRecord> {
    const worktree = worktrees.find((item) => item.id === worktreeId);
    if (!worktree) {
      throw new Error("Worktree não encontrada.");
    }
    const record: ArchivedWorktreeRecord = {
      repoId: repo.id,
      worktreeId: worktree.id,
      path: worktree.path,
      branch: worktree.branch,
      head: worktree.head,
      archivedAt: new Date().toISOString()
    };
    archivedWorktrees = [
      record,
      ...archivedWorktrees.filter((item) => item.repoId !== record.repoId || item.worktreeId !== record.worktreeId)
    ];
    return record;
  },
  async restoreWorktree(_repoId: string, worktreeId: string): Promise<void> {
    archivedWorktrees = archivedWorktrees.filter((worktree) => worktree.worktreeId !== worktreeId);
  },
  async removeWorktree(): Promise<void> {},
  async handoffWorktreeToLocal(): Promise<WorktreeHandoffResult> {
    return {
      branch: "feature/auth",
      localPath,
      detachedWorktreePath: authPath,
      movedChanges: true
    };
  },
  async moveLocalBranchToWorktree(): Promise<LocalBranchWorktreeResult> {
    return {
      branch: "feature/auth",
      baseBranch: "main",
      localPath,
      worktreePath: authPath,
      movedChanges: true
    };
  },
  async branches(): Promise<BranchRecord[]> {
    return branches;
  },
  async createBranch(): Promise<{ name: string }> {
    return { name: "feature/visual" };
  },
  async checkoutBranch(_repoId: string, branchName: string): Promise<{ branch: string }> {
    return { branch: branchName };
  },
  async deleteBranch(): Promise<void> {},
  async fetchRepo(): Promise<{ ok: boolean }> {
    return { ok: true };
  },
  async pullRepo(): Promise<{ ok: boolean }> {
    return { ok: true };
  },
  async openPath(_path: string, _target: OpenTarget = "folder"): Promise<{ ok: boolean }> {
    return { ok: true };
  },
  async operations(): Promise<OperationRecord[]> {
    return operations;
  },
  async operation(operationId: string): Promise<OperationRecord> {
    return operations.find((operation) => operation.id === operationId) ?? operations[0];
  }
};

function worktreeForPath(worktreePath: string): WorktreeRecord {
  return worktrees.find((worktree) => worktree.path === worktreePath) ?? worktrees[1];
}

function visibleWorktreesForVisualApi(worktreePath?: string): WorktreeRecord[] {
  const archivedIds = new Set(archivedWorktrees.map((worktree) => worktree.worktreeId));
  return worktrees
    .filter((worktree) => !archivedIds.has(worktree.id))
    .map((worktree) => ({
      ...worktree,
      isCurrent: worktree.path === (worktreePath ?? authPath)
    }));
}

function buildVisualDiagnostics(): DiagnosticsSnapshot {
  const durations = operations
    .map((operation) => operation.durationMs)
    .filter((duration): duration is number => typeof duration === "number")
    .sort((left, right) => left - right);
  const failures = operations.filter((operation) => operation.status === "error");

  return {
    generatedAt: new Date().toISOString(),
    appVersion: "1.0.0",
    runtime: "visual",
    platform: "visual",
    statePath: "/Users/demo/Library/Application Support/Worktree Manager/state.json",
    repositoryCount: 1,
    operationCount: operations.length,
    operationStats: {
      success: operations.filter((operation) => operation.status === "success").length,
      error: failures.length,
      timedOut: operations.filter((operation) => operation.timedOut).length,
      averageDurationMs: durations.length
        ? Math.round(durations.reduce((total, duration) => total + duration, 0) / durations.length)
        : 0,
      p95DurationMs: durations.length ? durations[Math.ceil(0.95 * durations.length) - 1] : 0,
      slowestDurationMs: durations.at(-1) ?? 0,
      lastFailureAt: failures[0]?.finishedAt ?? null
    },
    recentFailures: failures.slice(0, 5),
    settings
  };
}
