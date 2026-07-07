// @vitest-environment node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultWorktreeName,
  getRepoSummary,
  getWorktrees,
  handoffWorktreeBranchToLocal,
  moveLocalBranchToWorktree,
  resolveRepoWorktreePath,
  runGit,
  validateRepository
} from "../server/git";
import { AppStore } from "../server/store";

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
      worktreeCount: 1
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

function git(cwd: string, ...args: string[]) {
  return execFileAsync("git", args, { cwd });
}
