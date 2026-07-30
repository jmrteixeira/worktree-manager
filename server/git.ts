import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  BranchRecord,
  CommitInfo,
  DiffMode,
  GitFileStatus,
  GitStatusSummary,
  LocalBranchWorktreeResult,
  RepoDetail,
  RepoRecord,
  ReviewDiffFile,
  ReviewDiffHunk,
  ReviewDiffLine,
  ReviewDiffResponse,
  RepoSummary,
  WorktreeRecord
} from "../src/types";
import type { AppStore } from "./store";

type GitResult = {
  args: string[];
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  startedAt: string;
  durationMs: number;
  timedOut: boolean;
  timeoutMs: number;
};

type RunGitOptions = {
  allowFailure?: boolean;
  record?: boolean;
  timeoutMs?: number;
};

type StashHandle = {
  message: string;
};

type WorktreeCreateOptions = {
  branch: string;
  newBranch: boolean;
  name?: string | null;
  path?: string | null;
  from?: string | null;
  basePath?: string | null;
};

type BranchSource =
  | { kind: "local"; branch: string }
  | { kind: "remote"; branch: string; localBranch: string };

type ReviewDiffInput = {
  file: GitFileStatus;
  mode: DiffMode;
};

const MAX_OPERATION_LOG_CHARS = 20_000;
const MAX_REVIEW_FILE_BYTES = 220_000;
const MAX_REVIEW_UNTRACKED_LINES = 4_000;

export class GitCommandError extends Error {
  constructor(readonly result: GitResult) {
    super(firstLine(result.stderr) || `git ${result.args.join(" ")} falhou`);
    this.name = "GitCommandError";
  }
}

export function encodePathId(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function decodePathId(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

export async function runGit(
  cwd: string,
  args: string[],
  store?: AppStore,
  options: RunGitOptions = {}
): Promise<GitResult> {
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const timeoutMs = options.timeoutMs ?? 30_000;

  const result = await new Promise<GitResult>((resolve) => {
    const child = spawn("git", args, {
      cwd,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      stderr += `\nComando excedeu ${timeoutMs}ms.`;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        args,
        cwd,
        stdout,
        stderr: stderr || error.message,
        exitCode: 1,
        signal: null,
        startedAt,
        durationMs: Date.now() - startedAtMs,
        timedOut,
        timeoutMs
      });
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        args,
        cwd,
        stdout,
        stderr,
        exitCode,
        signal,
        startedAt,
        durationMs: Date.now() - startedAtMs,
        timedOut,
        timeoutMs
      });
    });
  });

  if (options.record !== false) {
    const stdoutLog = limitOperationLog(result.stdout);
    const stderrLog = limitOperationLog(result.stderr);
    await store?.recordOperation({
      command: "git",
      args,
      cwd,
      startedAt: result.startedAt,
      status: result.exitCode === 0 ? "success" : "error",
      exitCode: result.exitCode,
      summary: summarizeGitResult(result),
      stdout: stdoutLog.value,
      stderr: stderrLog.value,
      stdoutTruncated: stdoutLog.truncated,
      stderrTruncated: stderrLog.truncated,
      durationMs: result.durationMs,
      timeoutMs: result.timeoutMs,
      timedOut: result.timedOut,
      signal: result.signal
    });
  }

  if (!options.allowFailure && result.exitCode !== 0) {
    throw new GitCommandError(result);
  }

  return result;
}

export async function validateRepository(repoPath: string, store?: AppStore): Promise<string> {
  const resolvedPath = path.resolve(repoPath);
  const stat = await fs.stat(resolvedPath);
  if (!stat.isDirectory()) {
    throw new Error("O caminho selecionado não é uma pasta.");
  }

  const result = await runGit(resolvedPath, ["rev-parse", "--show-toplevel"], store, {
    record: false
  });
  return path.resolve(result.stdout.trim());
}

export function parseWorktreePorcelain(stdout: string, currentPath: string): WorktreeRecord[] {
  return stdout
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const worktree: WorktreeRecord = {
        id: "",
        path: "",
        branch: null,
        head: null,
        isCurrent: false,
        detached: false,
        bare: false,
        lastCommit: null
      };

      for (const line of block.split(/\r?\n/)) {
        const [key, ...rest] = line.split(" ");
        const value = rest.join(" ");
        if (key === "worktree") {
          const normalizedPath = path.normalize(value);
          worktree.path = normalizedPath;
          worktree.id = encodePathId(normalizedPath);
        }
        if (key === "HEAD") worktree.head = value;
        if (key === "branch") worktree.branch = value.replace(/^refs\/heads\//, "");
        if (key === "detached") worktree.detached = true;
        if (key === "bare") worktree.bare = true;
      }

      worktree.isCurrent = path.resolve(worktree.path) === path.resolve(currentPath);
      return worktree;
    });
}

export function parseBranchRefs(stdout: string, currentBranch: string): BranchRecord[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [refName, shortName, upstream, head, date, ...subjectParts] = line.split("\t");
      const isRemote = refName.startsWith("refs/remotes/");
      const name = shortName.replace(/^remotes\//, "");
      const subject = subjectParts.join("\t");

      return {
        name,
        current: !isRemote && name === currentBranch,
        upstream: upstream || null,
        isRemote,
        head: head || null,
        lastCommit: head
          ? {
              sha: head,
              date: date || null,
              subject: subject || "Sem mensagem de commit"
            }
          : null
      } satisfies BranchRecord;
    })
    .filter((branch) => !branch.name.endsWith("/HEAD"))
    .sort((a, b) => {
      if (a.current) return -1;
      if (b.current) return 1;
      if (a.isRemote !== b.isRemote) return a.isRemote ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
}

export function parseStatusPorcelain(stdout: string): GitFileStatus[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      if (line.startsWith("?? ")) {
        return {
          path: decodeGitPath(line.slice(3)),
          originalPath: null,
          indexStatus: "?",
          worktreeStatus: "?",
          label: "Por seguir"
        } satisfies GitFileStatus;
      }

      const indexStatus = line[0] || " ";
      const worktreeStatus = line[1] || " ";
      const rawPath = line.slice(3);
      const renameParts = rawPath.split(" -> ");
      const originalPath = renameParts.length > 1 ? decodeGitPath(renameParts[0]) : null;
      const filePath = decodeGitPath(renameParts.length > 1 ? renameParts.slice(1).join(" -> ") : rawPath);

      return {
        path: filePath,
        originalPath,
        indexStatus,
        worktreeStatus,
        label: fileStatusLabel(indexStatus, worktreeStatus)
      } satisfies GitFileStatus;
    });
}

function decodeGitPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return trimmed;
  }

  try {
    return JSON.parse(trimmed) as string;
  } catch {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\t/g, "\t")
      .replace(/\\n/g, "\n");
  }
}

export async function resolveRepoWorktreePath(
  repoPath: string,
  requestedPath?: string | null,
  store?: AppStore
): Promise<string> {
  if (!requestedPath) return repoPath;

  const match = await findWorktreeByPath(repoPath, requestedPath, repoPath, store);

  if (!match) {
    throw new Error("A worktree selecionada não pertence a este repositório.");
  }

  return match.path;
}

export async function assertCleanWorktreeForSafeOperation(
  worktreePath: string,
  operationLabel: string,
  store?: AppStore
): Promise<void> {
  const status = await getWorktreeStatusSummary(worktreePath, store);
  if (status.conflicted > 0) {
    throw new Error(
      `Modo seguro: ${operationLabel} bloqueado porque a worktree tem ${formatSafeConflictCount(status.conflicted)}.`
    );
  }

  if (!status.clean) {
    throw new Error(
      `Modo seguro: ${operationLabel} bloqueado porque a worktree tem ${formatSafeChangeCount(status.total)} não commitadas.`
    );
  }
}

export async function assertNoConflictsForSafeOperation(
  worktreePath: string,
  operationLabel: string,
  store?: AppStore
): Promise<void> {
  const status = await getWorktreeStatusSummary(worktreePath, store);
  if (status.conflicted > 0) {
    throw new Error(
      `Modo seguro: ${operationLabel} bloqueado porque a worktree tem ${formatSafeConflictCount(status.conflicted)}.`
    );
  }
}

export async function assertSafeBranchDeletion(
  repoPath: string,
  branchName: string,
  store?: AppStore
): Promise<void> {
  if (isProtectedBranch(branchName)) {
    throw new Error(`Modo seguro: não é possível apagar a branch protegida "${branchName}".`);
  }

  const porcelain = await runGit(repoPath, ["worktree", "list", "--porcelain"], store, {
    record: false
  });
  const checkedOutWorktree = parseWorktreePorcelain(porcelain.stdout, repoPath).find(
    (worktree) => worktree.branch === branchName
  );

  if (checkedOutWorktree) {
    throw new Error(
      `Modo seguro: não é possível apagar "${branchName}" porque está checked out em ${checkedOutWorktree.path}.`
    );
  }
}

export async function createWorktree(
  repo: Pick<RepoRecord, "name" | "path">,
  options: WorktreeCreateOptions,
  store?: AppStore
): Promise<string> {
  const branch = options.branch.trim();
  if (!branch) {
    throw new Error("Campo obrigatório em falta: branch.");
  }

  const targetPath = resolveWorktreeTargetPath(
    repo,
    branch,
    options.name,
    options.path,
    options.basePath
  );

  if (await pathExists(targetPath)) {
    throw new Error(`Já existe uma pasta com esse nome: ${targetPath}`);
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  let args: string[];
  if (options.newBranch) {
    await assertValidBranchName(repo.path, branch, store);
    await assertBranchDoesNotExist(repo.path, branch, store);
    const startPoint = options.from?.trim();
    if (startPoint) {
      const remoteExists = await remoteBranchExists(repo.path, startPoint, store);
      await assertRefExists(repo.path, startPoint, store);
      args = remoteExists
        ? ["worktree", "add", "-b", branch, "--track", targetPath, startPoint]
        : ["worktree", "add", "-b", branch, targetPath, startPoint];
    } else {
      args = ["worktree", "add", "-b", branch, targetPath];
    }
  } else {
    const source = await resolveBranchSource(repo.path, branch, store);
    if (source.kind === "local") {
      await assertBranchAvailableForCheckout(repo.path, source.branch, null, store);
      args = ["worktree", "add", targetPath, source.branch];
    } else {
      await assertBranchAvailableForCheckout(repo.path, source.localBranch, null, store);
      args = ["worktree", "add", "-b", source.localBranch, "--track", targetPath, source.branch];
    }
  }

  await runGit(repo.path, args, store, { timeoutMs: 120_000 });
  return targetPath;
}

export async function createBranch(
  repoPath: string,
  name: string,
  from?: string | null,
  store?: AppStore
): Promise<string> {
  const branchName = name.trim();
  await assertValidBranchName(repoPath, branchName, store);
  await assertBranchDoesNotExist(repoPath, branchName, store);

  const startPoint = from?.trim();
  if (!startPoint) {
    await runGit(repoPath, ["branch", branchName], store);
    return branchName;
  }

  const remoteExists = await remoteBranchExists(repoPath, startPoint, store);
  await assertRefExists(repoPath, startPoint, store);
  await runGit(
    repoPath,
    remoteExists ? ["branch", "--track", branchName, startPoint] : ["branch", branchName, startPoint],
    store
  );
  return branchName;
}

export async function checkoutBranch(
  repoPath: string,
  branchName: string,
  worktreePath: string,
  store?: AppStore
): Promise<string> {
  const branch = branchName.trim();
  await assertLocalBranchExists(repoPath, branch, store);
  await assertBranchAvailableForCheckout(repoPath, branch, worktreePath, store);
  await runGit(worktreePath, ["switch", branch], store);
  return branch;
}

export async function handoffWorktreeBranchToLocal(
  repoPath: string,
  sourceWorktreePath: string,
  store?: AppStore
): Promise<{ branch: string; localPath: string; detachedWorktreePath: string; movedChanges: boolean }> {
  const source = await findWorktreeByPath(repoPath, sourceWorktreePath, repoPath, store);
  if (!source) {
    throw new Error("A worktree selecionada não pertence a este repositório.");
  }

  const localPath = await comparablePath(repoPath);
  const sourcePath = await comparablePath(source.path);
  if (localPath === sourcePath) {
    throw new Error("Esta worktree já é o workspace local.");
  }

  if (!source.branch || source.detached || source.bare) {
    throw new Error("A worktree selecionada não tem uma branch local para handoff.");
  }

  if (await hasLocalChanges(repoPath, store)) {
    throw new Error("O workspace local tem alterações por guardar. Limpa ou guarda essas alterações antes do checkout local.");
  }

  const branch = source.branch;
  const sourceStash = (await hasLocalChanges(source.path, store))
    ? await stashLocalChanges(source.path, `worktree-manager worktree-to-local ${randomUUID()}`, store)
    : null;

  try {
    await runGit(source.path, ["switch", "--detach"], store);
  } catch (error) {
    if (sourceStash) await restoreStash(source.path, sourceStash, store);
    throw error;
  }

  try {
    await runGit(repoPath, ["switch", branch], store);
  } catch (error) {
    await runGit(source.path, ["switch", branch], store, { allowFailure: true });
    if (sourceStash) await restoreStash(source.path, sourceStash, store);
    throw error;
  }

  if (sourceStash) {
    await applyStashOrThrow(repoPath, sourceStash, store);
    await dropStash(repoPath, sourceStash, store);
  }

  return {
    branch,
    localPath: repoPath,
    detachedWorktreePath: source.path,
    movedChanges: Boolean(sourceStash)
  };
}

export async function moveLocalBranchToWorktree(
  repo: Pick<RepoRecord, "name" | "path">,
  options: { name?: string | null; path?: string | null; basePath?: string | null } = {},
  store?: AppStore,
  runtimeOptions: { safeMode?: boolean } = {}
): Promise<LocalBranchWorktreeResult> {
  const branch = await getCheckedOutBranch(repo.path, store);
  if (!branch) {
    throw new Error("O workspace local está em detached HEAD.");
  }

  if (isBaseBranch(branch)) {
    throw new Error("A branch local atual já é main/master.");
  }

  const baseBranch = await getLocalBaseBranch(repo.path, store);
  if (!baseBranch) {
    throw new Error("Não encontrei uma branch local main ou master para deixar no workspace local.");
  }

  const preferredWorktreePath = resolveWorktreeTargetPath(
    repo,
    branch,
    options.name,
    options.path,
    options.basePath
  );
  const preferredPathExists = await pathExists(preferredWorktreePath);
  const preferredWorktree = preferredPathExists
    ? await findWorktreeByPath(repo.path, preferredWorktreePath, repo.path, store)
    : null;
  const reusableWorktree =
    preferredWorktree ??
    (options.path ? null : await findReusableDetachedWorktreeForBranch(repo.path, branch, store));

  if (options.path && preferredPathExists && !preferredWorktree) {
    throw new Error(`Já existe uma pasta com esse nome: ${preferredWorktreePath}`);
  }

  if (!options.path && preferredPathExists && !preferredWorktree && !reusableWorktree) {
    throw new Error(`Já existe uma pasta com esse nome: ${preferredWorktreePath}`);
  }

  if (reusableWorktree) {
    const localPath = await comparablePath(repo.path);
    const targetPath = await comparablePath(reusableWorktree.path);
    if (localPath === targetPath) {
      throw new Error("A worktree de destino não pode ser o workspace local.");
    }

    if (reusableWorktree.branch) {
      throw new Error(
        `Já existe uma worktree nesse caminho com a branch ${reusableWorktree.branch}.`
      );
    }

    if (reusableWorktree.bare) {
      throw new Error("A worktree de destino não pode ser bare.");
    }
  }

  const localStash = (await hasLocalChanges(repo.path, store))
    ? await stashLocalChanges(repo.path, `worktree-manager local-to-worktree ${randomUUID()}`, store)
    : null;
  const finalWorktreePath = reusableWorktree?.path ?? preferredWorktreePath;
  let worktreeStash: StashHandle | null = null;

  if (runtimeOptions.safeMode && reusableWorktree) {
    await assertNoConflictsForSafeOperation(finalWorktreePath, "mover para worktree", store);
  }

  try {
    await runGit(repo.path, ["switch", baseBranch], store);
  } catch (error) {
    if (localStash) await restoreStash(repo.path, localStash, store);
    throw error;
  }

  try {
    if (reusableWorktree) {
      worktreeStash = (await hasLocalChanges(finalWorktreePath, store))
        ? await stashLocalChanges(finalWorktreePath, `worktree-manager existing-worktree ${randomUUID()}`, store)
        : null;
      await runGit(finalWorktreePath, ["switch", branch], store);
    } else {
      await fs.mkdir(path.dirname(finalWorktreePath), { recursive: true });
      await runGit(repo.path, ["worktree", "add", finalWorktreePath, branch], store);
    }
  } catch (error) {
    if (worktreeStash) await restoreStash(finalWorktreePath, worktreeStash, store);
    if (localStash) {
      await runGit(repo.path, ["switch", branch], store, { allowFailure: true });
      await restoreStash(repo.path, localStash, store);
    }
    throw error;
  }

  if (worktreeStash) {
    await applyStashOrThrow(finalWorktreePath, worktreeStash, store);
    await dropStash(finalWorktreePath, worktreeStash, store);
  }

  if (localStash) {
    await applyStashOrThrow(finalWorktreePath, localStash, store);
    await dropStash(finalWorktreePath, localStash, store);
  }

  return {
    branch,
    baseBranch,
    localPath: repo.path,
    worktreePath: finalWorktreePath,
    movedChanges: Boolean(localStash)
  };
}

function resolveWorktreeTargetPath(
  repo: Pick<RepoRecord, "name" | "path">,
  branch: string,
  name?: string | null,
  requestedPath?: string | null,
  basePath?: string | null
): string {
  if (requestedPath?.trim()) {
    return path.resolve(requestedPath);
  }

  const directory = basePath?.trim() ? path.resolve(basePath) : path.dirname(repo.path);
  const folderName = name ? sanitizeFilePart(name) : defaultWorktreeName(repo.name, branch);
  return path.join(directory, folderName);
}

export async function getWorktrees(
  repoPath: string,
  focusedPath = repoPath,
  store?: AppStore
): Promise<WorktreeRecord[]> {
  const porcelain = await runGit(repoPath, ["worktree", "list", "--porcelain"], store, {
    record: false
  });
  const worktrees = parseWorktreePorcelain(porcelain.stdout, focusedPath);

  return Promise.all(
    worktrees.map(async (worktree) => {
      if (worktree.bare || !worktree.path) {
        return {
          ...worktree,
          lastCommit: null,
          status: summarizeFileStatuses([])
        };
      }

      const [lastCommitResult, statusResult, upstream] = await Promise.all([
        runGit(worktree.path, ["log", "-1", "--format=%h%x09%cI%x09%s"], store, {
          allowFailure: true,
          record: false
        }),
        runGit(worktree.path, ["status", "--porcelain=v1", "-uall"], store, {
          allowFailure: true,
          record: false
        }),
        getUpstreamBranch(worktree.path, store)
      ]);

      const files = statusResult.exitCode === 0 ? parseStatusPorcelain(statusResult.stdout) : [];
      const sync = upstream ? await getAheadBehind(worktree.path, upstream, store) : { ahead: 0, behind: 0 };

      return {
        ...worktree,
        lastCommit: parseCommitLine(lastCommitResult.stdout),
        status: summarizeFileStatuses(files),
        upstream,
        ahead: sync.ahead,
        behind: sync.behind
      };
    })
  );
}

export async function getBranches(
  repoPath: string,
  store?: AppStore
): Promise<BranchRecord[]> {
  const currentBranch = await getCurrentBranch(repoPath, store);
  const refs = await runGit(
    repoPath,
    [
      "for-each-ref",
      "--format=%(refname)%09%(refname:short)%09%(upstream:short)%09%(objectname:short)%09%(committerdate:iso-strict)%09%(contents:subject)",
      "refs/heads",
      "refs/remotes"
    ],
    store,
    { record: false }
  );

  const branches = parseBranchRefs(refs.stdout, currentBranch);

  return Promise.all(
    branches.map(async (branch) => {
      if (branch.isRemote || !branch.upstream) {
        return { ...branch, ahead: 0, behind: 0 };
      }

      const sync = await getAheadBehindRefs(repoPath, branch.name, branch.upstream, store);
      return { ...branch, ahead: sync.ahead, behind: sync.behind };
    })
  );
}

export async function getRepoDetail(
  repo: RepoRecord,
  focusedPath = repo.path,
  store?: AppStore
): Promise<RepoDetail> {
  const [allWorktrees, statusResult, branch, upstream, lastFetchAt, stashCount] = await Promise.all([
    getWorktrees(repo.path, focusedPath, store),
    runGit(focusedPath, ["status", "--porcelain=v1", "-uall"], store, { record: false }),
    getCheckedOutBranch(focusedPath, store),
    getUpstreamBranch(focusedPath, store),
    getLastFetchAt(focusedPath, store),
    getStashCount(repo.path, store)
  ]);
  const worktree =
    allWorktrees.find((item) => path.resolve(item.path) === path.resolve(focusedPath)) ??
    allWorktrees.find((item) => item.isCurrent);
  if (!worktree) {
    throw new Error("A worktree selecionada não pertence a este repositório.");
  }

  const sync = upstream ? await getAheadBehind(focusedPath, upstream, store) : { ahead: 0, behind: 0 };
  const files = parseStatusPorcelain(statusResult.stdout);
  const worktrees = await visibleWorktreesForRepo(repo.id, allWorktrees, store);

  return {
    repo,
    worktree,
    branch,
    upstream,
    ahead: sync.ahead,
    behind: sync.behind,
    lastFetchAt,
    stashCount,
    status: summarizeFileStatuses(files),
    files,
    worktrees,
    lastUpdatedAt: new Date().toISOString()
  };
}

export async function getRepoReview(
  repo: RepoRecord,
  focusedPath = repo.path,
  store?: AppStore
): Promise<ReviewDiffResponse> {
  const [worktrees, statusResult, branch] = await Promise.all([
    getWorktrees(repo.path, focusedPath, store),
    runGit(focusedPath, ["status", "--porcelain=v1", "-uall"], store, { record: false }),
    getCheckedOutBranch(focusedPath, store)
  ]);
  const worktree =
    worktrees.find((item) => path.resolve(item.path) === path.resolve(focusedPath)) ??
    worktrees.find((item) => item.isCurrent);
  if (!worktree) {
    throw new Error("A worktree selecionada não pertence a este repositório.");
  }

  const statusFiles = parseStatusPorcelain(statusResult.stdout);
  const reviewInputs = await buildReviewDiffInputs(focusedPath, statusFiles, store);
  const files = (
    await Promise.all(
      reviewInputs.map(({ file, mode }) => buildReviewDiffFile(focusedPath, file, mode, store))
    )
  ).sort(compareReviewDiffFiles);

  return {
    repo,
    worktree,
    branch,
    status: summarizeFileStatuses(statusFiles),
    files,
    generatedAt: new Date().toISOString()
  };
}

async function buildReviewDiffInputs(
  worktreePath: string,
  statusFiles: GitFileStatus[],
  store?: AppStore
): Promise<ReviewDiffInput[]> {
  const inputs: ReviewDiffInput[] = statusFiles.flatMap((file) =>
    reviewModesForFile(file).map((mode) => ({ file, mode }))
  );
  const seen = new Set(inputs.map(reviewDiffInputKey));

  const [stagedPaths, unstagedPaths] = await Promise.all([
    changedPathsForDiffMode(worktreePath, "staged", store),
    changedPathsForDiffMode(worktreePath, "unstaged", store)
  ]);

  for (const filePath of stagedPaths) {
    const input = { file: syntheticReviewStatus(filePath, "staged"), mode: "staged" as DiffMode };
    if (!seen.has(reviewDiffInputKey(input))) {
      inputs.push(input);
      seen.add(reviewDiffInputKey(input));
    }
  }

  for (const filePath of unstagedPaths) {
    const input = { file: syntheticReviewStatus(filePath, "unstaged"), mode: "unstaged" as DiffMode };
    if (!seen.has(reviewDiffInputKey(input))) {
      inputs.push(input);
      seen.add(reviewDiffInputKey(input));
    }
  }

  return inputs;
}

async function changedPathsForDiffMode(
  worktreePath: string,
  mode: Exclude<DiffMode, "untracked">,
  store?: AppStore
): Promise<string[]> {
  const args = mode === "staged"
    ? ["diff", "--cached", "--no-ext-diff", "--name-only", "--"]
    : ["diff", "--no-ext-diff", "--name-only", "--"];
  const result = await runGit(worktreePath, args, store, {
    record: false,
    allowFailure: true,
    timeoutMs: 120_000
  });

  if (result.exitCode !== 0) return [];

  return result.stdout
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => decodeGitPath(line))
    .filter(Boolean);
}

function syntheticReviewStatus(filePath: string, mode: Exclude<DiffMode, "untracked">): GitFileStatus {
  return {
    path: filePath,
    originalPath: null,
    indexStatus: mode === "staged" ? "M" : " ",
    worktreeStatus: mode === "unstaged" ? "M" : " ",
    label: "Modificado"
  };
}

function reviewDiffInputKey(input: ReviewDiffInput): string {
  return `${input.mode}:${input.file.path}`;
}

function reviewModesForFile(file: GitFileStatus): DiffMode[] {
  if (file.indexStatus === "?" && file.worktreeStatus === "?") return ["untracked"];

  const modes: DiffMode[] = [];
  if (file.indexStatus.trim()) modes.push("staged");
  if (file.worktreeStatus.trim()) modes.push("unstaged");
  return modes;
}

function compareReviewDiffFiles(left: ReviewDiffFile, right: ReviewDiffFile): number {
  const modeCompare = reviewModeOrder(left.mode) - reviewModeOrder(right.mode);
  if (modeCompare !== 0) return modeCompare;
  return left.path.localeCompare(right.path);
}

function reviewModeOrder(mode: DiffMode): number {
  if (mode === "staged") return 0;
  if (mode === "unstaged") return 1;
  return 2;
}

async function buildReviewDiffFile(
  worktreePath: string,
  file: GitFileStatus,
  mode: DiffMode,
  store?: AppStore
): Promise<ReviewDiffFile> {
  if (mode === "untracked") {
    return buildUntrackedReviewFile(worktreePath, file);
  }

  const args = mode === "staged"
    ? ["diff", "--cached", "--no-ext-diff", "--unified=3", "--", file.path]
    : ["diff", "--no-ext-diff", "--unified=3", "--", file.path];
  const result = await runGit(worktreePath, args, store, {
    record: false,
    allowFailure: true,
    timeoutMs: 120_000
  });

  if (result.exitCode !== 0) {
    return emptyReviewFile(file, mode, result.stderr.trim() || "Não foi possível gerar o diff.");
  }

  const parsed = parseUnifiedDiff(result.stdout);
  return {
    ...emptyReviewFile(file, mode, null),
    ...parsed
  };
}

async function buildUntrackedReviewFile(worktreePath: string, file: GitFileStatus): Promise<ReviewDiffFile> {
  const absolutePath = path.resolve(worktreePath, file.path);
  if (!isPathInside(worktreePath, absolutePath)) {
    return emptyReviewFile(file, "untracked", "O ficheiro está fora da worktree.");
  }

  const baseFile = emptyReviewFile(file, "untracked", null);
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      return { ...baseFile, error: "O caminho não é um ficheiro regular." };
    }
    if (stat.size > MAX_REVIEW_FILE_BYTES) {
      return { ...baseFile, tooLarge: true, error: "Ficheiro demasiado grande para pré-visualização." };
    }

    const content = await fs.readFile(absolutePath);
    if (isBinaryBuffer(content)) {
      return { ...baseFile, binary: true, error: "Ficheiro binário não pré-visualizável." };
    }

    const allLines = content.toString("utf8").replace(/\r\n/g, "\n").split("\n");
    if (allLines.at(-1) === "") allLines.pop();
    const lines = allLines.slice(0, MAX_REVIEW_UNTRACKED_LINES);
    const truncated = allLines.length > lines.length;
    const diffLines: ReviewDiffLine[] = lines.map((line, index) => ({
      type: "add",
      oldLineNumber: null,
      newLineNumber: index + 1,
      content: line
    }));

    const hunk: ReviewDiffHunk = {
      header: `@@ -0,0 +1,${diffLines.length} @@`,
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: diffLines.length,
      lines: diffLines
    };

    return {
      ...baseFile,
      truncated,
      additions: diffLines.length,
      hunks: diffLines.length ? [hunk] : []
    };
  } catch (error) {
    return { ...baseFile, error: errorMessage(error) };
  }
}

function emptyReviewFile(file: GitFileStatus, mode: DiffMode, error: string | null): ReviewDiffFile {
  return {
    id: `${mode}:${file.path}`,
    path: file.path,
    originalPath: file.originalPath,
    mode,
    statusLabel: file.label,
    binary: false,
    tooLarge: false,
    truncated: false,
    additions: 0,
    deletions: 0,
    hunks: [],
    error
  };
}

export function parseUnifiedDiff(stdout: string): Pick<
  ReviewDiffFile,
  "hunks" | "additions" | "deletions" | "binary" | "tooLarge" | "truncated" | "error"
> {
  if (/^Binary files /m.test(stdout) || /^GIT binary patch$/m.test(stdout)) {
    return {
      hunks: [],
      additions: 0,
      deletions: 0,
      binary: true,
      tooLarge: false,
      truncated: false,
      error: "Ficheiro binário não pré-visualizável."
    };
  }

  const hunks: ReviewDiffHunk[] = [];
  let currentHunk: ReviewDiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let additions = 0;
  let deletions = 0;

  for (const rawLine of stdout.replace(/\r\n/g, "\n").split("\n")) {
    const hunkMatch = rawLine.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/);
    if (hunkMatch) {
      currentHunk = {
        header: rawLine,
        oldStart: Number(hunkMatch[1]),
        oldLines: Number(hunkMatch[2] ?? "1"),
        newStart: Number(hunkMatch[3]),
        newLines: Number(hunkMatch[4] ?? "1"),
        lines: []
      };
      oldLine = currentHunk.oldStart;
      newLine = currentHunk.newStart;
      hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk) continue;

    if (rawLine.startsWith("\\ No newline")) {
      currentHunk.lines.push({ type: "meta", oldLineNumber: null, newLineNumber: null, content: rawLine });
      continue;
    }

    const marker = rawLine[0] ?? " ";
    const content = rawLine.slice(1);
    if (marker === "+") {
      currentHunk.lines.push({ type: "add", oldLineNumber: null, newLineNumber: newLine, content });
      newLine += 1;
      additions += 1;
      continue;
    }
    if (marker === "-") {
      currentHunk.lines.push({ type: "delete", oldLineNumber: oldLine, newLineNumber: null, content });
      oldLine += 1;
      deletions += 1;
      continue;
    }
    if (marker === " ") {
      currentHunk.lines.push({ type: "context", oldLineNumber: oldLine, newLineNumber: newLine, content });
      oldLine += 1;
      newLine += 1;
      continue;
    }

    currentHunk.lines.push({ type: "meta", oldLineNumber: null, newLineNumber: null, content: rawLine });
  }

  return {
    hunks,
    additions,
    deletions,
    binary: false,
    tooLarge: false,
    truncated: false,
    error: null
  };
}

function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 8000)).includes(0);
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative === "" || (Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative));
}

async function visibleWorktreesForRepo(
  repoId: string,
  worktrees: WorktreeRecord[],
  store?: AppStore
): Promise<WorktreeRecord[]> {
  if (!store) return worktrees;
  const archivedIds = new Set((await store.listArchivedWorktrees(repoId)).map((worktree) => worktree.worktreeId));
  if (!archivedIds.size) return worktrees;
  return worktrees.filter((worktree) => !archivedIds.has(worktree.id));
}

export async function getRepoSummary(
  repo: { id: string; name: string; path: string; lastOpenedAt: string },
  focusedPath = repo.path,
  store?: AppStore
): Promise<RepoSummary> {
  const [gitVersion, currentBranch, allWorktrees, branches, commits, stashCount] = await Promise.all([
    runGit(focusedPath, ["--version"], store, { record: false }),
    getCurrentBranch(focusedPath, store),
    getWorktrees(repo.path, focusedPath, store),
    getBranches(focusedPath, store),
    runGit(repo.path, ["rev-list", "--count", "--all"], store, {
      allowFailure: true,
      record: false
    }),
    getStashCount(repo.path, store)
  ]);
  const worktrees = await visibleWorktreesForRepo(repo.id, allWorktrees, store);
  const changedFileCount = worktrees.reduce(
    (total, worktree) => total + (worktree.status?.total ?? 0),
    0
  );
  const dirtyWorktreeCount = worktrees.filter((worktree) => worktree.status && !worktree.status.clean).length;
  const localBranches = branches.filter((branch) => !branch.isRemote);
  const focusedBranch = localBranches.find((branch) => branch.name === currentBranch);
  const branchAheadCount = localBranches.filter((branch) => (branch.ahead ?? 0) > 0).length;
  const branchBehindCount = localBranches.filter((branch) => (branch.behind ?? 0) > 0).length;

  return {
    repo,
    valid: true,
    gitVersion: gitVersion.stdout.trim(),
    focusedWorktreePath: focusedPath,
    currentBranch,
    commitCount: Number.parseInt(commits.stdout.trim(), 10) || 0,
    branchCount: branches.filter((branch) => !branch.isRemote).length,
    worktreeCount: worktrees.length,
    dirtyWorktreeCount,
    changedFileCount,
    stashCount,
    ahead: focusedBranch?.ahead ?? 0,
    behind: focusedBranch?.behind ?? 0,
    branchAheadCount,
    branchBehindCount,
    lastUpdatedAt: new Date().toISOString()
  };
}

export async function getCurrentBranch(repoPath: string, store?: AppStore): Promise<string> {
  const branchName = await getCheckedOutBranch(repoPath, store);
  if (branchName) return branchName;

  const head = await runGit(repoPath, ["rev-parse", "--short", "HEAD"], store, {
    allowFailure: true,
    record: false
  });
  return head.stdout.trim() ? `detached ${head.stdout.trim()}` : "desconhecida";
}

export function defaultWorktreeName(repoName: string, branchName: string): string {
  return `${sanitizeFilePart(repoName)}-${sanitizeFilePart(branchName)}`;
}

export function sanitizeFilePart(value: string): string {
  const normalized = value
    .trim()
    .replace(/\\/g, "-")
    .replace(/\//g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "worktree";
}

async function getCheckedOutBranch(repoPath: string, store?: AppStore): Promise<string | null> {
  const branch = await runGit(repoPath, ["branch", "--show-current"], store, {
    allowFailure: true,
    record: false
  });
  const branchName = branch.stdout.trim();
  return branchName || null;
}

async function assertValidBranchName(repoPath: string, branchName: string, store?: AppStore): Promise<void> {
  if (!branchName) {
    throw new Error("O nome da branch não pode estar vazio.");
  }

  const result = await runGit(repoPath, ["check-ref-format", "--branch", branchName], store, {
    allowFailure: true,
    record: false
  });
  if (result.exitCode !== 0) {
    throw new Error(`Nome de branch inválido: ${branchName}`);
  }
}

async function assertBranchDoesNotExist(repoPath: string, branchName: string, store?: AppStore): Promise<void> {
  if (await localBranchExists(repoPath, branchName, store)) {
    throw new Error(`A branch local "${branchName}" já existe.`);
  }
}

async function assertLocalBranchExists(repoPath: string, branchName: string, store?: AppStore): Promise<void> {
  if (!(await localBranchExists(repoPath, branchName, store))) {
    throw new Error(`A branch local "${branchName}" não existe.`);
  }
}

async function assertRefExists(repoPath: string, refName: string, store?: AppStore): Promise<void> {
  const result = await runGit(repoPath, ["rev-parse", "--verify", "--quiet", refName], store, {
    allowFailure: true,
    record: false
  });
  if (result.exitCode !== 0) {
    throw new Error(`A referência "${refName}" não existe.`);
  }
}

async function resolveBranchSource(repoPath: string, branchName: string, store?: AppStore): Promise<BranchSource> {
  if (await localBranchExists(repoPath, branchName, store)) {
    return { kind: "local", branch: branchName };
  }

  if (await remoteBranchExists(repoPath, branchName, store)) {
    const localBranch = localBranchNameFromRemote(branchName);
    await assertValidBranchName(repoPath, localBranch, store);
    if (await localBranchExists(repoPath, localBranch, store)) {
      return { kind: "local", branch: localBranch };
    }
    return { kind: "remote", branch: branchName, localBranch };
  }

  throw new Error(`A branch ou ref "${branchName}" não existe.`);
}

async function localBranchExists(repoPath: string, branchName: string, store?: AppStore): Promise<boolean> {
  return refExists(repoPath, `refs/heads/${branchName}`, store);
}

async function remoteBranchExists(repoPath: string, branchName: string, store?: AppStore): Promise<boolean> {
  if (branchName.endsWith("/HEAD")) return false;
  return refExists(repoPath, `refs/remotes/${branchName}`, store);
}

async function refExists(repoPath: string, fullRef: string, store?: AppStore): Promise<boolean> {
  const result = await runGit(repoPath, ["show-ref", "--verify", "--quiet", fullRef], store, {
    allowFailure: true,
    record: false
  });
  return result.exitCode === 0;
}

async function assertBranchAvailableForCheckout(
  repoPath: string,
  branchName: string,
  targetPath: string | null,
  store?: AppStore
): Promise<void> {
  const porcelain = await runGit(repoPath, ["worktree", "list", "--porcelain"], store, {
    record: false
  });
  const target = targetPath ? path.resolve(targetPath) : null;
  const occupied = parseWorktreePorcelain(porcelain.stdout, targetPath ?? repoPath).find((worktree) => {
    if (worktree.branch !== branchName) return false;
    if (!target) return true;
    return path.resolve(worktree.path) !== target;
  });

  if (occupied) {
    throw new Error(`A branch "${branchName}" já está checked out em ${occupied.path}.`);
  }
}

function localBranchNameFromRemote(remoteBranch: string): string {
  const [, ...rest] = remoteBranch.split("/");
  return rest.join("/") || remoteBranch;
}

async function getLocalBaseBranch(repoPath: string, store?: AppStore): Promise<string | null> {
  const refs = await runGit(
    repoPath,
    ["for-each-ref", "--format=%(refname:short)", "refs/heads/main", "refs/heads/master"],
    store,
    { record: false }
  );
  const names = new Set(refs.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  return names.has("main") ? "main" : names.has("master") ? "master" : null;
}

async function getUpstreamBranch(repoPath: string, store?: AppStore): Promise<string | null> {
  const upstream = await runGit(
    repoPath,
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    store,
    { allowFailure: true, record: false }
  );
  const value = upstream.stdout.trim();
  return upstream.exitCode === 0 && value ? value : null;
}

async function getAheadBehind(
  repoPath: string,
  upstream: string,
  store?: AppStore
): Promise<{ ahead: number; behind: number }> {
  return getAheadBehindRefs(repoPath, "HEAD", upstream, store);
}

async function getAheadBehindRefs(
  repoPath: string,
  leftRef: string,
  rightRef: string,
  store?: AppStore
): Promise<{ ahead: number; behind: number }> {
  const result = await runGit(repoPath, ["rev-list", "--left-right", "--count", `${leftRef}...${rightRef}`], store, {
    allowFailure: true,
    record: false
  });
  const [ahead, behind] = result.stdout.trim().split(/\s+/).map((value) => Number.parseInt(value, 10));
  return {
    ahead: Number.isFinite(ahead) ? ahead : 0,
    behind: Number.isFinite(behind) ? behind : 0
  };
}

async function getLastFetchAt(repoPath: string, store?: AppStore): Promise<string | null> {
  const gitPath = await runGit(repoPath, ["rev-parse", "--git-path", "FETCH_HEAD"], store, {
    allowFailure: true,
    record: false
  });
  const value = gitPath.stdout.trim();
  if (!value) return null;

  const fetchHeadPath = path.isAbsolute(value) ? value : path.resolve(repoPath, value);
  try {
    const stat = await fs.stat(fetchHeadPath);
    return stat.mtime.toISOString();
  } catch {
    return null;
  }
}

async function hasLocalChanges(repoPath: string, store?: AppStore): Promise<boolean> {
  const status = await runGit(repoPath, ["status", "--porcelain=v1", "-uall"], store, {
    record: false
  });
  return Boolean(status.stdout.trim());
}

async function getWorktreeStatusSummary(repoPath: string, store?: AppStore): Promise<GitStatusSummary> {
  const status = await runGit(repoPath, ["status", "--porcelain=v1", "-uall"], store, {
    record: false
  });
  return summarizeFileStatuses(parseStatusPorcelain(status.stdout));
}

async function getStashCount(repoPath: string, store?: AppStore): Promise<number> {
  const stashList = await runGit(repoPath, ["stash", "list", "--format=%gd"], store, {
    allowFailure: true,
    record: false
  });

  if (stashList.exitCode !== 0) return 0;

  return stashList.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

async function stashLocalChanges(
  repoPath: string,
  stashMessage: string,
  store?: AppStore
): Promise<StashHandle> {
  await runGit(repoPath, ["stash", "push", "--include-untracked", "--message", stashMessage], store);
  const stashRef = await findStashRef(repoPath, stashMessage, store);
  if (!stashRef) {
    throw new Error("Não consegui identificar a stash temporária das alterações locais.");
  }

  return { message: stashMessage };
}

async function findStashRef(
  repoPath: string,
  stashMessage: string,
  store?: AppStore
): Promise<string | null> {
  const list = await runGit(repoPath, ["stash", "list", "--format=%gd%x09%s"], store, {
    record: false
  });
  const line = list.stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.endsWith(stashMessage));

  return line?.split("\t")[0] ?? null;
}

async function applyStashOrThrow(repoPath: string, stash: StashHandle, store?: AppStore): Promise<void> {
  const stashRef = await findStashRef(repoPath, stash.message, store);
  if (!stashRef) {
    throw new Error("Não encontrei a stash temporária para aplicar.");
  }

  const applied = await runGit(repoPath, ["stash", "apply", "--index", stashRef], store, {
    allowFailure: true
  });
  if (applied.exitCode !== 0) {
    throw new GitCommandError({
      ...applied,
      stderr:
        applied.stderr.trim() ||
        `Não consegui reaplicar as alterações guardadas em ${stashRef}. A stash temporária foi mantida.`
    });
  }
}

async function dropStash(repoPath: string, stash: StashHandle, store?: AppStore): Promise<void> {
  const stashRef = await findStashRef(repoPath, stash.message, store);
  if (stashRef) {
    await runGit(repoPath, ["stash", "drop", stashRef], store);
  }
}

async function restoreStash(repoPath: string, stash: StashHandle, store?: AppStore): Promise<boolean> {
  const stashRef = await findStashRef(repoPath, stash.message, store);
  if (!stashRef) return false;

  const applied = await runGit(repoPath, ["stash", "apply", "--index", stashRef], store, {
    allowFailure: true
  });
  if (applied.exitCode !== 0) return false;

  await runGit(repoPath, ["stash", "drop", stashRef], store, { allowFailure: true });
  return true;
}

function isBaseBranch(branch: string): boolean {
  return branch === "main" || branch === "master";
}

function isProtectedBranch(branch: string): boolean {
  return branch === "main" || branch === "master";
}

function summarizeFileStatuses(files: GitFileStatus[]): GitStatusSummary {
  const summary = files.reduce<GitStatusSummary>(
    (totals, file) => {
      const conflicted = isConflictStatus(file.indexStatus, file.worktreeStatus);
      return {
        staged: totals.staged + (isStagedStatus(file.indexStatus) ? 1 : 0),
        unstaged: totals.unstaged + (isUnstagedStatus(file.worktreeStatus) ? 1 : 0),
        untracked: totals.untracked + (file.indexStatus === "?" && file.worktreeStatus === "?" ? 1 : 0),
        conflicted: totals.conflicted + (conflicted ? 1 : 0),
        total: totals.total + 1,
        clean: false
      };
    },
    { staged: 0, unstaged: 0, untracked: 0, conflicted: 0, total: 0, clean: true }
  );

  return { ...summary, clean: summary.total === 0 };
}

function isStagedStatus(status: string): boolean {
  return status !== " " && status !== "?" && status !== "U";
}

function isUnstagedStatus(status: string): boolean {
  return status !== " " && status !== "?" && status !== "U";
}

function isConflictStatus(indexStatus: string, worktreeStatus: string): boolean {
  return indexStatus === "U" || worktreeStatus === "U" || `${indexStatus}${worktreeStatus}` === "AA" || `${indexStatus}${worktreeStatus}` === "DD";
}

function fileStatusLabel(indexStatus: string, worktreeStatus: string): string {
  if (indexStatus === "?" && worktreeStatus === "?") return "Por seguir";
  if (isConflictStatus(indexStatus, worktreeStatus)) return "Conflito";
  if (indexStatus === "R") return "Renomeado";
  if (indexStatus === "A") return "Adicionado";
  if (indexStatus === "D" || worktreeStatus === "D") return "Removido";
  if (indexStatus === "M" || worktreeStatus === "M") return "Modificado";
  return "Alterado";
}

function formatSafeChangeCount(count: number): string {
  return count === 1 ? "1 alteração" : `${count} alterações`;
}

function formatSafeConflictCount(count: number): string {
  return count === 1 ? "1 conflito" : `${count} conflitos`;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findWorktreeByPath(
  repoPath: string,
  requestedPath: string,
  currentPath: string,
  store?: AppStore
): Promise<WorktreeRecord | null> {
  const requested = await comparablePath(requestedPath);
  const porcelain = await runGit(repoPath, ["worktree", "list", "--porcelain"], store, {
    record: false
  });
  const worktrees = parseWorktreePorcelain(porcelain.stdout, currentPath);

  for (const worktree of worktrees) {
    if ((await comparablePath(worktree.path)) === requested) {
      return worktree;
    }
  }

  return null;
}

async function findReusableDetachedWorktreeForBranch(
  repoPath: string,
  branch: string,
  store?: AppStore
): Promise<WorktreeRecord | null> {
  const branchHead = (await runGit(repoPath, ["rev-parse", branch], store, { record: false })).stdout.trim();
  const localPath = await comparablePath(repoPath);
  const porcelain = await runGit(repoPath, ["worktree", "list", "--porcelain"], store, {
    record: false
  });
  const worktrees = parseWorktreePorcelain(porcelain.stdout, repoPath);
  const candidates: WorktreeRecord[] = [];

  for (const worktree of worktrees) {
    const worktreePath = await comparablePath(worktree.path);
    if (
      worktreePath !== localPath &&
      worktree.detached &&
      !worktree.bare &&
      !worktree.branch &&
      worktree.head
    ) {
      if (worktree.head === branchHead) return worktree;
      candidates.push(worktree);
    }
  }

  let bestCandidate: { worktree: WorktreeRecord; distance: number } | null = null;
  for (const worktree of candidates) {
    const isAncestor = await runGit(repoPath, ["merge-base", "--is-ancestor", worktree.head!, branchHead], store, {
      allowFailure: true,
      record: false
    });
    if (isAncestor.exitCode !== 0) continue;

    const distanceResult = await runGit(repoPath, ["rev-list", "--count", `${worktree.head}..${branchHead}`], store, {
      allowFailure: true,
      record: false
    });
    const distance = Number(distanceResult.stdout.trim());
    const normalizedDistance = Number.isFinite(distance) ? distance : Number.MAX_SAFE_INTEGER;
    if (!bestCandidate || normalizedDistance < bestCandidate.distance) {
      bestCandidate = { worktree, distance: normalizedDistance };
    }
  }

  return bestCandidate?.worktree ?? null;
}

async function comparablePath(value: string): Promise<string> {
  return fs.realpath(path.resolve(value)).catch(() => path.resolve(value));
}

function parseCommitLine(stdout: string): CommitInfo | null {
  const line = stdout.trim();
  if (!line) return null;

  const [sha, date, ...subjectParts] = line.split("\t");
  return {
    sha,
    date: date || null,
    subject: subjectParts.join("\t") || "Sem mensagem de commit"
  };
}

function firstLine(value: string): string {
  return value
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 240) ?? "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Erro inesperado.";
}

function summarizeGitResult(result: GitResult): string {
  const command = `git ${result.args.join(" ")}`;
  if (result.timedOut) return `${command} excedeu ${result.timeoutMs}ms`;
  if (result.exitCode === 0) return firstLine(result.stdout) || `${command} concluído`;
  return firstLine(result.stderr) || `${command} falhou`;
}

function limitOperationLog(value: string): { value: string; truncated: boolean } {
  const normalized = value.trimEnd();
  if (normalized.length <= MAX_OPERATION_LOG_CHARS) {
    return { value: normalized, truncated: false };
  }

  return {
    value: `${normalized.slice(0, MAX_OPERATION_LOG_CHARS)}\n\n[log truncado]`,
    truncated: true
  };
}
