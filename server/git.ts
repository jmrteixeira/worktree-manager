import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  BranchRecord,
  CommitInfo,
  LocalBranchWorktreeResult,
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
  startedAt: string;
};

type RunGitOptions = {
  allowFailure?: boolean;
  timeoutMs?: number;
};

type StashHandle = {
  message: string;
};

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
  const timeoutMs = options.timeoutMs ?? 30_000;

  const result = await new Promise<GitResult>((resolve) => {
    const child = spawn("git", args, {
      cwd,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
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
        startedAt
      });
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ args, cwd, stdout, stderr, exitCode, startedAt });
    });
  });

  await store?.recordOperation({
    command: "git",
    args,
    cwd,
    startedAt: result.startedAt,
    status: result.exitCode === 0 ? "success" : "error",
    exitCode: result.exitCode,
    summary:
      result.exitCode === 0
        ? firstLine(result.stdout) || `git ${args.join(" ")} concluído`
        : firstLine(result.stderr) || `git ${args.join(" ")} falhou`,
    stderr: result.stderr.trim()
  });

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

  const result = await runGit(resolvedPath, ["rev-parse", "--show-toplevel"], store);
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
  const porcelain = await runGit(repoPath, ["worktree", "list", "--porcelain"], store);
  const worktrees = parseWorktreePorcelain(porcelain.stdout, focusedPath);

  return Promise.all(
    worktrees.map(async (worktree) => ({
      ...worktree,
      lastCommit:
        worktree.bare || !worktree.path
          ? null
          : parseCommitLine(
              (
                await runGit(
                  worktree.path,
                  ["log", "-1", "--format=%h%x09%cI%x09%s"],
                  store,
                  { allowFailure: true }
                )
              ).stdout
            )
    }))
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
    store
  );

  return parseBranchRefs(refs.stdout, currentBranch);
}

export async function getRepoSummary(
  repo: { id: string; name: string; path: string; lastOpenedAt: string },
  focusedPath = repo.path,
  store?: AppStore
): Promise<RepoSummary> {
  const [gitVersion, currentBranch, worktrees, branches, commits] = await Promise.all([
    runGit(focusedPath, ["--version"], store),
    getCurrentBranch(focusedPath, store),
    getWorktrees(repo.path, focusedPath, store),
    getBranches(focusedPath, store),
    runGit(repo.path, ["rev-list", "--count", "--all"], store, { allowFailure: true })
  ]);

  return {
    repo,
    valid: true,
    gitVersion: gitVersion.stdout.trim(),
    focusedWorktreePath: focusedPath,
    currentBranch,
    commitCount: Number.parseInt(commits.stdout.trim(), 10) || 0,
    branchCount: branches.filter((branch) => !branch.isRemote).length,
    worktreeCount: worktrees.length,
    lastUpdatedAt: new Date().toISOString()
  };
}

export async function getCurrentBranch(repoPath: string, store?: AppStore): Promise<string> {
  const branchName = await getCheckedOutBranch(repoPath, store);
  if (branchName) return branchName;

  const head = await runGit(repoPath, ["rev-parse", "--short", "HEAD"], store, {
    allowFailure: true
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
    allowFailure: true
  });
  const branchName = branch.stdout.trim();
  return branchName || null;
}

async function getLocalBaseBranch(repoPath: string, store?: AppStore): Promise<string | null> {
  const refs = await runGit(
    repoPath,
    ["for-each-ref", "--format=%(refname:short)", "refs/heads/main", "refs/heads/master"],
    store
  );
  const names = new Set(refs.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  return names.has("main") ? "main" : names.has("master") ? "master" : null;
}

async function hasLocalChanges(repoPath: string, store?: AppStore): Promise<boolean> {
  const status = await runGit(repoPath, ["status", "--porcelain=v1", "-uall"], store);
  return Boolean(status.stdout.trim());
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
  const list = await runGit(repoPath, ["stash", "list", "--format=%gd%x09%s"], store);
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
  const porcelain = await runGit(repoPath, ["worktree", "list", "--porcelain"], store);
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
  const branchHead = (await runGit(repoPath, ["rev-parse", branch], store)).stdout.trim();
  const localPath = await comparablePath(repoPath);
  const porcelain = await runGit(repoPath, ["worktree", "list", "--porcelain"], store);
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
