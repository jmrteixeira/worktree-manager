import { FormEvent, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Code2,
  Copy,
  Folder,
  FolderGit2,
  GitBranch,
  GitFork,
  Home,
  Loader2,
  Menu,
  MoreVertical,
  Play,
  Plus,
  RefreshCcw,
  Settings,
  TerminalSquare,
  Trash2,
  X
} from "lucide-react";
import { api } from "./api";
import type {
  BranchRecord,
  FsEntry,
  FsListResponse,
  OperationRecord,
  RepoRecord,
  RepoSummary,
  WorktreeRecord
} from "./types";

type DialogState =
  | { kind: "repo-picker" }
  | { kind: "create-worktree" }
  | { kind: "create-branch" }
  | { kind: "delete-worktree"; worktree: WorktreeRecord }
  | { kind: "delete-branch"; branch: BranchRecord }
  | null;

type RepoSummaryMap = Record<string, RepoSummary>;
type RepoErrorMap = Record<string, string>;
type FocusedWorktreeMap = Record<string, string>;

const ACTIVE_REPOS_STORAGE_KEY = "worktree-manager.activeRepoIds";
const FOCUSED_WORKTREES_STORAGE_KEY = "worktree-manager.focusedWorktreePaths";

export function App() {
  const [repos, setRepos] = useState<RepoRecord[]>([]);
  const [workspaceRepoIds, setWorkspaceRepoIds] = useState<string[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [repoSummaries, setRepoSummaries] = useState<RepoSummaryMap>({});
  const [repoSummaryErrors, setRepoSummaryErrors] = useState<RepoErrorMap>({});
  const [focusedWorktreePaths, setFocusedWorktreePaths] = useState<FocusedWorktreeMap>({});
  const [worktrees, setWorktrees] = useState<WorktreeRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [operations, setOperations] = useState<OperationRecord[]>([]);
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.id === selectedRepoId) ?? null,
    [repos, selectedRepoId]
  );
  const workspaceRepos = useMemo(
    () =>
      workspaceRepoIds
        .map((repoId) => repos.find((repo) => repo.id === repoId))
        .filter((repo): repo is RepoRecord => Boolean(repo)),
    [repos, workspaceRepoIds]
  );
  const selectedSummary = selectedRepoId ? repoSummaries[selectedRepoId] ?? null : null;
  const selectedFocusedWorktreePath =
    (selectedRepoId ? focusedWorktreePaths[selectedRepoId] : null) ??
    selectedSummary?.focusedWorktreePath ??
    selectedRepo?.path ??
    null;
  const workspaceTotals = useMemo(
    () =>
      workspaceRepoIds.reduce(
        (totals, repoId) => {
          const item = repoSummaries[repoId];
          if (!item) return totals;
          return {
            worktreeCount: totals.worktreeCount + item.worktreeCount,
            branchCount: totals.branchCount + item.branchCount,
            commitCount: totals.commitCount + item.commitCount
          };
        },
        { worktreeCount: 0, branchCount: 0, commitCount: 0 }
      ),
    [repoSummaries, workspaceRepoIds]
  );

  useEffect(() => {
    void loadInitialState();
  }, []);

  useEffect(() => {
    if (!workspaceHydrated) return;

    persistWorkspaceRepoIds(workspaceRepoIds);
    persistFocusedWorktreePaths(focusedWorktreePaths);

    if (!workspaceRepoIds.length) {
      if (selectedRepoId) setSelectedRepoId(null);
      setRepoSummaries({});
      setRepoSummaryErrors({});
      setWorktrees([]);
      setBranches([]);
      return;
    }

    if (!selectedRepoId || !workspaceRepoIds.includes(selectedRepoId)) {
      setSelectedRepoId(workspaceRepoIds[0]);
      return;
    }

    void refreshDashboard(selectedRepoId, workspaceRepoIds, focusedWorktreePaths);
  }, [focusedWorktreePaths, selectedRepoId, workspaceHydrated, workspaceRepoIds]);

  async function loadInitialState() {
    try {
      const [repoList, operationList] = await Promise.all([api.listRepos(), api.operations()]);
      const storedActiveIds = readWorkspaceRepoIds().filter((repoId) =>
        repoList.some((repo) => repo.id === repoId)
      );
      const initialActiveIds = storedActiveIds.length
        ? storedActiveIds
        : repoList[0]
          ? [repoList[0].id]
          : [];
      setRepos(repoList);
      setOperations(operationList);
      setFocusedWorktreePaths(readFocusedWorktreePaths(repoList.map((repo) => repo.id)));
      setWorkspaceRepoIds(initialActiveIds);
      setSelectedRepoId(initialActiveIds[0] ?? null);
      setWorkspaceHydrated(true);
      if (!repoList.length) setDialog({ kind: "repo-picker" });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function refreshDashboard(
    repoId = selectedRepoId,
    repoIds = workspaceRepoIds,
    focusMap = focusedWorktreePaths
  ) {
    if (!repoId) return;
    const selectedFocusPath = focusMap[repoId];
    setLoading(true);
    setError(null);
    try {
      const [summaryResults, nextWorktrees, nextBranches, nextOperations] = await Promise.all([
        Promise.all(
          repoIds.map(async (activeRepoId) => {
            try {
              return {
                repoId: activeRepoId,
                summary: await api.summary(activeRepoId, focusMap[activeRepoId]),
                error: null
              };
            } catch (caught) {
              return {
                repoId: activeRepoId,
                summary: null,
                error: errorMessage(caught)
              };
            }
          })
        ),
        api.worktrees(repoId, selectedFocusPath),
        api.branches(repoId, selectedFocusPath),
        api.operations()
      ]);
      setRepoSummaries(
        summaryResults.reduce<RepoSummaryMap>((next, item) => {
          if (item.summary) next[item.repoId] = item.summary;
          return next;
        }, {})
      );
      setRepoSummaryErrors(
        summaryResults.reduce<RepoErrorMap>((next, item) => {
          if (item.error) next[item.repoId] = item.error;
          return next;
        }, {})
      );
      setWorktrees(nextWorktrees);
      setBranches(nextBranches);
      setOperations(nextOperations);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  async function selectRepo(path: string) {
    setActionLoading("repo");
    setError(null);
    try {
      const repo = await api.addRepo(path);
      const repoList = await api.listRepos();
      setRepos(repoList);
      setWorkspaceRepoIds((repoIds) => uniqueIds([repo.id, ...repoIds]));
      setFocusedWorktreePaths((focusMap) => ({ ...focusMap, [repo.id]: repo.path }));
      setSelectedRepoId(repo.id);
      setDialog(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setActionLoading(null);
    }
  }

  async function runAction(label: string, action: () => Promise<unknown>) {
    if (!selectedRepoId) return;
    setActionLoading(label);
    setError(null);
    try {
      await action();
      await refreshDashboard(selectedRepoId, workspaceRepoIds, focusedWorktreePaths);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setActionLoading(null);
    }
  }

  function removeRepoFromWorkspace(repoId: string) {
    setWorkspaceRepoIds((repoIds) => {
      const next = repoIds.filter((item) => item !== repoId);
      if (selectedRepoId === repoId) {
        setSelectedRepoId(next[0] ?? null);
      }
      return next;
    });
    setFocusedWorktreePaths((focusMap) => {
      const next = { ...focusMap };
      delete next[repoId];
      return next;
    });
  }

  function switchFocusedWorktree(worktree: WorktreeRecord) {
    if (!selectedRepoId) return;
    setFocusedWorktreePaths((focusMap) => ({ ...focusMap, [selectedRepoId]: worktree.path }));
  }

  async function handoffWorktreeToLocal(worktree: WorktreeRecord) {
    if (!selectedRepoId || !selectedRepo) return;

    const repoId = selectedRepoId;
    const repoIds = workspaceRepoIds;
    setActionLoading(`Handoff ${worktree.branch ?? basename(worktree.path)}`);
    setError(null);
    try {
      const result = await api.handoffWorktreeToLocal(repoId, worktree.id);
      const nextFocusMap = { ...focusedWorktreePaths, [repoId]: result.localPath };
      setFocusedWorktreePaths(nextFocusMap);
      await refreshDashboard(repoId, repoIds, nextFocusMap);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setActionLoading(null);
    }
  }

  async function moveLocalBranchToWorktree() {
    if (!selectedRepoId || !selectedRepo) return;

    const repoId = selectedRepoId;
    const repoIds = workspaceRepoIds;
    setActionLoading("Mover para worktree");
    setError(null);
    try {
      const result = await api.moveLocalBranchToWorktree(repoId);
      const nextFocusMap = { ...focusedWorktreePaths, [repoId]: result.localPath };
      setFocusedWorktreePaths(nextFocusMap);
      await refreshDashboard(repoId, repoIds, nextFocusMap);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setActionLoading(null);
    }
  }

  const localBranches = branches.filter((branch) => !branch.isRemote);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <GitFork aria-hidden="true" />
          <span>Worktree Manager</span>
        </div>

        <nav className="nav-stack" aria-label="Navegação">
          <span className="nav-label">Navegação</span>
          <a className="nav-item active" href="#dashboard">
            <Home size={18} />
            Dashboard
          </a>
          <a className="nav-item" href="#worktrees">
            <GitFork size={18} />
            Worktrees
          </a>
          <a className="nav-item" href="#branches">
            <GitBranch size={18} />
            Branches
          </a>
          <a className="nav-item" href="#operations">
            <TerminalSquare size={18} />
            Operações
          </a>
          <a className="nav-item" href="#settings">
            <Settings size={18} />
            Configurações
          </a>
        </nav>

        <div className="repo-card">
          <span className="nav-label">Área de trabalho</span>
          {workspaceRepos.length ? (
            <>
              <div className="repo-current">
                <span className="status-dot" />
                <div>
                  <span>{workspaceRepos.length} repositório{workspaceRepos.length === 1 ? "" : "s"} ativo{workspaceRepos.length === 1 ? "" : "s"}</span>
                  <strong>{selectedRepo?.name ?? workspaceRepos[0]?.name}</strong>
                </div>
              </div>
              <div className="workspace-mini-list">
                {workspaceRepos.map((repo) => (
                  <button
                    key={repo.id}
                    className={repo.id === selectedRepoId ? "mini-repo active" : "mini-repo"}
                    onClick={() => setSelectedRepoId(repo.id)}
                    title={repo.path}
                  >
                    <FolderGit2 size={15} />
                    <span>{repo.name}</span>
                  </button>
                ))}
              </div>
              <button className="ghost-button full" onClick={() => setDialog({ kind: "repo-picker" })}>
                Adicionar repositório
              </button>
            </>
          ) : (
            <button className="ghost-button full" onClick={() => setDialog({ kind: "repo-picker" })}>
              Selecionar repositório
            </button>
          )}
        </div>

        <div className="sidebar-footer">
          <span>v1.0.0</span>
        </div>
      </aside>

      <main className="main-area" id="dashboard">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div>
            <h1>Dashboard</h1>
            <p>Visão geral do repositório e operações Git</p>
          </div>
          <button className="primary-button" onClick={() => setDialog({ kind: "repo-picker" })}>
            <Folder size={18} />
            Adicionar Repositório
          </button>
        </header>

        {error ? (
          <div className="alert">
            <AlertTriangle size={18} />
            <span>{error}</span>
            <button className="icon-button compact" onClick={() => setError(null)}>
              <X size={16} />
            </button>
          </div>
        ) : null}

        {workspaceRepos.length ? (
          <>
            <WorkspaceOverview
              repos={workspaceRepos}
              selectedRepoId={selectedRepoId}
              summaries={repoSummaries}
              errors={repoSummaryErrors}
              totals={workspaceTotals}
              onSelect={setSelectedRepoId}
              onRemove={removeRepoFromWorkspace}
              onAdd={() => setDialog({ kind: "repo-picker" })}
              onRefresh={() => void refreshDashboard(selectedRepoId, workspaceRepoIds, focusedWorktreePaths)}
              loading={loading}
            />

            {selectedRepo && selectedSummary ? (
              <>
            <section className="repo-hero" aria-label="Repositório selecionado">
              <div className="hero-left">
                <div className="hero-icon">
                  <Folder size={34} />
                </div>
                <div>
                  <span>Repositório em foco</span>
                  <h2>{selectedSummary.repo.name}</h2>
                  <p title={selectedSummary.focusedWorktreePath}>{selectedSummary.focusedWorktreePath}</p>
                </div>
              </div>
              <div className="hero-meta">
                <span className="valid-badge">Válido</span>
                <span>{selectedSummary.gitVersion}</span>
              </div>
            </section>

            <section className="stats-grid" aria-label="Métricas">
              <StatCard tone="purple" icon={<GitFork />} label="Worktrees" value={selectedSummary.worktreeCount} detail="Ativos" />
              <StatCard tone="blue" icon={<GitBranch />} label="Branches" value={selectedSummary.branchCount} detail="Total" />
              <StatCard tone="green" icon={<CheckCircle2 />} label="Atual" value={selectedSummary.currentBranch} detail="Branch atual" />
              <StatCard tone="amber" icon={<Code2 />} label="Commits" value={selectedSummary.commitCount} detail="Total" />
            </section>

            <DashboardSection
              id="worktrees"
              title="Worktrees"
              subtitle="Gerir worktrees do repositório"
              actions={
                <>
                  <button className="secondary-button" onClick={() => void refreshDashboard()}>
                    {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
                    Atualizar
                  </button>
                  <button className="primary-button" onClick={() => setDialog({ kind: "create-worktree" })}>
                    <Plus size={18} />
                    Nova Worktree
                    <ChevronDown size={14} />
                  </button>
                </>
              }
            >
              <WorktreeTable
                worktrees={worktrees}
                localWorkspacePath={selectedRepo.path}
                onSwitch={switchFocusedWorktree}
                onHandoffLocal={(worktree) => void handoffWorktreeToLocal(worktree)}
                onMoveLocalToWorktree={() => void moveLocalBranchToWorktree()}
                onOpen={(path) => void runAction("Abrir", () => api.openPath(path))}
                onCopy={(path) => void copyPath(path, setError)}
                onDelete={(worktree) => setDialog({ kind: "delete-worktree", worktree })}
              />
              <p className="table-foot">Mostrando 1 a {worktrees.length} de {worktrees.length} worktrees</p>
            </DashboardSection>

            <DashboardSection
              id="branches"
              title="Branches"
              subtitle="Gerir branches do repositório"
              actions={
                <>
                  <button className="secondary-button" onClick={() => void runAction("Fetch", () => api.fetchRepo(selectedRepo.id, selectedFocusedWorktreePath ?? undefined))}>
                    <RefreshCcw size={16} />
                    Fetch
                  </button>
                  <button className="secondary-button" onClick={() => void runAction("Pull", () => api.pullRepo(selectedRepo.id, selectedFocusedWorktreePath ?? undefined))}>
                    <RefreshCcw size={16} />
                    Pull
                  </button>
                  <button className="primary-button" onClick={() => setDialog({ kind: "create-branch" })}>
                    <Plus size={18} />
                    Nova Branch
                    <ChevronDown size={14} />
                  </button>
                </>
              }
            >
              <BranchTable
                branches={branches}
                onCheckout={(branch) => void runAction(`Checkout ${branch.name}`, () => api.checkoutBranch(selectedRepo.id, branch.name, selectedFocusedWorktreePath ?? undefined))}
                onDelete={(branch) => setDialog({ kind: "delete-branch", branch })}
              />
              <p className="table-foot">Mostrando 1 a {branches.length} de {branches.length} branches</p>
            </DashboardSection>

            <DashboardSection
              id="operations"
              title="Operações recentes"
              subtitle="Histórico local dos comandos Git"
            >
              <OperationsTable operations={operations} />
            </DashboardSection>
              </>
            ) : (
              <FocusedRepoPlaceholder loading={loading} repo={selectedRepo} error={selectedRepoId ? repoSummaryErrors[selectedRepoId] : null} />
            )}
          </>
        ) : (
          <EmptyState loading={loading} onSelectRepo={() => setDialog({ kind: "repo-picker" })} />
        )}
      </main>

      {dialog?.kind === "repo-picker" ? (
        <RepoPicker
          repos={repos}
          busy={actionLoading === "repo"}
          onClose={() => setDialog(null)}
          onSelect={selectRepo}
        />
      ) : null}

      {dialog?.kind === "create-worktree" && selectedRepo ? (
        <CreateWorktreeDialog
          branches={localBranches}
          busy={actionLoading !== null}
          onClose={() => setDialog(null)}
          onCreate={(body) =>
            void runAction("Nova worktree", async () => {
              const created = await api.createWorktree(selectedRepo.id, body);
              setFocusedWorktreePaths((focusMap) => ({ ...focusMap, [selectedRepo.id]: created.path }));
              setDialog(null);
            })
          }
        />
      ) : null}

      {dialog?.kind === "create-branch" && selectedRepo ? (
        <CreateBranchDialog
          branches={localBranches}
          busy={actionLoading !== null}
          onClose={() => setDialog(null)}
          onCreate={(body) =>
            void runAction("Nova branch", async () => {
              await api.createBranch(selectedRepo.id, {
                ...body,
                worktreePath: selectedFocusedWorktreePath ?? undefined
              });
              setDialog(null);
            })
          }
        />
      ) : null}

      {dialog?.kind === "delete-worktree" && selectedRepo ? (
        <ConfirmDeleteDialog
          title="Remover worktree"
          expected={basename(dialog.worktree.path)}
          label={dialog.worktree.path}
          busy={actionLoading !== null}
          onClose={() => setDialog(null)}
          onConfirm={(confirm) =>
            void runAction("Remover worktree", async () => {
              await api.removeWorktree(selectedRepo.id, dialog.worktree.id, confirm);
              setDialog(null);
            })
          }
        />
      ) : null}

      {dialog?.kind === "delete-branch" && selectedRepo ? (
        <ConfirmDeleteDialog
          title="Apagar branch"
          expected={dialog.branch.name}
          label={dialog.branch.name}
          busy={actionLoading !== null}
          onClose={() => setDialog(null)}
          onConfirm={(confirm) =>
            void runAction("Apagar branch", async () => {
              await api.deleteBranch(
                selectedRepo.id,
                dialog.branch.name,
                confirm,
                false,
                selectedFocusedWorktreePath ?? undefined
              );
              setDialog(null);
            })
          }
        />
      ) : null}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  detail,
  tone
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  detail: string;
  tone: "purple" | "blue" | "green" | "amber";
}) {
  return (
    <article className={`stat-card ${tone}`}>
      <div className="stat-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong title={String(value)}>{value}</strong>
        <p>{detail}</p>
      </div>
    </article>
  );
}

function DashboardSection({
  id,
  title,
  subtitle,
  actions,
  children
}: {
  id: string;
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel" id={id}>
      <div className="section-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {actions ? <div className="section-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function WorkspaceOverview({
  repos,
  selectedRepoId,
  summaries,
  errors,
  totals,
  loading,
  onSelect,
  onRemove,
  onAdd,
  onRefresh
}: {
  repos: RepoRecord[];
  selectedRepoId: string | null;
  summaries: RepoSummaryMap;
  errors: RepoErrorMap;
  totals: { worktreeCount: number; branchCount: number; commitCount: number };
  loading: boolean;
  onSelect: (repoId: string) => void;
  onRemove: (repoId: string) => void;
  onAdd: () => void;
  onRefresh: () => void;
}) {
  return (
    <section className="panel workspace-panel" aria-label="Repositórios ativos">
      <div className="section-header">
        <div>
          <h2>Área de trabalho</h2>
          <p>Gerir vários repositórios em paralelo e escolher o foco das operações.</p>
        </div>
        <div className="section-actions">
          <button className="secondary-button" onClick={onRefresh}>
            {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            Atualizar todos
          </button>
          <button className="primary-button" onClick={onAdd}>
            <Plus size={18} />
            Adicionar
          </button>
        </div>
      </div>

      <div className="workspace-totals" aria-label="Totais da área de trabalho">
        <div>
          <FolderGit2 size={18} />
          <strong>{repos.length}</strong>
          <span>Repos ativos</span>
        </div>
        <div>
          <GitFork size={18} />
          <strong>{totals.worktreeCount}</strong>
          <span>Worktrees</span>
        </div>
        <div>
          <GitBranch size={18} />
          <strong>{totals.branchCount}</strong>
          <span>Branches</span>
        </div>
        <div>
          <Code2 size={18} />
          <strong>{totals.commitCount}</strong>
          <span>Commits</span>
        </div>
      </div>

      <div className="workspace-grid">
        {repos.map((repo) => {
          const summary = summaries[repo.id];
          const error = errors[repo.id];
          const active = repo.id === selectedRepoId;

          return (
            <article key={repo.id} className={active ? "workspace-card active" : "workspace-card"}>
              <button className="workspace-card-main" onClick={() => onSelect(repo.id)}>
                <span className="workspace-card-icon">
                  {error ? <AlertTriangle size={18} /> : <FolderGit2 size={18} />}
                </span>
                <span>
                  <strong>{repo.name}</strong>
                  <small title={repo.path}>{repo.path}</small>
                </span>
              </button>
              <div className="workspace-card-meta">
                {error ? (
                  <span className="badge danger">Erro</span>
                ) : summary ? (
                  <>
                    <span className="badge blue">{summary.currentBranch}</span>
                    <span>{summary.worktreeCount} WT</span>
                    <span>{summary.branchCount} BR</span>
                  </>
                ) : (
                  <>
                    <Clock3 size={14} />
                    <span>A carregar</span>
                  </>
                )}
              </div>
              {error ? <p className="workspace-card-error">{error}</p> : null}
              <button className="icon-button compact workspace-remove" title="Remover da área de trabalho" onClick={() => onRemove(repo.id)}>
                <X size={15} />
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function FocusedRepoPlaceholder({
  loading,
  repo,
  error
}: {
  loading: boolean;
  repo: RepoRecord | null;
  error?: string | null;
}) {
  return (
    <section className="panel focus-placeholder">
      {loading ? <Loader2 className="spin" size={22} /> : <AlertTriangle size={22} />}
      <div>
        <h2>{repo ? repo.name : "Sem repositório em foco"}</h2>
        <p>{error ?? "A carregar os dados do repositório selecionado."}</p>
      </div>
    </section>
  );
}

function WorktreeTable({
  worktrees,
  localWorkspacePath,
  onSwitch,
  onHandoffLocal,
  onMoveLocalToWorktree,
  onOpen,
  onCopy,
  onDelete
}: {
  worktrees: WorktreeRecord[];
  localWorkspacePath: string;
  onSwitch: (worktree: WorktreeRecord) => void;
  onHandoffLocal: (worktree: WorktreeRecord) => void;
  onMoveLocalToWorktree: () => void;
  onOpen: (path: string) => void;
  onCopy: (path: string) => void;
  onDelete: (worktree: WorktreeRecord) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Caminho</th>
            <th>Branch</th>
            <th>HEAD</th>
            <th>Último Commit</th>
            <th>Data</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {worktrees.map((worktree) => {
            const isLocalWorkspace = sameWorktreePath(worktree.path, localWorkspacePath);
            const checkoutLocalDisabled = isLocalWorkspace || !worktree.branch || worktree.detached || worktree.bare;
            const moveLocalDisabled =
              !isLocalWorkspace || !worktree.branch || worktree.detached || worktree.bare || isBaseBranch(worktree.branch);

            return (
              <tr key={worktree.id}>
                <td>
                  <div className="path-cell" title={worktree.path}>
                    {worktree.isCurrent ? <Home size={16} /> : <GitFork size={16} />}
                    <span>{worktree.path}</span>
                  </div>
                </td>
                <td>
                  <div className="badges">
                    {worktree.isCurrent ? <span className="badge green">Em foco</span> : null}
                    <span className="badge blue">{worktree.branch ?? "detached"}</span>
                  </div>
                </td>
                <td>{worktree.head ? worktree.head.slice(0, 7) : "-"}</td>
                <td>{worktree.lastCommit?.subject ?? "-"}</td>
                <td>{relativeDate(worktree.lastCommit?.date)}</td>
                <td>
                  <div className="inline-actions">
                    <button
                      className="icon-button compact"
                      title="Mudar para esta worktree"
                      disabled={worktree.isCurrent}
                      onClick={() => onSwitch(worktree)}
                    >
                      <Play size={15} />
                    </button>
                    <RowActions
                      items={[
                        { label: "Abrir", icon: <Folder size={15} />, onClick: () => onOpen(worktree.path) },
                        { label: "Copiar caminho", icon: <Copy size={15} />, onClick: () => onCopy(worktree.path) },
                        isLocalWorkspace
                          ? {
                              label: "Mover para worktree",
                              icon: <GitFork size={15} />,
                              disabled: moveLocalDisabled,
                              onClick: onMoveLocalToWorktree
                            }
                          : {
                              label: "Checkout local",
                              icon: <Home size={15} />,
                              disabled: checkoutLocalDisabled,
                              onClick: () => onHandoffLocal(worktree)
                            },
                        {
                          label: "Remover",
                          icon: <Trash2 size={15} />,
                          danger: true,
                          disabled: worktree.isCurrent,
                          onClick: () => onDelete(worktree)
                        }
                      ]}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BranchTable({
  branches,
  onCheckout,
  onDelete
}: {
  branches: BranchRecord[];
  onCheckout: (branch: BranchRecord) => void;
  onDelete: (branch: BranchRecord) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Atual</th>
            <th>Upstream</th>
            <th>Último Commit</th>
            <th>Data</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {branches.map((branch) => (
            <tr key={`${branch.isRemote ? "remote" : "local"}-${branch.name}`}>
              <td>
                <span className={branch.isRemote ? "remote-name" : ""}>{branch.name}</span>
              </td>
              <td>
                {branch.current ? (
                  <span className="badge blue">Atual</span>
                ) : branch.isRemote ? (
                  <span className="badge neutral">Remota</span>
                ) : (
                  "-"
                )}
              </td>
              <td>{branch.upstream ? <span className="badge purple">{branch.upstream}</span> : "-"}</td>
              <td>{branch.lastCommit?.subject ?? "-"}</td>
              <td>{relativeDate(branch.lastCommit?.date)}</td>
              <td>
                <div className="inline-actions">
                  <button
                    className="icon-button compact"
                    title="Trocar para esta branch"
                    disabled={branch.current || branch.isRemote}
                    onClick={() => onCheckout(branch)}
                  >
                    <Play size={15} />
                  </button>
                  <RowActions
                    items={[
                      {
                        label: "Apagar",
                        icon: <Trash2 size={15} />,
                        danger: true,
                        disabled: branch.current || branch.isRemote,
                        onClick: () => onDelete(branch)
                      }
                    ]}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OperationsTable({ operations }: { operations: OperationRecord[] }) {
  if (!operations.length) {
    return <p className="empty-copy">Ainda não há operações registadas.</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Estado</th>
            <th>Comando</th>
            <th>Resumo</th>
            <th>Data</th>
          </tr>
        </thead>
        <tbody>
          {operations.slice(0, 12).map((operation) => (
            <tr key={operation.id}>
              <td>
                <span className={`badge ${operation.status === "success" ? "green" : "danger"}`}>
                  {operation.status === "success" ? "OK" : "Erro"}
                </span>
              </td>
              <td>
                <code>{operation.command} {operation.args.join(" ")}</code>
              </td>
              <td>{operation.summary}</td>
              <td>{relativeDate(operation.finishedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowActions({
  items
}: {
  items: Array<{
    label: string;
    icon: ReactNode;
    danger?: boolean;
    disabled?: boolean;
    onClick: () => void;
  }>;
}) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;

    const margin = 10;
    const gap = 6;
    const menuWidth = 210;
    const estimatedMenuHeight = items.length * 40 + 12;
    const rect = buttonRef.current.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - menuWidth - margin);
    const left = Math.min(Math.max(margin, rect.right - menuWidth), maxLeft);
    const opensAbove =
      rect.bottom + gap + estimatedMenuHeight > window.innerHeight - margin &&
      rect.top > estimatedMenuHeight + margin;
    const top = opensAbove ? rect.top - estimatedMenuHeight - gap : rect.bottom + gap;

    setMenuPosition({
      top: Math.max(margin, top),
      left
    });
  }, [items.length, open]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    function closeOnViewportChange() {
      setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [open]);

  return (
    <div className="row-actions">
      <button
        ref={buttonRef}
        aria-expanded={open}
        aria-haspopup="menu"
        className="icon-button compact"
        title="Ações"
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <MoreVertical size={16} />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="row-menu"
              role="menu"
              style={{ left: menuPosition.left, top: menuPosition.top }}
            >
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  className={item.danger ? "danger-item" : ""}
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

function RepoPicker({
  repos,
  busy,
  onClose,
  onSelect
}: {
  repos: RepoRecord[];
  busy: boolean;
  onClose: () => void;
  onSelect: (path: string) => Promise<void>;
}) {
  const [browser, setBrowser] = useState<FsListResponse | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    void loadPath();
  }, []);

  async function loadPath(path?: string) {
    setLoading(true);
    setLocalError(null);
    try {
      const next = await api.listFs(path);
      setBrowser(next);
      setPathInput(next.path);
    } catch (caught) {
      setLocalError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title="Selecionar Repositório" onClose={onClose}>
      <div className="picker-grid">
        <div className="picker-main">
          <form
            className="path-form"
            onSubmit={(event) => {
              event.preventDefault();
              void loadPath(pathInput);
            }}
          >
            <input value={pathInput} onChange={(event) => setPathInput(event.target.value)} />
            <button className="secondary-button" type="submit">
              Ir
            </button>
          </form>

          {localError ? <div className="inline-error">{localError}</div> : null}

          {browser?.isGitRepo ? (
            <div className="current-folder">
              <FolderGit2 size={18} />
              <span title={browser.path}>{browser.path}</span>
              <button className="primary-button compact-button" disabled={busy} onClick={() => void onSelect(browser.path)}>
                Selecionar pasta atual
              </button>
            </div>
          ) : null}

          <div className="folder-list">
            {loading ? (
              <div className="loading-row">
                <Loader2 className="spin" size={18} />
                A carregar
              </div>
            ) : (
              <>
                {browser?.parent ? (
                  <FolderRow
                    entry={{ name: "..", path: browser.parent, isDirectory: true, isGitRepo: false }}
                    onOpen={() => void loadPath(browser.parent!)}
                  />
                ) : null}
                {browser?.entries.map((entry) => (
                  <FolderRow
                    key={entry.path}
                    entry={entry}
                    onOpen={() => void loadPath(entry.path)}
                    onSelect={entry.isGitRepo ? () => void onSelect(entry.path) : undefined}
                    busy={busy}
                  />
                ))}
              </>
            )}
          </div>
        </div>
        <div className="recent-list">
          <h3>Recentes</h3>
          {repos.length ? (
            repos.map((repo) => (
              <button key={repo.id} onClick={() => void onSelect(repo.path)}>
                <FolderGit2 size={16} />
                <span>{repo.name}</span>
              </button>
            ))
          ) : (
            <p>Nenhum repositório recente.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function FolderRow({
  entry,
  busy,
  onOpen,
  onSelect
}: {
  entry: FsEntry;
  busy?: boolean;
  onOpen: () => void;
  onSelect?: () => void;
}) {
  return (
    <div className="folder-row">
      <button onClick={onOpen}>
        {entry.isGitRepo ? <FolderGit2 size={18} /> : <Folder size={18} />}
        <span>{entry.name}</span>
      </button>
      {onSelect ? (
        <button className="primary-button compact-button" disabled={busy} onClick={onSelect}>
          Selecionar
        </button>
      ) : null}
    </div>
  );
}

function CreateWorktreeDialog({
  branches,
  busy,
  onClose,
  onCreate
}: {
  branches: BranchRecord[];
  busy: boolean;
  onClose: () => void;
  onCreate: (body: { branch: string; newBranch: boolean; name?: string; path?: string }) => void;
}) {
  const [branch, setBranch] = useState("");
  const [name, setName] = useState("");
  const [targetPath, setTargetPath] = useState("");
  const [newBranch, setNewBranch] = useState(true);

  function submit(event: FormEvent) {
    event.preventDefault();
    onCreate({ branch, newBranch, name: name || undefined, path: targetPath || undefined });
  }

  return (
    <Modal title="Nova Worktree" onClose={onClose}>
      <form className="dialog-form" onSubmit={submit}>
        <label>
          Branch
          <input
            list="branches"
            required
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            placeholder="feature/nova-area"
          />
        </label>
        <datalist id="branches">
          {branches.map((item) => (
            <option key={item.name} value={item.name} />
          ))}
        </datalist>
        <label>
          Nome da pasta
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="opcional" />
        </label>
        <label>
          Local completo
          <input
            value={targetPath}
            onChange={(event) => setTargetPath(event.target.value)}
            placeholder="/Users/joseteixeira/Projects/repo-feature"
          />
        </label>
        <label className="check-line">
          <input type="checkbox" checked={newBranch} onChange={(event) => setNewBranch(event.target.checked)} />
          Criar branch nova
        </label>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
            Criar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CreateBranchDialog({
  branches,
  busy,
  onClose,
  onCreate
}: {
  branches: BranchRecord[];
  busy: boolean;
  onClose: () => void;
  onCreate: (body: { name: string; from?: string }) => void;
}) {
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");

  return (
    <Modal title="Nova Branch" onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate({ name, from: from || undefined });
        }}
      >
        <label>
          Nome
          <input required value={name} onChange={(event) => setName(event.target.value)} placeholder="feature/dashboard" />
        </label>
        <label>
          A partir de
          <select value={from} onChange={(event) => setFrom(event.target.value)}>
            <option value="">HEAD atual</option>
            {branches.map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
            Criar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmDeleteDialog({
  title,
  label,
  expected,
  busy,
  onClose,
  onConfirm
}: {
  title: string;
  label: string;
  expected: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState("");

  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(value);
        }}
      >
        <div className="delete-summary">
          <AlertTriangle size={18} />
          <span title={label}>{label}</span>
        </div>
        <label>
          Escreve {expected}
          <input required value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="danger-button" type="submit" disabled={busy || value !== expected}>
            {busy ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
            Apagar
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal">
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button compact" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EmptyState({ loading, onSelectRepo }: { loading: boolean; onSelectRepo: () => void }) {
  return (
    <section className="empty-state">
      <div className="hero-icon">
        {loading ? <Loader2 className="spin" size={32} /> : <Folder size={34} />}
      </div>
      <div>
        <h2>Selecione um repositório para começar</h2>
        <p>Escolha uma pasta de repositório Git local para gerir worktrees e branches.</p>
      </div>
      <button className="primary-button" onClick={onSelectRepo}>
        Selecionar Repositório
      </button>
    </section>
  );
}

function relativeDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const diff = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  const week = day * 7;

  if (diff < minute) return "agora";
  if (diff < hour) return `há ${Math.max(1, Math.floor(diff / minute))} min`;
  if (diff < day) return `há ${Math.floor(diff / hour)} horas`;
  if (diff < week) return `há ${Math.floor(diff / day)} dias`;
  return `há ${Math.floor(diff / week)} semanas`;
}

function basename(value: string) {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value;
}

function sameWorktreePath(left: string, right: string) {
  return normalizeWorktreePath(left) === normalizeWorktreePath(right);
}

function normalizeWorktreePath(value: string) {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").replace(/^\/private\/var\//, "/var/");
}

function isBaseBranch(branch: string) {
  return branch === "main" || branch === "master";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado.";
}

async function copyPath(path: string, setError: (value: string | null) => void) {
  try {
    await navigator.clipboard.writeText(path);
  } catch {
    setError("Não foi possível copiar o caminho.");
  }
}

function readWorkspaceRepoIds(): string[] {
  try {
    const value = window.localStorage.getItem(ACTIVE_REPOS_STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function persistWorkspaceRepoIds(repoIds: string[]) {
  try {
    window.localStorage.setItem(ACTIVE_REPOS_STORAGE_KEY, JSON.stringify(repoIds));
  } catch {
    // Browsers can disable storage; the app still works for the current session.
  }
}

function readFocusedWorktreePaths(knownRepoIds: string[]): FocusedWorktreeMap {
  try {
    const value = window.localStorage.getItem(FOCUSED_WORKTREES_STORAGE_KEY);
    if (!value) return {};
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([repoId, worktreePath]) =>
          knownRepoIds.includes(repoId) && typeof worktreePath === "string" && worktreePath.trim()
      )
    ) as FocusedWorktreeMap;
  } catch {
    return {};
  }
}

function persistFocusedWorktreePaths(focusMap: FocusedWorktreeMap) {
  try {
    window.localStorage.setItem(FOCUSED_WORKTREES_STORAGE_KEY, JSON.stringify(focusMap));
  } catch {
    // Browsers can disable storage; the app still works for the current session.
  }
}

function uniqueIds(repoIds: string[]) {
  return repoIds.filter((repoId, index) => repoIds.indexOf(repoId) === index);
}
