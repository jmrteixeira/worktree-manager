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
  stderr: string;
};

export type ApiError = {
  error: string;
  detail?: string;
};
