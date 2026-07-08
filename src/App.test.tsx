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
    detail: vi.fn(),
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
    openPath: vi.fn(),
    operation: vi.fn()
  }
}));

const mockedApi = vi.mocked(api);

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-preference");
    document.documentElement.style.colorScheme = "";
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
      dirtyWorktreeCount: 1,
      changedFileCount: 2,
      stashCount: 1,
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
        status: {
          staged: 0,
          unstaged: 1,
          untracked: 1,
          conflicted: 0,
          total: 2,
          clean: false
        },
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
    expect(screen.getAllByText("2 alterações").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("1 stash").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("feat: dashboard")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Worktrees" }));
    expect(await screen.findByText("feat: dashboard")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Pesquisar worktrees"), {
      target: { value: "sem-resultados" }
    });
    expect(screen.getByText("Sem worktrees para os filtros atuais.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Pesquisar worktrees"), {
      target: { value: "" }
    });
    expect(await screen.findByText("feat: dashboard")).toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle("Ações")[0]);
    expect(screen.getByText("Abrir no editor")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Abrir no editor"));
    await waitFor(() => expect(mockedApi.openPath).toHaveBeenCalledWith("/tmp/WorktreeManager", "editor"));

    fireEvent.click(screen.getAllByTitle("Ações")[0]);
    expect(screen.getByText("Copiar caminho")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByText("Copiar caminho")).not.toBeInTheDocument());
  });

  it("opens the repository detail view from the workspace card", async () => {
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
      currentBranch: "feature/detail",
      commitCount: 42,
      branchCount: 2,
      worktreeCount: 1,
      lastUpdatedAt: "2026-07-01T10:00:00.000Z"
    });
    mockedApi.worktrees.mockResolvedValue([
      {
        id: "wt-1",
        path: "/tmp/WorktreeManager",
        branch: "feature/detail",
        head: "a1b2c3d",
        isCurrent: true,
        detached: false,
        bare: false,
        lastCommit: null
      }
    ]);
    mockedApi.branches.mockResolvedValue([]);
    mockedApi.detail.mockResolvedValue({
      repo: {
        id: "repo-1",
        name: "WorktreeManager",
        path: "/tmp/WorktreeManager",
        lastOpenedAt: "2026-07-01T10:00:00.000Z"
      },
      worktree: {
        id: "wt-1",
        path: "/tmp/WorktreeManager",
        branch: "feature/detail",
        head: "a1b2c3d",
        isCurrent: true,
        detached: false,
        bare: false,
        lastCommit: null
      },
      branch: "feature/detail",
      upstream: "origin/feature/detail",
      ahead: 2,
      behind: 1,
      lastFetchAt: "2026-07-01T09:00:00.000Z",
      stashCount: 1,
      status: {
        staged: 1,
        unstaged: 1,
        untracked: 1,
        conflicted: 0,
        total: 3,
        clean: false
      },
      files: [
        {
          path: "README.md",
          originalPath: null,
          indexStatus: " ",
          worktreeStatus: "M",
          label: "Modificado"
        }
      ],
      worktrees: [
        {
          id: "wt-1",
          path: "/tmp/WorktreeManager",
          branch: "feature/detail",
          head: "a1b2c3d",
          isCurrent: true,
          detached: false,
          bare: false,
          lastCommit: null
        }
      ],
      lastUpdatedAt: "2026-07-01T10:00:00.000Z"
    });

    render(<App />);

    await screen.findByText("Repos ativos");
    fireEvent.click(screen.getAllByText("/tmp/WorktreeManager")[0]);

    await waitFor(() => expect(mockedApi.detail).toHaveBeenCalledWith("repo-1", "/tmp/WorktreeManager"));
    expect(await screen.findByText("Estado local")).toBeInTheDocument();
    expect(screen.getByText("origin/feature/detail")).toBeInTheDocument();
    expect(screen.getByText("Stashes")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });

  it("persists and applies the selected theme", async () => {
    mockedApi.listRepos.mockResolvedValue([]);

    render(<App />);

    expect(await screen.findByText("Selecione um repositório para começar")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Claro"));

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    expect(document.documentElement.dataset.themePreference).toBe("light");
    expect(window.localStorage.getItem("worktree-manager.theme")).toBe("light");
  });

  it("expands detailed operation logs", async () => {
    window.history.replaceState(null, "", "/#operations");
    mockedApi.listRepos.mockResolvedValue([]);
    mockedApi.operations.mockResolvedValue([
      {
        id: "op-1",
        command: "git",
        args: ["status", "--short", "--branch"],
        cwd: "/tmp/WorktreeManager",
        startedAt: "2026-07-01T10:00:00.000Z",
        finishedAt: "2026-07-01T10:00:00.042Z",
        status: "success",
        exitCode: 0,
        summary: "## main",
        stdout: "## main\n M README.md",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 42,
        timeoutMs: 30000,
        timedOut: false,
        signal: null
      }
    ]);

    render(<App />);

    expect(await screen.findByText("git status --short --branch")).toBeInTheDocument();
    expect(screen.getByText("42 ms")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Ver logs de git status --short --branch/ }));

    expect(screen.getByText("stdout")).toBeInTheDocument();
    expect(screen.getByText("stderr")).toBeInTheDocument();
    expect(screen.getByText(/M README.md/)).toBeInTheDocument();
    expect(screen.getByText("Sem output.")).toBeInTheDocument();
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

  it("falls back to the local workspace when the focused worktree no longer exists", async () => {
    window.localStorage.setItem("worktree-manager.activeRepoIds", JSON.stringify(["repo-1"]));
    window.localStorage.setItem(
      "worktree-manager.focusedWorktreePaths",
      JSON.stringify({ "repo-1": "/tmp/WorktreeManager-missing" })
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
      currentBranch: worktreePath ? "feature/missing" : "main",
      commitCount: 42,
      branchCount: 2,
      worktreeCount: 1,
      lastUpdatedAt: "2026-07-01T10:00:00.000Z"
    }));
    mockedApi.worktrees.mockImplementation(async (_repoId, worktreePath) => {
      if (worktreePath) {
        throw new Error("A worktree selecionada não pertence a este repositório.");
      }

      return [
        {
          id: "wt-local",
          path: "/tmp/WorktreeManager",
          branch: "main",
          head: "a1b2c3d",
          isCurrent: true,
          detached: false,
          bare: false,
          lastCommit: null
        }
      ];
    });
    mockedApi.branches.mockImplementation(async (_repoId, worktreePath) => {
      if (worktreePath) {
        throw new Error("A worktree selecionada não pertence a este repositório.");
      }

      return [
        {
          name: "main",
          current: true,
          upstream: null,
          isRemote: false,
          head: "a1b2c3d",
          lastCommit: null
        }
      ];
    });

    render(<App />);

    expect(await screen.findByText("A worktree em foco já não existe. Voltei ao workspace local.")).toBeInTheDocument();
    await waitFor(() => expect(mockedApi.summary).toHaveBeenCalledWith("repo-1", undefined));
    await waitFor(() =>
      expect(window.localStorage.getItem("worktree-manager.focusedWorktreePaths")).toBe("{}")
    );
  });

  it("creates a worktree from an existing branch by default", async () => {
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
      currentBranch: "main",
      commitCount: 42,
      branchCount: 2,
      worktreeCount: 1,
      lastUpdatedAt: "2026-07-01T10:00:00.000Z"
    });
    mockedApi.worktrees.mockResolvedValue([]);
    mockedApi.branches.mockResolvedValue([
      {
        name: "feature/existing",
        current: false,
        upstream: null,
        isRemote: false,
        head: "a1b2c3d",
        lastCommit: null
      }
    ]);
    mockedApi.createWorktree.mockResolvedValue({
      path: "/tmp/WorktreeManager-feature-existing"
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Worktrees" }));
    fireEvent.click(screen.getByRole("button", { name: /Nova Worktree/ }));
    fireEvent.change(screen.getByLabelText("Branch existente"), {
      target: { value: "feature/existing" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    await waitFor(() =>
      expect(mockedApi.createWorktree).toHaveBeenCalledWith("repo-1", {
        branch: "feature/existing",
        newBranch: false,
        name: undefined,
        path: undefined
      })
    );
  });

  it("checks out a branch from the row actions menu", async () => {
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
      currentBranch: "main",
      commitCount: 42,
      branchCount: 2,
      worktreeCount: 1,
      lastUpdatedAt: "2026-07-01T10:00:00.000Z"
    });
    mockedApi.worktrees.mockResolvedValue([]);
    mockedApi.branches.mockResolvedValue([
      {
        name: "main",
        current: true,
        upstream: null,
        isRemote: false,
        head: "a1b2c3d",
        lastCommit: null
      },
      {
        name: "feature/checkout",
        current: false,
        upstream: "origin/feature/checkout",
        isRemote: false,
        head: "d4e5f6a",
        lastCommit: null,
        ahead: 2,
        behind: 1
      }
    ]);
    mockedApi.checkoutBranch.mockResolvedValue({ branch: "feature/checkout" });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Branches" }));
    expect(await screen.findByText("feature/checkout")).toBeInTheDocument();
    expect(screen.getByText("Ahead 2")).toBeInTheDocument();
    expect(screen.getByText("Behind 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ahead" }));
    expect(screen.getByText("Mostrando 1 de 2 branches")).toBeInTheDocument();
    fireEvent.click(screen.getAllByTitle("Ações")[0]);
    fireEvent.click(screen.getByText("Checkout nesta worktree"));
    expect(screen.getByText("Confirmar checkout de branch")).toBeInTheDocument();
    expect(mockedApi.checkoutBranch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar checkout" }));

    await waitFor(() =>
      expect(mockedApi.checkoutBranch).toHaveBeenCalledWith(
        "repo-1",
        "feature/checkout",
        "/tmp/WorktreeManager"
      )
    );
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

    fireEvent.click(await screen.findByRole("button", { name: "Worktrees" }));
    expect((await screen.findAllByText("/tmp/WorktreeManager-feature")).length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getAllByTitle("Ações")[1]);
    fireEvent.click(screen.getByText("Checkout local"));
    expect(screen.getByText("Confirmar handoff para local")).toBeInTheDocument();
    expect(mockedApi.handoffWorktreeToLocal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar checkout local" }));

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

    fireEvent.click(await screen.findByRole("button", { name: "Worktrees" }));
    expect(await screen.findByText("feature/local")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Ações"));
    fireEvent.click(screen.getByText("Mover para worktree"));
    expect(screen.getByText("Confirmar mover para worktree")).toBeInTheDocument();
    expect(mockedApi.moveLocalBranchToWorktree).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar mover" }));

    await waitFor(() => expect(mockedApi.moveLocalBranchToWorktree).toHaveBeenCalledWith("repo-1"));
    await waitFor(() => expect(mockedApi.summary).toHaveBeenCalledWith("repo-1", "/tmp/WorktreeManager"));
  });
});
