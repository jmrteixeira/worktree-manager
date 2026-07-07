import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { api } from "./api";

vi.mock("./api", () => ({
  api: {
    listRepos: vi.fn(),
    operations: vi.fn(),
    summary: vi.fn(),
    worktrees: vi.fn(),
    branches: vi.fn(),
    listFs: vi.fn(),
    addRepo: vi.fn(),
    createWorktree: vi.fn(),
    removeWorktree: vi.fn(),
    handoffWorktreeToLocal: vi.fn(),
    moveLocalBranchToWorktree: vi.fn(),
    createBranch: vi.fn(),
    checkoutBranch: vi.fn(),
    deleteBranch: vi.fn(),
    fetchRepo: vi.fn(),
    pullRepo: vi.fn(),
    openPath: vi.fn()
  }
}));

const mockedApi = vi.mocked(api);

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockedApi.operations.mockResolvedValue([]);
    mockedApi.listFs.mockResolvedValue({
      path: "/Users/test",
      parent: "/Users",
      isGitRepo: false,
      entries: []
    });
  });

  it("renders the empty state when there are no repositories", async () => {
    mockedApi.listRepos.mockResolvedValue([]);

    render(<App />);

    expect(await screen.findByText("Selecione um repositório para começar")).toBeInTheDocument();
  });

  it("renders dashboard data for a selected repository", async () => {
    mockedApi.listRepos.mockResolvedValue([
      {
        id: "repo-1",
        name: "WorktreeManager",
        path: "/tmp/WorktreeManager",
        lastOpenedAt: "2026-07-01T10:00:00.000Z"
      }
    ]);
    mockedApi.summary.mockResolvedValue({
      repo: {
        id: "repo-1",
        name: "WorktreeManager",
        path: "/tmp/WorktreeManager",
        lastOpenedAt: "2026-07-01T10:00:00.000Z"
      },
      valid: true,
      gitVersion: "git version 2.50.1",
      focusedWorktreePath: "/tmp/WorktreeManager",
      currentBranch: "main",
      commitCount: 42,
      branchCount: 2,
      worktreeCount: 1,
      lastUpdatedAt: "2026-07-01T10:00:00.000Z"
    });
    mockedApi.worktrees.mockResolvedValue([
      {
        id: "wt-1",
        path: "/tmp/WorktreeManager",
        branch: "main",
        head: "a1b2c3d",
        isCurrent: true,
        detached: false,
        bare: false,
        lastCommit: {
          sha: "a1b2c3d",
          subject: "feat: dashboard",
          date: "2026-07-01T10:00:00.000Z"
        }
      }
    ]);
    mockedApi.branches.mockResolvedValue([
      {
        name: "main",
        current: true,
        upstream: "origin/main",
        isRemote: false,
        head: "a1b2c3d",
        lastCommit: {
          sha: "a1b2c3d",
          subject: "feat: dashboard",
          date: "2026-07-01T10:00:00.000Z"
        }
      }
    ]);

    render(<App />);

    await waitFor(() => expect(mockedApi.summary).toHaveBeenCalledWith("repo-1", undefined));
    expect((await screen.findAllByText("WorktreeManager")).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("git version 2.50.1")).toBeInTheDocument();
    expect(screen.getAllByText("feat: dashboard")).toHaveLength(2);

    fireEvent.click(screen.getAllByTitle("Ações")[0]);
    expect(screen.getByText("Copiar caminho")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByText("Copiar caminho")).not.toBeInTheDocument());
  });

  it("keeps multiple repositories active in the workspace", async () => {
    window.localStorage.setItem(
      "worktree-manager.activeRepoIds",
      JSON.stringify(["repo-1", "repo-2"])
    );
    mockedApi.listRepos.mockResolvedValue([
      {
        id: "repo-1",
        name: "Frontend",
        path: "/tmp/Frontend",
        lastOpenedAt: "2026-07-01T10:00:00.000Z"
      },
      {
        id: "repo-2",
        name: "Backend",
        path: "/tmp/Backend",
        lastOpenedAt: "2026-07-01T10:00:00.000Z"
      }
    ]);
    mockedApi.summary.mockImplementation(async (repoId) => ({
      repo: {
        id: repoId,
        name: repoId === "repo-1" ? "Frontend" : "Backend",
        path: repoId === "repo-1" ? "/tmp/Frontend" : "/tmp/Backend",
        lastOpenedAt: "2026-07-01T10:00:00.000Z"
      },
      valid: true,
      gitVersion: "git version 2.50.1",
      focusedWorktreePath: repoId === "repo-1" ? "/tmp/Frontend" : "/tmp/Backend",
      currentBranch: repoId === "repo-1" ? "main" : "develop",
      commitCount: repoId === "repo-1" ? 10 : 20,
      branchCount: repoId === "repo-1" ? 2 : 3,
      worktreeCount: repoId === "repo-1" ? 1 : 2,
      lastUpdatedAt: "2026-07-01T10:00:00.000Z"
    }));
    mockedApi.worktrees.mockResolvedValue([]);
    mockedApi.branches.mockResolvedValue([]);

    render(<App />);

    await waitFor(() => expect(mockedApi.summary).toHaveBeenCalledWith("repo-1", undefined));
    await waitFor(() => expect(mockedApi.summary).toHaveBeenCalledWith("repo-2", undefined));
    expect((await screen.findAllByText("Área de trabalho")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Repos ativos")).toBeInTheDocument();
    expect(screen.getAllByText("Frontend").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Backend").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("develop")).toBeInTheDocument();
  });

  it("uses the persisted focused worktree path when loading repo data", async () => {
    window.localStorage.setItem("worktree-manager.activeRepoIds", JSON.stringify(["repo-1"]));
    window.localStorage.setItem(
      "worktree-manager.focusedWorktreePaths",
      JSON.stringify({ "repo-1": "/tmp/WorktreeManager-feature" })
    );
    mockedApi.listRepos.mockResolvedValue([
      {
        id: "repo-1",
        name: "WorktreeManager",
        path: "/tmp/WorktreeManager",
        lastOpenedAt: "2026-07-01T10:00:00.000Z"
      }
    ]);
    mockedApi.summary.mockResolvedValue({
      repo: {
        id: "repo-1",
        name: "WorktreeManager",
        path: "/tmp/WorktreeManager",
        lastOpenedAt: "2026-07-01T10:00:00.000Z"
      },
      valid: true,
      gitVersion: "git version 2.50.1",
      focusedWorktreePath: "/tmp/WorktreeManager-feature",
      currentBranch: "feature/focus",
      commitCount: 42,
      branchCount: 2,
      worktreeCount: 2,
      lastUpdatedAt: "2026-07-01T10:00:00.000Z"
    });
    mockedApi.worktrees.mockResolvedValue([]);
    mockedApi.branches.mockResolvedValue([]);

    render(<App />);

    await waitFor(() =>
      expect(mockedApi.summary).toHaveBeenCalledWith("repo-1", "/tmp/WorktreeManager-feature")
    );
    expect(mockedApi.worktrees).toHaveBeenCalledWith("repo-1", "/tmp/WorktreeManager-feature");
    expect(mockedApi.branches).toHaveBeenCalledWith("repo-1", "/tmp/WorktreeManager-feature");
    expect((await screen.findAllByText("feature/focus")).length).toBeGreaterThanOrEqual(2);
  });

  it("hands off a focused worktree back to the local workspace", async () => {
    window.localStorage.setItem("worktree-manager.activeRepoIds", JSON.stringify(["repo-1"]));
    window.localStorage.setItem(
      "worktree-manager.focusedWorktreePaths",
      JSON.stringify({ "repo-1": "/tmp/WorktreeManager-feature" })
    );
    mockedApi.listRepos.mockResolvedValue([
      {
        id: "repo-1",
        name: "WorktreeManager",
        path: "/tmp/WorktreeManager",
        lastOpenedAt: "2026-07-01T10:00:00.000Z"
      }
    ]);
    mockedApi.summary.mockImplementation(async (_repoId, worktreePath) => ({
      repo: {
        id: "repo-1",
        name: "WorktreeManager",
        path: "/tmp/WorktreeManager",
        lastOpenedAt: "2026-07-01T10:00:00.000Z"
      },
      valid: true,
      gitVersion: "git version 2.50.1",
      focusedWorktreePath: worktreePath ?? "/tmp/WorktreeManager",
      currentBranch: "feature/handoff",
      commitCount: 42,
      branchCount: 2,
      worktreeCount: 2,
      lastUpdatedAt: "2026-07-01T10:00:00.000Z"
    }));
    mockedApi.worktrees.mockResolvedValue([
      {
        id: "wt-local",
        path: "/tmp/WorktreeManager",
        branch: "main",
        head: "a1b2c3d",
        isCurrent: false,
        detached: false,
        bare: false,
        lastCommit: null
      },
      {
        id: "wt-feature",
        path: "/tmp/WorktreeManager-feature",
        branch: "feature/handoff",
        head: "d4e5f6g",
        isCurrent: true,
        detached: false,
        bare: false,
        lastCommit: null
      }
    ]);
    mockedApi.branches.mockResolvedValue([]);
    mockedApi.handoffWorktreeToLocal.mockResolvedValue({
      branch: "feature/handoff",
      localPath: "/tmp/WorktreeManager",
      detachedWorktreePath: "/tmp/WorktreeManager-feature",
      movedChanges: false
    });

    render(<App />);

    expect((await screen.findAllByText("/tmp/WorktreeManager-feature")).length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getAllByTitle("Ações")[1]);
    fireEvent.click(screen.getByText("Checkout local"));

    await waitFor(() => expect(mockedApi.handoffWorktreeToLocal).toHaveBeenCalledWith("repo-1", "wt-feature"));
    await waitFor(() => expect(mockedApi.summary).toHaveBeenCalledWith("repo-1", "/tmp/WorktreeManager"));
  });

  it("moves the local branch into a worktree and keeps the local workspace focused", async () => {
    window.localStorage.setItem("worktree-manager.activeRepoIds", JSON.stringify(["repo-1"]));
    mockedApi.listRepos.mockResolvedValue([
      {
        id: "repo-1",
        name: "WorktreeManager",
        path: "/tmp/WorktreeManager",
        lastOpenedAt: "2026-07-01T10:00:00.000Z"
      }
    ]);
    mockedApi.summary.mockResolvedValue({
      repo: {
        id: "repo-1",
        name: "WorktreeManager",
        path: "/tmp/WorktreeManager",
        lastOpenedAt: "2026-07-01T10:00:00.000Z"
      },
      valid: true,
      gitVersion: "git version 2.50.1",
      focusedWorktreePath: "/tmp/WorktreeManager",
      currentBranch: "feature/local",
      commitCount: 42,
      branchCount: 2,
      worktreeCount: 1,
      lastUpdatedAt: "2026-07-01T10:00:00.000Z"
    });
    mockedApi.worktrees.mockResolvedValue([
      {
        id: "wt-local",
        path: "/tmp/WorktreeManager",
        branch: "feature/local",
        head: "a1b2c3d",
        isCurrent: true,
        detached: false,
        bare: false,
        lastCommit: null
      }
    ]);
    mockedApi.branches.mockResolvedValue([]);
    mockedApi.moveLocalBranchToWorktree.mockResolvedValue({
      branch: "feature/local",
      baseBranch: "main",
      localPath: "/tmp/WorktreeManager",
      worktreePath: "/tmp/WorktreeManager-feature-local",
      movedChanges: false
    });

    render(<App />);

    expect((await screen.findAllByText("feature/local")).length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByTitle("Ações"));
    fireEvent.click(screen.getByText("Mover para worktree"));

    await waitFor(() => expect(mockedApi.moveLocalBranchToWorktree).toHaveBeenCalledWith("repo-1"));
    await waitFor(() => expect(mockedApi.summary).toHaveBeenCalledWith("repo-1", "/tmp/WorktreeManager"));
  });
});
