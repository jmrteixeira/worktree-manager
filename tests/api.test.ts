// @vitest-environment node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertCleanWorktreeForSafeOperation,
  checkoutBranch,
  createWorktree,
  defaultWorktreeName,
  getBranches,
  getRepoDetail,
  getRepoSummary,
  getWorktrees,
  handoffWorktreeBranchToLocal,
  moveLocalBranchToWorktree,
  resolveRepoWorktreePath,
  runGit,
  validateRepository
} from "../server/git";
import { buildOpenCommand, isAllowedOrigin, validateOpenTarget } from "../server/app";
import { getDiagnosticsSnapshot, recordDiagnosticEvent, summarizeOperationStats } from "../server/diagnostics";
import { AppStore } from "../server/store";
import type { OperationRecord } from "../src/types";

const execFileAsync = promisify(execFile);

describe("api", () => {
  let tmpDir: string;
  let repoDir: string;
  let store: AppStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "worktree-manager-"));
    repoDir = path.join(tmpDir, "repo");
    await fs.mkdir(repoDir);
    await git(repoDir, "init", "-b", "main");
    await git(repoDir, "config", "user.email", "test@example.com");
    await git(repoDir, "config", "user.name", "Test User");
    await fs.writeFile(path.join(repoDir, "README.md"), "# Test\n");
    await git(repoDir, "add", "README.md");
    await git(repoDir, "commit", "-m", "initial commit");

    store = new AppStore(path.join(tmpDir, "state.json"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("rejects a non-git repository", async () => {
    const plainDir = path.join(tmpDir, "plain");
    await fs.mkdir(plainDir);

    await expect(validateRepository(plainDir, store)).rejects.toThrow();
  });

  it("adds a repository and returns summary data", async () => {
    const topLevelPath = await validateRepository(repoDir, store);
    const repo = await store.upsertRepo(topLevelPath);

    const summary = await getRepoSummary(repo, repo.path, store);

    expect(summary).toMatchObject({
      valid: true,
      currentBranch: "main",
      commitCount: 1,
      branchCount: 1,
      worktreeCount: 1,
      dirtyWorktreeCount: 0,
      changedFileCount: 0,
      stashCount: 0
    });
    await expect(store.listOperations()).resolves.toEqual([]);
  });

  it("persists safe mode settings", async () => {
    await expect(store.getSettings()).resolves.toEqual({
      safeMode: true,
      locale: "pt",
      integrations: {
        editor: "auto",
        terminal: "auto"
      }
    });

    await expect(store.updateSettings({
      safeMode: false,
      locale: "en",
      integrations: {
        editor: "cursor",
        terminal: "iterm"
      }
    })).resolves.toEqual({
      safeMode: false,
      locale: "en",
      integrations: {
        editor: "cursor",
        terminal: "iterm"
      }
    });

    const reloadedStore = new AppStore(path.join(tmpDir, "state.json"));
    await expect(reloadedStore.getSettings()).resolves.toEqual({
      safeMode: false,
      locale: "en",
      integrations: {
        editor: "cursor",
        terminal: "iterm"
      }
    });
  });

  it("builds diagnostics snapshots and operation metrics", async () => {
    const operations: OperationRecord[] = [
      operationFixture("op-1", "success", 100, false, "2026-07-01T10:00:01.000Z"),
      operationFixture("op-2", "error", 2_000, true, "2026-07-01T10:00:02.000Z"),
      operationFixture("op-3", "success", 400, false, "2026-07-01T10:00:03.000Z")
    ];

    expect(summarizeOperationStats(operations)).toMatchObject({
      success: 2,
      error: 1,
      timedOut: 1,
      averageDurationMs: 833,
      p95DurationMs: 2_000,
      slowestDurationMs: 2_000,
      lastFailureAt: "2026-07-01T10:00:02.000Z"
    });

    const diagnosticEvent = await recordDiagnosticEvent(store, {
      level: "error",
      name: "ui_action_failed",
      message: "Ação falhou",
      detail: "Detalhe técnico",
      context: { page: "settings" }
    });
    const snapshot = await getDiagnosticsSnapshot(store, "node", "test-platform");

    expect(diagnosticEvent.command).toBe("app");
    expect(diagnosticEvent.args).toEqual(["diagnostic", "error", "ui_action_failed"]);
    expect(snapshot).toMatchObject({
      runtime: "node",
      platform: "test-platform",
      statePath: path.join(tmpDir, "state.json"),
      operationCount: 1,
      repositoryCount: 0,
      operationStats: {
        error: 1
      }
    });
  });

  it("blocks safe mode preflight when a worktree has uncommitted changes", async () => {
    const topLevelPath = await validateRepository(repoDir, store);
    const repo = await store.upsertRepo(topLevelPath);
    await fs.appendFile(path.join(repo.path, "README.md"), "dirty work\n");

    await expect(
      assertCleanWorktreeForSafeOperation(repo.path, "checkout de branch", store)
    ).rejects.toThrow("Modo seguro: checkout de branch bloqueado");
  });

  it("returns detail data for a dirty worktree", async () => {
    const topLevelPath = await validateRepository(repoDir, store);
    const repo = await store.upsertRepo(topLevelPath);
    await fs.appendFile(path.join(repo.path, "README.md"), "dirty work\n");
    await fs.writeFile(path.join(repo.path, "staged.txt"), "staged\n");
    await fs.writeFile(path.join(repo.path, "notes.txt"), "untracked\n");
    await git(repo.path, "add", "staged.txt");

    const detail = await getRepoDetail(repo, repo.path, store);

    expect(detail).toMatchObject({
      branch: "main",
      upstream: null,
      ahead: 0,
      behind: 0,
      stashCount: 0,
      status: {
        staged: 1,
        unstaged: 1,
        untracked: 1,
        conflicted: 0,
        total: 3,
        clean: false
      }
    });
    expect(detail.files.map((file) => file.path).sort()).toEqual(["README.md", "notes.txt", "staged.txt"]);
    expect(detail.worktree.path).toBe(repo.path);
    expect(detail.worktree.status).toMatchObject({
      staged: 1,
      unstaged: 1,
      untracked: 1,
      conflicted: 0,
      total: 3,
      clean: false
    });
    expect(detail.worktrees).toHaveLength(1);
  });

  it("counts repository stashes in summary and detail data", async () => {
    const topLevelPath = await validateRepository(repoDir, store);
    const repo = await store.upsertRepo(topLevelPath);
    await fs.appendFile(path.join(repo.path, "README.md"), "stash me\n");
    await runGit(repo.path, ["stash", "push", "--include-untracked", "--message", "saved local work"], store);

    const [summary, detail] = await Promise.all([
      getRepoSummary(repo, repo.path, store),
      getRepoDetail(repo, repo.path, store)
    ]);

    expect(summary.stashCount).toBe(1);
    expect(detail.stashCount).toBe(1);
    expect(detail.status.clean).toBe(true);
  });

  it("detects ahead and behind state against upstream branches", async () => {
    const remoteDir = path.join(tmpDir, "remote.git");
    const cloneDir = path.join(tmpDir, "remote-clone");
    await fs.mkdir(remoteDir);
    await git(remoteDir, "init", "--bare");
    await git(repoDir, "remote", "add", "origin", remoteDir);
    await git(repoDir, "push", "-u", "origin", "main");

    const topLevelPath = await validateRepository(repoDir, store);
    const repo = await store.upsertRepo(topLevelPath);

    await fs.appendFile(path.join(repo.path, "README.md"), "local ahead\n");
    await git(repo.path, "add", "README.md");
    await git(repo.path, "commit", "-m", "local ahead");

    await git(tmpDir, "clone", remoteDir, cloneDir);
    await git(cloneDir, "config", "user.email", "remote@example.com");
    await git(cloneDir, "config", "user.name", "Remote User");
    try {
      await git(cloneDir, "switch", "main");
    } catch {
      await git(cloneDir, "switch", "-c", "main", "origin/main");
    }
    await fs.appendFile(path.join(cloneDir, "README.md"), "remote ahead\n");
    await git(cloneDir, "add", "README.md");
    await git(cloneDir, "commit", "-m", "remote ahead");
    await git(cloneDir, "push", "origin", "HEAD:main");
    await git(repo.path, "fetch", "origin");

    const [summary, branches, worktrees] = await Promise.all([
      getRepoSummary(repo, repo.path, store),
      getBranches(repo.path, store),
      getWorktrees(repo.path, repo.path, store)
    ]);
    const mainBranch = branches.find((branch) => branch.name === "main");

    expect(summary).toMatchObject({
      ahead: 1,
      behind: 1,
      branchAheadCount: 1,
      branchBehindCount: 1
    });
    expect(mainBranch).toMatchObject({
      upstream: "origin/main",
      ahead: 1,
      behind: 1
    });
    expect(worktrees[0]).toMatchObject({
      upstream: "origin/main",
      ahead: 1,
      behind: 1
    });
  });

  it("records detailed logs for git operations", async () => {
    const topLevelPath = await validateRepository(repoDir, store);
    const repo = await store.upsertRepo(topLevelPath);

    await runGit(repo.path, ["status", "--short", "--branch"], store);
    await runGit(repo.path, ["definitely-not-a-git-command"], store, { allowFailure: true });

    const operations = await store.listOperations();
    const failed = operations[0];
    const successful = operations[1];

    expect(failed).toMatchObject({
      command: "git",
      args: ["definitely-not-a-git-command"],
      cwd: repo.path,
      status: "error",
      stdout: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false,
      timeoutMs: 30_000
    });
    expect(failed.stderr).toContain("git");
    expect(failed.durationMs).toEqual(expect.any(Number));

    expect(successful).toMatchObject({
      command: "git",
      args: ["status", "--short", "--branch"],
      cwd: repo.path,
      status: "success",
      exitCode: 0,
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      timedOut: false
    });
    expect(successful.stdout).toContain("## main");
    await expect(store.getOperation(successful.id)).resolves.toMatchObject({
      id: successful.id,
      stdout: successful.stdout
    });
  });

  it("rejects browser origins outside the local allow-list", async () => {
    expect(isAllowedOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isAllowedOrigin("http://example.invalid")).toBe(false);
  });

  it("rejects opening paths outside known repositories", async () => {
    const topLevelPath = await validateRepository(repoDir, store);
    await store.upsertRepo(topLevelPath);
    const outsidePath = path.join(tmpDir, "outside.txt");
    await fs.writeFile(outsidePath, "outside\n");

    await expect(validateOpenTarget(store, outsidePath)).rejects.toThrow(
      "Só é possível abrir caminhos dentro de repositórios ou worktrees conhecidos."
    );
    await expect(validateOpenTarget(store, path.join(repoDir, "README.md"))).resolves.toBe(
      await fs.realpath(path.join(repoDir, "README.md"))
    );
  });

  it("builds folder, editor and terminal open commands without shell interpolation", () => {
    expect(buildOpenCommand("/tmp/repo", "folder", "darwin", {})).toEqual({
      command: "open",
      args: ["/tmp/repo"]
    });
    expect(buildOpenCommand("/tmp/repo", "editor", "darwin", {})).toEqual({
      command: "open",
      args: ["-a", "Visual Studio Code", "/tmp/repo"]
    });
    expect(buildOpenCommand("/tmp/repo", "terminal", "darwin", {})).toEqual({
      command: "open",
      args: ["-a", "Terminal", "/tmp/repo"]
    });
    expect(
      buildOpenCommand("/tmp/repo", "editor", "linux", {
        WORKTREE_MANAGER_EDITOR: "code --reuse-window"
      })
    ).toEqual({
      command: "code",
      args: ["--reuse-window", "/tmp/repo"]
    });
    expect(
      buildOpenCommand("/tmp/repo", "terminal", "linux", {
        WORKTREE_MANAGER_TERMINAL: "ghostty --working-directory={path}"
      })
    ).toEqual({
      command: "ghostty",
      args: ["--working-directory=/tmp/repo"]
    });
    expect(
      buildOpenCommand("/tmp/repo", "editor", "darwin", {}, {
        safeMode: true,
        locale: "pt",
        integrations: {
          editor: "cursor",
          terminal: "auto"
        }
      })
    ).toEqual({
      command: "cursor",
      args: ["/tmp/repo"]
    });
    expect(
      buildOpenCommand("/tmp/repo", "terminal", "darwin", {}, {
        safeMode: true,
        locale: "pt",
        integrations: {
          editor: "auto",
          terminal: "iterm"
        }
      })
    ).toEqual({
      command: "open",
      args: ["-a", "iTerm", "/tmp/repo"]
    });
  });

  it("creates and removes a worktree with name confirmation", async () => {
    const topLevelPath = await validateRepository(repoDir, store);
    const repo = await store.upsertRepo(topLevelPath);
    const targetPath = path.join(path.dirname(repo.path), defaultWorktreeName(repo.name, "feature/test"));

    await runGit(repo.path, ["worktree", "add", "-b", "feature/test", targetPath], store);

    const worktrees = await getWorktrees(repo.path, repo.path, store);
    const created = worktrees.find((item) => item.branch === "feature/test");

    expect(created?.path).toBe(path.join(path.dirname(repo.path), "repo-feature-test"));

    expect(path.basename(created?.path ?? "")).toBe("repo-feature-test");
    await runGit(repo.path, ["worktree", "remove", created!.path], store);
    await expect(fs.access(created!.path)).rejects.toThrow();
  });

  it("creates a worktree from a remote branch and tracks the upstream", async () => {
    const remoteDir = path.join(tmpDir, "remote.git");
    await fs.mkdir(remoteDir);
    await git(remoteDir, "init", "--bare");
    await git(repoDir, "remote", "add", "origin", remoteDir);
    await git(repoDir, "push", "-u", "origin", "main");
    await git(repoDir, "switch", "-c", "feature/remote-work");
    await fs.appendFile(path.join(repoDir, "README.md"), "remote work\n");
    await git(repoDir, "add", "README.md");
    await git(repoDir, "commit", "-m", "remote work");
    await git(repoDir, "push", "-u", "origin", "feature/remote-work");
    await git(repoDir, "switch", "main");
    await git(repoDir, "branch", "-D", "feature/remote-work");

    const topLevelPath = await validateRepository(repoDir, store);
    const repo = await store.upsertRepo(topLevelPath);
    const targetPath = await createWorktree(
      repo,
      { branch: "origin/feature/remote-work", newBranch: false },
      store
    );

    const branch = await git(targetPath, "branch", "--show-current");
    const upstream = await git(targetPath, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}");

    expect(path.basename(targetPath)).toBe("repo-origin-feature-remote-work");
    expect(branch.stdout.trim()).toBe("feature/remote-work");
    expect(upstream.stdout.trim()).toBe("origin/feature/remote-work");
  });

  it("blocks checkout when the branch is already checked out in another worktree", async () => {
    const topLevelPath = await validateRepository(repoDir, store);
    const repo = await store.upsertRepo(topLevelPath);
    const targetPath = path.join(tmpDir, "occupied-worktree");
    await runGit(repo.path, ["branch", "feature/occupied"], store);
    await runGit(repo.path, ["worktree", "add", targetPath, "feature/occupied"], store);

    await expect(checkoutBranch(repo.path, "feature/occupied", repo.path, store)).rejects.toThrow(
      'A branch "feature/occupied" já está checked out em'
    );
  });

  it("validates and summarizes a focused worktree path", async () => {
    const topLevelPath = await validateRepository(repoDir, store);
    const repo = await store.upsertRepo(topLevelPath);
    const customPath = path.join(tmpDir, "custom-worktree-location");

    await runGit(repo.path, ["worktree", "add", "-b", "feature/focus", customPath], store);

    await expect(resolveRepoWorktreePath(repo.path, path.join(tmpDir, "missing"), store)).rejects.toThrow(
      "A worktree selecionada não pertence a este repositório."
    );
    const focusedPath = await resolveRepoWorktreePath(repo.path, customPath, store);
    const summary = await getRepoSummary(repo, focusedPath, store);

    expect(path.basename(focusedPath)).toBe("custom-worktree-location");
    expect(summary).toMatchObject({
      currentBranch: "feature/focus",
      focusedWorktreePath: focusedPath
    });
  });

  it("hands off a worktree branch back to the local workspace by detaching the source worktree", async () => {
    const topLevelPath = await validateRepository(repoDir, store);
    const repo = await store.upsertRepo(topLevelPath);
    const handoffPath = path.join(tmpDir, "handoff-worktree");

    await runGit(repo.path, ["worktree", "add", "-b", "feature/handoff", handoffPath], store);

    const result = await handoffWorktreeBranchToLocal(repo.path, handoffPath, store);
    const realHandoffPath = await fs.realpath(handoffPath);
    const localBranch = await git(repo.path, "branch", "--show-current");
    const sourceBranch = await git(handoffPath, "branch", "--show-current");
    const sourceHead = await git(handoffPath, "rev-parse", "--abbrev-ref", "HEAD");

    expect(result).toMatchObject({
      branch: "feature/handoff",
      localPath: repo.path,
      detachedWorktreePath: realHandoffPath
    });
    expect(localBranch.stdout.trim()).toBe("feature/handoff");
    expect(sourceBranch.stdout.trim()).toBe("");
    expect(sourceHead.stdout.trim()).toBe("HEAD");
  });

  it("hands off dirty worktree changes to the local workspace", async () => {
    const topLevelPath = await validateRepository(repoDir, store);
    const repo = await store.upsertRepo(topLevelPath);
    const handoffPath = path.join(tmpDir, "dirty-handoff-worktree");

    await runGit(repo.path, ["worktree", "add", "-b", "feature/dirty-handoff", handoffPath], store);
    await fs.appendFile(path.join(handoffPath, "README.md"), "worktree dirty work\n");
    await fs.writeFile(path.join(handoffPath, "worktree-notes.txt"), "from worktree\n");

    const result = await handoffWorktreeBranchToLocal(repo.path, handoffPath, store);
    const localBranch = await git(repo.path, "branch", "--show-current");
    const localStatus = await git(repo.path, "status", "--porcelain=v1", "-uall");
    const sourceHead = await git(handoffPath, "rev-parse", "--abbrev-ref", "HEAD");
    const sourceStatus = await git(handoffPath, "status", "--porcelain=v1", "-uall");
    const readme = await fs.readFile(path.join(repo.path, "README.md"), "utf8");
    const notes = await fs.readFile(path.join(repo.path, "worktree-notes.txt"), "utf8");

    expect(result).toMatchObject({
      branch: "feature/dirty-handoff",
      localPath: repo.path,
      movedChanges: true
    });
    expect(localBranch.stdout.trim()).toBe("feature/dirty-handoff");
    expect(localStatus.stdout).toContain(" M README.md");
    expect(localStatus.stdout).toContain("?? worktree-notes.txt");
    expect(sourceHead.stdout.trim()).toBe("HEAD");
    expect(sourceStatus.stdout.trim()).toBe("");
    expect(readme).toContain("worktree dirty work");
    expect(notes).toBe("from worktree\n");
  });

  it("moves the local checked out branch to a worktree and switches local back to main", async () => {
    const topLevelPath = await validateRepository(repoDir, store);
    const repo = await store.upsertRepo(topLevelPath);

    await runGit(repo.path, ["switch", "-c", "feature/local"], store);

    const result = await moveLocalBranchToWorktree(repo, {}, store);
    const localBranch = await git(repo.path, "branch", "--show-current");
    const worktreeBranch = await git(result.worktreePath, "branch", "--show-current");

    expect(result).toMatchObject({
      branch: "feature/local",
      baseBranch: "main",
      localPath: repo.path,
      worktreePath: path.join(path.dirname(repo.path), "repo-feature-local"),
      movedChanges: false
    });
    expect(localBranch.stdout.trim()).toBe("main");
    expect(worktreeBranch.stdout.trim()).toBe("feature/local");
  });

  it("moves dirty local changes into the new worktree", async () => {
    const topLevelPath = await validateRepository(repoDir, store);
    const repo = await store.upsertRepo(topLevelPath);

    await runGit(repo.path, ["switch", "-c", "feature/dirty"], store);
    await fs.appendFile(path.join(repo.path, "README.md"), "dirty work\n");
    await fs.writeFile(path.join(repo.path, "notes.txt"), "untracked\n");

    const result = await moveLocalBranchToWorktree(repo, {}, store);
    const localBranch = await git(repo.path, "branch", "--show-current");
    const localStatus = await git(repo.path, "status", "--porcelain=v1", "-uall");
    const worktreeBranch = await git(result.worktreePath, "branch", "--show-current");
    const worktreeStatus = await git(result.worktreePath, "status", "--porcelain=v1", "-uall");
    const readme = await fs.readFile(path.join(result.worktreePath, "README.md"), "utf8");
    const notes = await fs.readFile(path.join(result.worktreePath, "notes.txt"), "utf8");

    expect(result.movedChanges).toBe(true);
    expect(localBranch.stdout.trim()).toBe("main");
    expect(localStatus.stdout.trim()).toBe("");
    expect(worktreeBranch.stdout.trim()).toBe("feature/dirty");
    expect(worktreeStatus.stdout).toContain(" M README.md");
    expect(worktreeStatus.stdout).toContain("?? notes.txt");
    expect(readme).toContain("dirty work");
    expect(notes).toBe("untracked\n");
  });

  it("reuses an existing detached worktree when moving the local branch back out", async () => {
    const topLevelPath = await validateRepository(repoDir, store);
    const repo = await store.upsertRepo(topLevelPath);
    const defaultPath = path.join(path.dirname(repo.path), "repo-feature-reuse");

    await runGit(repo.path, ["worktree", "add", "-b", "feature/reuse", defaultPath], store);
    await handoffWorktreeBranchToLocal(repo.path, defaultPath, store);

    const detachedHead = await git(defaultPath, "rev-parse", "--abbrev-ref", "HEAD");
    expect(detachedHead.stdout.trim()).toBe("HEAD");

    const result = await moveLocalBranchToWorktree(repo, {}, store);
    const localBranch = await git(repo.path, "branch", "--show-current");
    const worktreeBranch = await git(defaultPath, "branch", "--show-current");

    expect(result).toMatchObject({
      branch: "feature/reuse",
      baseBranch: "main",
      localPath: repo.path,
      worktreePath: defaultPath,
      movedChanges: false
    });
    expect(localBranch.stdout.trim()).toBe("main");
    expect(worktreeBranch.stdout.trim()).toBe("feature/reuse");
  });

  it("stashes existing worktree changes before checking out the local branch there", async () => {
    const topLevelPath = await validateRepository(repoDir, store);
    const repo = await store.upsertRepo(topLevelPath);
    const targetPath = path.join(path.dirname(repo.path), "repo-feature-with-worktree-changes");

    await runGit(repo.path, ["branch", "feature/with-worktree-changes"], store);
    await runGit(repo.path, ["worktree", "add", "--detach", targetPath, "feature/with-worktree-changes"], store);
    await runGit(repo.path, ["switch", "feature/with-worktree-changes"], store);
    await fs.appendFile(path.join(repo.path, "README.md"), "local dirty work\n");
    await fs.writeFile(path.join(repo.path, "local-notes.txt"), "from local\n");
    await fs.writeFile(path.join(targetPath, "worktree-notes.txt"), "already in worktree\n");

    const result = await moveLocalBranchToWorktree(repo, {}, store);
    const localBranch = await git(repo.path, "branch", "--show-current");
    const localStatus = await git(repo.path, "status", "--porcelain=v1", "-uall");
    const worktreeBranch = await git(targetPath, "branch", "--show-current");
    const worktreeStatus = await git(targetPath, "status", "--porcelain=v1", "-uall");
    const readme = await fs.readFile(path.join(targetPath, "README.md"), "utf8");
    const localNotes = await fs.readFile(path.join(targetPath, "local-notes.txt"), "utf8");
    const worktreeNotes = await fs.readFile(path.join(targetPath, "worktree-notes.txt"), "utf8");

    expect(result).toMatchObject({
      branch: "feature/with-worktree-changes",
      baseBranch: "main",
      localPath: repo.path,
      worktreePath: targetPath,
      movedChanges: true
    });
    expect(localBranch.stdout.trim()).toBe("main");
    expect(localStatus.stdout.trim()).toBe("");
    expect(worktreeBranch.stdout.trim()).toBe("feature/with-worktree-changes");
    expect(worktreeStatus.stdout).toContain(" M README.md");
    expect(worktreeStatus.stdout).toContain("?? local-notes.txt");
    expect(worktreeStatus.stdout).toContain("?? worktree-notes.txt");
    expect(readme).toContain("local dirty work");
    expect(localNotes).toBe("from local\n");
    expect(worktreeNotes).toBe("already in worktree\n");
  });

  it("reuses a detached worktree from a custom path when moving the local branch back out", async () => {
    const topLevelPath = await validateRepository(repoDir, store);
    const repo = await store.upsertRepo(topLevelPath);
    const customPath = path.join(tmpDir, "custom-reusable-worktree");

    await runGit(repo.path, ["worktree", "add", "-b", "feature/custom-reuse", customPath], store);
    await handoffWorktreeBranchToLocal(repo.path, customPath, store);

    const result = await moveLocalBranchToWorktree(repo, {}, store);
    const localBranch = await git(repo.path, "branch", "--show-current");
    const worktreeBranch = await git(customPath, "branch", "--show-current");

    expect(result).toMatchObject({
      branch: "feature/custom-reuse",
      baseBranch: "main",
      localPath: repo.path,
      worktreePath: await fs.realpath(customPath),
      movedChanges: false
    });
    expect(localBranch.stdout.trim()).toBe("main");
    expect(worktreeBranch.stdout.trim()).toBe("feature/custom-reuse");
  });
});

function operationFixture(
  id: string,
  status: OperationRecord["status"],
  durationMs: number,
  timedOut: boolean,
  finishedAt: string
): OperationRecord {
  return {
    id,
    command: "git",
    args: ["status"],
    cwd: "/tmp/repo",
    startedAt: "2026-07-01T10:00:00.000Z",
    finishedAt,
    status,
    exitCode: status === "success" ? 0 : 1,
    summary: status,
    stdout: "",
    stderr: status === "success" ? "" : "fatal",
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs,
    timeoutMs: 30_000,
    timedOut,
    signal: null
  };
}

function git(cwd: string, ...args: string[]) {
  return execFileAsync("git", args, { cwd });
}
