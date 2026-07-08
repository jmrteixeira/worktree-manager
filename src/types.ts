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

export type ApiError = {
  error: string;
  detail?: string;
};
