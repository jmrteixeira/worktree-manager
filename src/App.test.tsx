import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { api } from "./api";

vi.mock("./api", () => ({
  api: {
    listRepos: vi.fn(),
    operations: vi.fn(),
    summary: vi.fn(),
    worktrees: vi.fn(),
    archivedWorktrees: vi.fn(),
    detail: vi.fn(),
    review: vi.fn(),
    branches: vi.fn(),
    listFs: vi.fn(),
    pickFolder: vi.fn(),
    addRepo: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    integrations: vi.fn(),
    diagnostics: vi.fn(),
    recordDiagnosticEvent: vi.fn(),
    createWorktree: vi.fn(),
    removeWorktree: vi.fn(),
    archiveWorktree: vi.fn(),
    restoreWorktree: vi.fn(),
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

const defaultSettings = {
  safeMode: true,
  locale: "pt" as const,
  branchPrefix: "",
  worktreeDirectory: "",
  integrations: {
    editor: "auto" as const,
    terminal: "auto" as const
  }
};

const defaultIntegrationCatalog = {
  settings: defaultSettings.integrations,
  editors: [
    {
      id: "auto" as const,
      kind: "editor" as const,
      label: "Auto",
      description: "Usa o comportamento padrão da aplicação.",
      available: true,
      selected: true,
      command: null
    },
    {
      id: "vscode" as const,
      kind: "editor" as const,
      label: "Visual Studio Code",
      description: "Abre worktrees com o comando code.",
      available: true,
      selected: false,
      command: "code"
    },
    {
      id: "cursor" as const,
      kind: "editor" as const,
      label: "Cursor",
      description: "Abre worktrees com o comando cursor.",
      available: true,
      selected: false,
      command: "cursor"
    }
  ],
  terminals: [
    {
      id: "auto" as const,
      kind: "terminal" as const,
      label: "Auto",
      description: "Usa o comportamento padrão da aplicação.",
      available: true,
      selected: true,
      command: null
    },
    {
      id: "iterm" as const,
      kind: "terminal" as const,
      label: "iTerm",
      description: "Abre worktrees no iTerm em macOS.",
      available: true,
      selected: false,
      command: "open -a iTerm"
    }
  ]
};

const defaultDiagnostics = {
  generatedAt: "2026-07-01T10:00:00.000Z",
  appVersion: "1.0.0",
  runtime: "node" as const,
  platform: "darwin",
  statePath: "/tmp/worktree-manager-state.json",
  repositoryCount: 0,
  operationCount: 0,
  operationStats: {
    success: 0,
    error: 0,
    timedOut: 0,
    averageDurationMs: 0,
    p95DurationMs: 0,
    slowestDurationMs: 0,
    lastFailureAt: null
  },
  recentFailures: [],
  settings: defaultSettings
};

describe("App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-preference");
    document.documentElement.style.colorScheme = "";
    mockedApi.operations.mockResolvedValue([]);
    mockedApi.archivedWorktrees.mockResolvedValue([]);
    mockedApi.archiveWorktree.mockResolvedValue({
      repoId: "repo-1",
      worktreeId: "wt-feature",
      path: "/tmp/WorktreeManager-feature",
      branch: "feature/test",
      head: "d4e5f6a",
      archivedAt: "2026-07-01T10:00:00.000Z"
    });
    mockedApi.restoreWorktree.mockResolvedValue(undefined);
    mockedApi.diagnostics.mockResolvedValue(defaultDiagnostics);
    mockedApi.integrations.mockResolvedValue(defaultIntegrationCatalog);
    mockedApi.recordDiagnosticEvent.mockResolvedValue({
      id: "diag-1",
      command: "app",
      args: ["diagnostic", "error", "test"],
      cwd: "worktree-manager",
      startedAt: "2026-07-01T10:00:00.000Z",
      finishedAt: "2026-07-01T10:00:00.000Z",
      status: "error",
      exitCode: 1,
      summary: "test",
      stdout: "",
      stderr: "test",
      stdoutTruncated: false,
      stderrTruncated: false,
      durationMs: 0,
      timeoutMs: 0,
      timedOut: false,
      signal: null
    });
    mockedApi.getSettings.mockResolvedValue(defaultSettings);
    mockedApi.updateSettings.mockImplementation(async (settings) => ({
      ...defaultSettings,
      ...settings,
      integrations: settings.integrations
        ? { ...defaultSettings.integrations, ...settings.integrations }
        : defaultSettings.integrations
    }));
    mockedApi.listFs.mockResolvedValue({
      path: "/Users/test",
      parent: "/Users",
      isGitRepo: false,
      entries: []
    });
    mockedApi.pickFolder.mockResolvedValue(null);
    mockedApi.review.mockResolvedValue({
      repo: {
        id: "repo-1",
        name: "WorktreeManager",
        path: "/tmp/WorktreeManager",
        lastOpenedAt: "2026-07-01T10:00:00.000Z"
      },
      worktree: {
        id: "wt-1",
        path: "/tmp/WorktreeManager",
        branch: "main",
        head: "a1b2c3d",
        isCurrent: true,
        detached: false,
        bare: false,
        lastCommit: null
      },
      branch: "main",
      status: {
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicted: 0,
        total: 0,
        clean: true
      },
      files: [],
      generatedAt: "2026-07-01T10:00:00.000Z"
    });
  });

  it("renders the empty state when there are no repositories", async () => {
    mockedApi.listRepos.mockResolvedValue([]);

    render(<App />);

    expect(await screen.findByText("Selecione um repositório para começar")).toBeInTheDocument();
    expect(screen.getByText("Primeiro arranque")).toBeInTheDocument();
    expect(screen.getByText("Seleciona uma pasta Git local.")).toBeInTheDocument();
  });

  it("dismisses the first-run onboarding panel", async () => {
    mockedApi.listRepos.mockResolvedValue([]);

    render(<App />);

    expect(await screen.findByText("Primeiro arranque")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ignorar" }));

    expect(screen.queryByText("Primeiro arranque")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("worktree-manager.onboardingDismissed")).toBe("true");
  });

  it("collapses and expands the sidebar from the footer control", async () => {
    mockedApi.listRepos.mockResolvedValue([]);

    render(<App />);

    await screen.findByText("Selecione um repositório para começar");
    expect(document.querySelector(".app-shell.sidebar-collapsed")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Colapsar barra lateral" }));

    expect(document.querySelector(".app-shell.sidebar-collapsed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expandir barra lateral" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expandir barra lateral" }));

    expect(document.querySelector(".app-shell.sidebar-collapsed")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Colapsar barra lateral" })).toBeInTheDocument();
  });

  it("selects a repository with the native folder picker", async () => {
    const repo = {
      id: "repo-1",
      name: "WorktreeManager",
      path: "/tmp/WorktreeManager",
      lastOpenedAt: "2026-07-01T10:00:00.000Z"
    };
    mockedApi.listRepos.mockResolvedValueOnce([]).mockResolvedValueOnce([repo]);
    mockedApi.pickFolder.mockResolvedValue({ path: repo.path });
    mockedApi.listFs.mockImplementation(async (path?: string) => ({
      path: path ?? "/Users/test",
      parent: "/Users",
      isGitRepo: path === repo.path,
      entries: []
    }));
    mockedApi.addRepo.mockResolvedValue(repo);
    mockedApi.summary.mockResolvedValue({
      repo,
      valid: true,
      gitVersion: "git version 2.50.1",
      focusedWorktreePath: repo.path,
      currentBranch: "main",
      commitCount: 1,
      branchCount: 1,
      worktreeCount: 1,
      lastUpdatedAt: "2026-07-01T10:00:00.000Z"
    });
    mockedApi.worktrees.mockResolvedValue([]);
    mockedApi.branches.mockResolvedValue([]);

    render(<App />);

    const selectButtons = await screen.findAllByRole("button", { name: "Selecionar Repositório" });
    fireEvent.click(selectButtons[0]);
    expect(await screen.findByRole("dialog", { name: "Selecionar Repositório" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Escolher outra pasta" }));

    await waitFor(() => expect(mockedApi.pickFolder).toHaveBeenCalled());
    await waitFor(() => expect(mockedApi.addRepo).toHaveBeenCalledWith(repo.path));
  });

  it("shows visible keyboard shortcuts on the help page", async () => {
    mockedApi.listRepos.mockResolvedValue([]);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Ajuda" }));

    expect(await screen.findByText("Atalhos de teclado")).toBeInTheDocument();
    expect(screen.getAllByText("Paleta de comandos").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Navegar resultados")).toBeInTheDocument();
  });

  it("shows local-first privacy details and copies a local report", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    mockedApi.listRepos.mockResolvedValue([]);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Dados e privacidade" }));

    expect(await screen.findByText("Nada sai da máquina sem autorização")).toBeInTheDocument();
    expect(screen.getAllByText("Inexistente").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("A aplicação não envia métricas, eventos, erros, nomes de repositórios, caminhos ou comandos para serviços externos.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copiar relatório local" }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const report = JSON.parse(writeText.mock.calls[0][0] as string) as {
      privacyModel: { remoteTelemetryImplemented: boolean; automaticDataUpload: boolean };
      localStorageKeys: string[];
    };
    expect(report.privacyModel.remoteTelemetryImplemented).toBe(false);
    expect(report.privacyModel.automaticDataUpload).toBe(false);
    expect(report.localStorageKeys).toContain("worktree-manager.activeRepoIds");
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
    expect(screen.getByText("Sem worktrees para os filtros atuais")).toBeInTheDocument();
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

  it("archives and restores worktrees without removing them from disk", async () => {
    const repo = {
      id: "repo-1",
      name: "WorktreeManager",
      path: "/tmp/WorktreeManager",
      lastOpenedAt: "2026-07-01T10:00:00.000Z"
    };
    const localWorktree = {
      id: "wt-local",
      path: repo.path,
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
      lastCommit: null
    };
    const featureWorktree = {
      id: "wt-feature",
      path: "/tmp/WorktreeManager-feature-archive",
      branch: "feature/archive",
      head: "d4e5f6a",
      isCurrent: false,
      detached: false,
      bare: false,
      lastCommit: null
    };
    const archivedRecord = {
      repoId: repo.id,
      worktreeId: featureWorktree.id,
      path: featureWorktree.path,
      branch: featureWorktree.branch,
      head: featureWorktree.head,
      archivedAt: "2026-07-01T10:00:00.000Z"
    };
    let archived = false;

    mockedApi.listRepos.mockResolvedValue([repo]);
    mockedApi.summary.mockImplementation(async () => ({
      repo,
      valid: true,
      gitVersion: "git version 2.50.1",
      focusedWorktreePath: repo.path,
      currentBranch: "main",
      commitCount: 42,
      branchCount: 2,
      worktreeCount: archived ? 1 : 2,
      lastUpdatedAt: "2026-07-01T10:00:00.000Z"
    }));
    mockedApi.worktrees.mockImplementation(async () => (archived ? [localWorktree] : [localWorktree, featureWorktree]));
    mockedApi.archivedWorktrees.mockImplementation(async () => (archived ? [archivedRecord] : []));
    mockedApi.archiveWorktree.mockImplementation(async () => {
      archived = true;
      return archivedRecord;
    });
    mockedApi.restoreWorktree.mockImplementation(async () => {
      archived = false;
    });
    mockedApi.branches.mockResolvedValue([]);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Worktrees" }));
    expect(await screen.findByText(featureWorktree.path)).toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle("Ações")[1]);
    fireEvent.click(screen.getByText("Arquivar"));

    await waitFor(() => expect(mockedApi.archiveWorktree).toHaveBeenCalledWith("repo-1", "wt-feature"));
    expect(await screen.findByText("Worktree arquivada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restaurar" })).toBeInTheDocument();
    expect(screen.getByText(featureWorktree.path)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restaurar" }));

    await waitFor(() => expect(mockedApi.restoreWorktree).toHaveBeenCalledWith("repo-1", "wt-feature"));
    expect(await screen.findByText("Sem worktrees arquivadas")).toBeInTheDocument();
    expect(screen.getByText(featureWorktree.path)).toBeInTheDocument();
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
    fireEvent.click(within(screen.getByRole("region", { name: "Repos ativos" })).getByRole("button", { name: /WorktreeManager/ }));

    await waitFor(() => expect(mockedApi.detail).toHaveBeenCalledWith("repo-1", "/tmp/WorktreeManager"));
    expect(await screen.findByText("Estado local")).toBeInTheDocument();
    expect(screen.getByText("origin/feature/detail")).toBeInTheDocument();
    expect(screen.getByText("Stashes")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
  });

  it("renders the review page with filters and split diff", async () => {
    const repo = {
      id: "repo-1",
      name: "WorktreeManager",
      path: "/tmp/WorktreeManager",
      lastOpenedAt: "2026-07-01T10:00:00.000Z"
    };
    const worktree = {
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
      lastCommit: null
    };
    mockedApi.listRepos.mockResolvedValue([repo]);
    mockedApi.summary.mockResolvedValue({
      repo,
      valid: true,
      gitVersion: "git version 2.50.1",
      focusedWorktreePath: repo.path,
      currentBranch: "main",
      commitCount: 42,
      branchCount: 2,
      worktreeCount: 1,
      changedFileCount: 2,
      lastUpdatedAt: "2026-07-01T10:00:00.000Z"
    });
    mockedApi.worktrees.mockResolvedValue([worktree]);
    mockedApi.branches.mockResolvedValue([]);
    mockedApi.review.mockResolvedValue({
      repo,
      worktree,
      branch: "main",
      status: {
        staged: 0,
        unstaged: 1,
        untracked: 1,
        conflicted: 0,
        total: 2,
        clean: false
      },
      files: [
        {
          id: "unstaged:src/App.tsx",
          path: "src/App.tsx",
          originalPath: null,
          mode: "unstaged",
          statusLabel: "Modificado",
          binary: false,
          tooLarge: false,
          truncated: false,
          additions: 1,
          deletions: 1,
          error: null,
          hunks: [
            {
              header: "@@ -1,3 +1,3 @@",
              oldStart: 1,
              oldLines: 3,
              newStart: 1,
              newLines: 3,
              lines: [
                { type: "context", oldLineNumber: 1, newLineNumber: 1, content: "function App() {" },
                { type: "delete", oldLineNumber: 2, newLineNumber: null, content: "  return null;" },
                { type: "add", oldLineNumber: null, newLineNumber: 2, content: "  return <main />;" }
              ]
            }
          ]
        },
        {
          id: "untracked:docs/review.md",
          path: "docs/review.md",
          originalPath: null,
          mode: "untracked",
          statusLabel: "Por seguir",
          binary: false,
          tooLarge: false,
          truncated: false,
          additions: 1,
          deletions: 0,
          error: null,
          hunks: [
            {
              header: "@@ -0,0 +1,1 @@",
              oldStart: 0,
              oldLines: 0,
              newStart: 1,
              newLines: 1,
              lines: [
                { type: "add", oldLineNumber: null, newLineNumber: 1, content: "review notes" }
              ]
            }
          ]
        }
      ],
      generatedAt: "2026-07-01T10:00:00.000Z"
    });

    render(<App />);

    await screen.findByText("Repos ativos");
    fireEvent.click(screen.getByRole("button", { name: "Worktrees" }));
    expect((await screen.findAllByText("/tmp/WorktreeManager")).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByTitle("Ações"));
    fireEvent.click(screen.getByText("Rever alterações"));

    expect(await screen.findByRole("dialog", { name: "Revisão" })).toBeInTheDocument();
    await waitFor(() => expect(mockedApi.review).toHaveBeenCalledWith("repo-1", "/tmp/WorktreeManager"));
    await waitFor(() => expect(screen.getAllByText("src/App.tsx").length).toBeGreaterThanOrEqual(1));
    expect(screen.getByText((content) => content.includes("return <main />;"))).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Untracked/ })[0]);
    expect(screen.getAllByText("docs/review.md").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryAllByText("src/App.tsx")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    expect(screen.getByRole("region", { name: "Split diff docs/review.md" })).toBeInTheDocument();
  });

  it("keeps review disabled for clean worktrees", async () => {
    const repo = {
      id: "repo-1",
      name: "WorktreeManager",
      path: "/tmp/WorktreeManager",
      lastOpenedAt: "2026-07-01T10:00:00.000Z"
    };
    mockedApi.listRepos.mockResolvedValue([repo]);
    mockedApi.summary.mockResolvedValue({
      repo,
      valid: true,
      gitVersion: "git version 2.50.1",
      focusedWorktreePath: repo.path,
      currentBranch: "main",
      commitCount: 42,
      branchCount: 2,
      worktreeCount: 1,
      changedFileCount: 0,
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
          unstaged: 0,
          untracked: 0,
          conflicted: 0,
          total: 0,
          clean: true
        },
        lastCommit: null
      }
    ]);
    mockedApi.branches.mockResolvedValue([]);

    render(<App />);

    await screen.findByText("Repos ativos");
    fireEvent.click(screen.getByRole("button", { name: "Worktrees" }));
    expect((await screen.findAllByText("/tmp/WorktreeManager")).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByTitle("Ações"));

    const reviewButton = screen.getByText("Rever alterações").closest("button");
    expect(reviewButton).not.toBeNull();
    expect(reviewButton).toBeDisabled();
    fireEvent.click(reviewButton!);
    expect(mockedApi.review).not.toHaveBeenCalled();
  });

  it("persists and applies the selected theme", async () => {
    mockedApi.listRepos.mockResolvedValue([]);

    render(<App />);

    expect(await screen.findByText("Selecione um repositório para começar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Mudar para Claro/ }));

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    expect(document.documentElement.dataset.themePreference).toBe("light");
    expect(window.localStorage.getItem("worktree-manager.theme")).toBe("light");
  });

  it("switches the interface language and persists the locale", async () => {
    mockedApi.listRepos.mockResolvedValue([]);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Configurações" }));
    fireEvent.click(screen.getByRole("button", { name: "English" }));

    await waitFor(() => expect(mockedApi.updateSettings).toHaveBeenCalledWith({ locale: "en" }));
    await waitFor(() => expect(screen.getAllByRole("heading", { name: "Settings" }).length).toBeGreaterThanOrEqual(1));
    expect(screen.getByText("Language")).toBeInTheDocument();
    expect(screen.getByText("Safe mode")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
  });

  it("opens the command palette and runs a navigation command", async () => {
    mockedApi.listRepos.mockResolvedValue([]);

    render(<App />);

    expect(await screen.findByText("Selecione um repositório para começar")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Abrir comandos" }));
    fireEvent.change(screen.getByLabelText("Pesquisar comandos"), {
      target: { value: "config" }
    });
    fireEvent.keyDown(screen.getByLabelText("Pesquisar comandos"), { key: "Enter" });

    await waitFor(() => expect(screen.queryByLabelText("Pesquisar comandos")).not.toBeInTheDocument());
    expect(await screen.findByRole("dialog", { name: "Configurações" })).toBeInTheDocument();
    expect(screen.getByText("Configurações da aplicação")).toBeInTheDocument();
  });

  it("opens a guided workflow and continues into the create worktree action", async () => {
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
      worktreeCount: 2,
      changedFileCount: 0,
      lastUpdatedAt: "2026-07-01T10:00:00.000Z"
    });
    mockedApi.worktrees.mockResolvedValue([
      {
        id: "local",
        path: "/tmp/WorktreeManager",
        branch: "main",
        head: "a1b2c3d",
        isCurrent: true,
        detached: false,
        bare: false,
        lastCommit: null
      },
      {
        id: "feature",
        path: "/tmp/WorktreeManager-feature",
        branch: "feature/auth",
        head: "d4e5f6g",
        isCurrent: false,
        detached: false,
        bare: false,
        lastCommit: null
      }
    ]);
    mockedApi.branches.mockResolvedValue([
      {
        name: "main",
        current: true,
        upstream: "origin/main",
        isRemote: false,
        head: "a1b2c3d",
        lastCommit: null
      },
      {
        name: "feature/auth",
        current: false,
        upstream: "origin/feature/auth",
        isRemote: false,
        head: "d4e5f6g",
        lastCommit: null
      }
    ]);

    render(<App />);

    await waitFor(() => expect(mockedApi.summary).toHaveBeenCalledWith("repo-1", undefined));
    fireEvent.click(screen.getByRole("button", { name: "Workflows" }));

    expect(await screen.findByText("Começar trabalho paralelo")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Abrir workflow" })[0]);
    expect(await screen.findByRole("dialog", { name: "Começar trabalho paralelo" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Criar worktree" }));

    expect(await screen.findByRole("dialog", { name: "Nova Worktree" })).toBeInTheDocument();
  });

  it("updates the safe Git mode setting", async () => {
    mockedApi.listRepos.mockResolvedValue([]);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Configurações" }));
    fireEvent.click(screen.getByRole("button", { name: "Desligado" }));

    await waitFor(() => expect(mockedApi.updateSettings).toHaveBeenCalledWith({ safeMode: false }));
  });

  it("updates branch and worktree defaults", async () => {
    mockedApi.listRepos.mockResolvedValue([]);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Configurações" }));
    fireEvent.click(screen.getByRole("tab", { name: /Git/ }));
    fireEvent.change(screen.getByLabelText("Prefixo de branch"), {
      target: { value: "feature/" }
    });
    fireEvent.change(screen.getByLabelText("Local default das worktrees"), {
      target: { value: "/tmp/worktrees" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar defaults" }));

    await waitFor(() =>
      expect(mockedApi.updateSettings).toHaveBeenCalledWith({
        branchPrefix: "feature/",
        worktreeDirectory: "/tmp/worktrees"
      })
    );
  });

  it("updates the interface language setting", async () => {
    mockedApi.listRepos.mockResolvedValue([]);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Configurações" }));
    fireEvent.click(screen.getByRole("button", { name: "English" }));

    await waitFor(() => expect(mockedApi.updateSettings).toHaveBeenCalledWith({ locale: "en" }));
  });

  it("selects a preferred editor integration", async () => {
    mockedApi.listRepos.mockResolvedValue([]);

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Configurações" }));
    fireEvent.click(screen.getByRole("tab", { name: /Integrações/ }));
    expect((await screen.findAllByText("Ferramentas externas para abrir worktrees")).length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole("button", { name: /Visual Studio Code/ }));

    await waitFor(() =>
      expect(mockedApi.updateSettings).toHaveBeenCalledWith({
        integrations: {
          editor: "vscode",
          terminal: "auto"
        }
      })
    );
  });

  it("shows and copies the diagnostics snapshot", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    mockedApi.listRepos.mockResolvedValue([]);
    mockedApi.diagnostics.mockResolvedValue({
      ...defaultDiagnostics,
      repositoryCount: 2,
      operationCount: 3,
      operationStats: {
        success: 2,
        error: 1,
        timedOut: 0,
        averageDurationMs: 512,
        p95DurationMs: 2450,
        slowestDurationMs: 2450,
        lastFailureAt: "2026-07-01T10:00:00.000Z"
      },
      recentFailures: [
        {
          id: "op-1",
          command: "git",
          args: ["pull", "--ff-only"],
          cwd: "/tmp/WorktreeManager",
          startedAt: "2026-07-01T10:00:00.000Z",
          finishedAt: "2026-07-01T10:00:00.000Z",
          status: "error",
          exitCode: 1,
          summary: "Not possible to fast-forward",
          stdout: "",
          stderr: "fatal: Not possible to fast-forward, aborting.",
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 2450,
          timeoutMs: 120000,
          timedOut: false,
          signal: null
        }
      ]
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Configurações" }));
    fireEvent.click(screen.getByRole("tab", { name: /Observabilidade/ }));
    expect(await screen.findByText("Diagnóstico local")).toBeInTheDocument();
    expect(screen.getByText("2 ok / 1 falhas")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copiar JSON" }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('"operationCount": 3');
    expect(copied).toContain('"runtime": "node"');
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
    expect(await screen.findByText("Área de trabalho")).toBeInTheDocument();
    expect(screen.getByText("Repos ativos")).toBeInTheDocument();
    const repoSelector = screen.getByRole("button", { name: "Escolher repositório em foco" });
    expect(repoSelector).toHaveTextContent("Frontend");
    expect(screen.getAllByText("Frontend").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Backend").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("develop")).toBeInTheDocument();
    fireEvent.click(repoSelector);
    fireEvent.click(screen.getByRole("option", { name: /Backend/ }));
    expect(repoSelector).toHaveTextContent("Backend");
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
    fireEvent.click(screen.getAllByRole("button", { name: /Nova Worktree/ })[0]);
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

  it("creates a worktree from a new branch with an explicit base branch", async () => {
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
        name: "develop",
        current: false,
        upstream: null,
        isRemote: false,
        head: "d4e5f6a",
        lastCommit: null
      }
    ]);
    mockedApi.createWorktree.mockResolvedValue({
      path: "/tmp/WorktreeManager-feature-new-area"
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Worktrees" }));
    fireEvent.click(screen.getAllByRole("button", { name: /Nova Worktree/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Nova branch" }));
    fireEvent.change(screen.getByLabelText("Nova branch"), {
      target: { value: "feature/new-area" }
    });
    fireEvent.change(screen.getByLabelText("Branch base"), {
      target: { value: "develop" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar" }));

    await waitFor(() =>
      expect(mockedApi.createWorktree).toHaveBeenCalledWith("repo-1", {
        branch: "feature/new-area",
        newBranch: true,
        name: undefined,
        path: undefined,
        from: "develop"
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
