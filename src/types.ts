export type RepoRecord = {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: string;
};

export type FsEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  isGitRepo: boolean;
};

export type FsListResponse = {
  path: string;
  parent: string | null;
  isGitRepo: boolean;
  entries: FsEntry[];
};

export type CommitInfo = {
  sha: string;
  subject: string;
  date: string | null;
};

export type WorktreeRecord = {
  id: string;
  path: string;
  branch: string | null;
  head: string | null;
  isCurrent: boolean;
  detached: boolean;
  bare: boolean;
  lastCommit: CommitInfo | null;
  status?: GitStatusSummary;
  upstream?: string | null;
  ahead?: number;
  behind?: number;
};

export type GitFileStatus = {
  path: string;
  originalPath: string | null;
  indexStatus: string;
  worktreeStatus: string;
  label: string;
};

export type GitStatusSummary = {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  total: number;
  clean: boolean;
};

export type RepoDetail = {
  repo: RepoRecord;
  worktree: WorktreeRecord;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  lastFetchAt: string | null;
  stashCount: number;
  status: GitStatusSummary;
  files: GitFileStatus[];
  worktrees: WorktreeRecord[];
  lastUpdatedAt: string;
};

export type WorktreeHandoffResult = {
  branch: string;
  localPath: string;
  detachedWorktreePath: string;
  movedChanges: boolean;
};

export type LocalBranchWorktreeResult = {
  branch: string;
  baseBranch: string;
  localPath: string;
  worktreePath: string;
  movedChanges: boolean;
};

export type BranchRecord = {
  name: string;
  current: boolean;
  upstream: string | null;
  isRemote: boolean;
  head: string | null;
  lastCommit: CommitInfo | null;
  ahead?: number;
  behind?: number;
};

export type RepoSummary = {
  repo: RepoRecord;
  valid: boolean;
  gitVersion: string;
  focusedWorktreePath: string;
  currentBranch: string;
  commitCount: number;
  branchCount: number;
  worktreeCount: number;
  dirtyWorktreeCount?: number;
  changedFileCount?: number;
  stashCount?: number;
  ahead?: number;
  behind?: number;
  branchAheadCount?: number;
  branchBehindCount?: number;
  lastUpdatedAt: string;
};

export type OperationRecord = {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  startedAt: string;
  finishedAt: string;
  status: "success" | "error";
  exitCode: number | null;
  summary: string;
  stdout?: string;
  stderr: string;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  durationMs?: number;
  timeoutMs?: number;
  timedOut?: boolean;
  signal?: string | null;
};

export type OpenTarget = "folder" | "editor" | "terminal";

export type EditorIntegrationId = "auto" | "vscode" | "cursor" | "windsurf" | "zed" | "sublime";

export type TerminalIntegrationId =
  | "auto"
  | "system"
  | "iterm"
  | "warp"
  | "windows-terminal"
  | "x-terminal-emulator"
  | "gnome-terminal"
  | "konsole";

export type AppIntegrations = {
  editor: EditorIntegrationId;
  terminal: TerminalIntegrationId;
};

export type AppSettings = {
  safeMode: boolean;
  integrations: AppIntegrations;
};

export type IntegrationRecord<TId extends string = string> = {
  id: TId;
  kind: "editor" | "terminal";
  label: string;
  description: string;
  available: boolean;
  selected: boolean;
  command: string | null;
};

export type IntegrationCatalog = {
  editors: IntegrationRecord<EditorIntegrationId>[];
  terminals: IntegrationRecord<TerminalIntegrationId>[];
  settings: AppIntegrations;
};

export type OperationStats = {
  success: number;
  error: number;
  timedOut: number;
  averageDurationMs: number;
  p95DurationMs: number;
  slowestDurationMs: number;
  lastFailureAt: string | null;
};

export type DiagnosticsSnapshot = {
  generatedAt: string;
  appVersion: string;
  runtime: "node" | "tauri" | "visual";
  platform: string;
  statePath?: string;
  repositoryCount: number;
  operationCount: number;
  operationStats: OperationStats;
  recentFailures: OperationRecord[];
  settings: AppSettings;
};

export type DiagnosticEventInput = {
  level: "info" | "warning" | "error";
  name: string;
  message: string;
  detail?: string;
  context?: Record<string, unknown>;
};

export type ApiError = {
  error: string;
  detail?: string;
};
