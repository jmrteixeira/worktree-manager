import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  BranchRecord,
  CommitInfo,
  GitFileStatus,
  GitStatusSummary,
  LocalBranchWorktreeResult,
  RepoDetail,
  RepoRecord,
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

const MAX_OPERATION_LOG_CHARS = 20_000;

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
          worktree.path = value;
          worktree.id = encodePathId(value);
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
          path: line.slice(3),
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
      const originalPath = renameParts.length > 1 ? renameParts[0] : null;
      const filePath = renameParts.length > 1 ? renameParts.slice(1).join(" -> ") : rawPath;

      return {
        path: filePath,
        originalPath,
        indexStatus,
        worktreeStatus,
        label: fileStatusLabel(indexStatus, worktreeStatus)
      } satisfies GitFileStatus;
    });
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
  options: { name?: string | null; path?: string | null } = {},
  store?: AppStore
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

  const preferredWorktreePath = options.path
    ? path.resolve(options.path)
    : path.join(
        path.dirname(repo.path),
        options.name ? sanitizeFilePart(options.name) : defaultWorktreeName(repo.name, branch)
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
  const [worktrees, statusResult, branch, upstream, lastFetchAt, stashCount] = await Promise.all([
    getWorktrees(repo.path, focusedPath, store),
    runGit(focusedPath, ["status", "--porcelain=v1", "-uall"], store, { record: false }),
    getCheckedOutBranch(focusedPath, store),
    getUpstreamBranch(focusedPath, store),
    getLastFetchAt(focusedPath, store),
    getStashCount(repo.path, store)
  ]);
  const worktree =
    worktrees.find((item) => path.resolve(item.path) === path.resolve(focusedPath)) ??
    worktrees.find((item) => item.isCurrent);
  if (!worktree) {
    throw new Error("A worktree selecionada não pertence a este repositório.");
  }

  const sync = upstream ? await getAheadBehind(focusedPath, upstream, store) : { ahead: 0, behind: 0 };
  const files = parseStatusPorcelain(statusResult.stdout);

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

export async function getRepoSummary(
  repo: { id: string; name: string; path: string; lastOpenedAt: string },
  focusedPath = repo.path,
  store?: AppStore
): Promise<RepoSummary> {
  const [gitVersion, currentBranch, worktrees, branches, commits, stashCount] = await Promise.all([
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

  for (const worktree of worktrees) {
    const worktreePath = await comparablePath(worktree.path);
    if (
      worktreePath !== localPath &&
      worktree.detached &&
      !worktree.bare &&
      !worktree.branch &&
      worktree.head === branchHead
    ) {
      return worktree;
    }
  }

  return null;
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
