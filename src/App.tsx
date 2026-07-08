import { Fragment, FormEvent, ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  Monitor,
  MoreVertical,
  Moon,
  Plus,
  RefreshCcw,
  Settings,
  Search,
  Sun,
  TerminalSquare,
  Trash2,
  X
} from "lucide-react";
import { api } from "./api";
import type {
  BranchRecord,
  FsEntry,
  FsListResponse,
  GitStatusSummary,
  OpenTarget,
  OperationRecord,
  RepoDetail,
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
  | SensitiveActionDialogState
  | null;

type SensitiveActionDialogState = {
  kind: "sensitive-action";
  title: string;
  description: string;
  confirmLabel: string;
  details: Array<{ label: string; value: string }>;
  steps?: string[];
  warnings?: string[];
  onConfirm: () => Promise<void> | void;
};

type RepoSummaryMap = Record<string, RepoSummary>;
type RepoErrorMap = Record<string, string>;
type FocusedWorktreeMap = Record<string, string>;
type ThemePreference = "dark" | "light" | "system";
type AppPage = "dashboard" | "detail" | "worktrees" | "branches" | "operations" | "settings";
type WorktreeFilter = "all" | "current" | "dirty" | "clean" | "ahead" | "behind" | "detached";
type BranchFilter = "all" | "local" | "remote" | "current" | "ahead" | "behind" | "no-upstream";
type OperationFilter = "all" | "success" | "error" | "timeout";

const ACTIVE_REPOS_STORAGE_KEY = "worktree-manager.activeRepoIds";
const FOCUSED_WORKTREES_STORAGE_KEY = "worktree-manager.focusedWorktreePaths";
const THEME_STORAGE_KEY = "worktree-manager.theme";
const DEFAULT_PAGE: AppPage = "dashboard";

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
  const [detail, setDetail] = useState<RepoDetail | null>(null);
  const [detailWorktreePath, setDetailWorktreePath] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => readThemePreference());
  const [activePage, setActivePage] = useState<AppPage>(() => readPageFromHash());
  const refreshRequestId = useRef(0);
  const skipNextWorkspaceRefresh = useRef(false);

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
            commitCount: totals.commitCount + item.commitCount,
            dirtyWorktreeCount: totals.dirtyWorktreeCount + (item.dirtyWorktreeCount ?? 0),
            changedFileCount: totals.changedFileCount + (item.changedFileCount ?? 0),
            stashCount: totals.stashCount + (item.stashCount ?? 0),
            branchAheadCount: totals.branchAheadCount + (item.branchAheadCount ?? 0),
            branchBehindCount: totals.branchBehindCount + (item.branchBehindCount ?? 0)
          };
        },
        {
          worktreeCount: 0,
          branchCount: 0,
          commitCount: 0,
          dirtyWorktreeCount: 0,
          changedFileCount: 0,
          stashCount: 0,
          branchAheadCount: 0,
          branchBehindCount: 0
        }
      ),
    [repoSummaries, workspaceRepoIds]
  );

  useEffect(() => {
    void loadInitialState();
  }, []);

  useEffect(() => {
    function handleHashChange() {
      setActivePage(readPageFromHash());
    }

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  useEffect(() => {
    persistThemePreference(themePreference);
    return applyThemePreference(themePreference);
  }, [themePreference]);

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

    if (skipNextWorkspaceRefresh.current) {
      skipNextWorkspaceRefresh.current = false;
      return;
    }

    void refreshDashboard(selectedRepoId, workspaceRepoIds, focusedWorktreePaths);
  }, [focusedWorktreePaths, selectedRepoId, workspaceHydrated, workspaceRepoIds]);

  useEffect(() => {
    if (!workspaceHydrated || activePage !== "detail" || !selectedRepoId) return;

    const requestedPath =
      detailWorktreePath ??
      (selectedRepoId ? focusedWorktreePaths[selectedRepoId] : undefined) ??
      selectedRepo?.path;
    void refreshDetail(selectedRepoId, requestedPath ?? undefined);
  }, [activePage, detailWorktreePath, focusedWorktreePaths, selectedRepo?.path, selectedRepoId, workspaceHydrated]);

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
    const requestId = ++refreshRequestId.current;
    let effectiveFocusMap = focusMap;
    let selectedFocusPath: string | undefined = effectiveFocusMap[repoId];
    setLoading(true);
    setError(null);
    try {
      let focusWasReset = false;
      let [nextWorktrees, nextBranches] = await Promise.all([
        api.worktrees(repoId, selectedFocusPath),
        api.branches(repoId, selectedFocusPath)
      ]).catch(async (caught) => {
        if (!selectedFocusPath || !isInvalidFocusedWorktreeError(caught)) {
          throw caught;
        }

        effectiveFocusMap = { ...effectiveFocusMap };
        delete effectiveFocusMap[repoId];
        selectedFocusPath = undefined;
        focusWasReset = true;

        return Promise.all([api.worktrees(repoId), api.branches(repoId)]);
      });

      const [summaryResults, nextOperations] = await Promise.all([
        Promise.all(
          repoIds.map(async (activeRepoId) => {
            try {
              return {
                repoId: activeRepoId,
                summary: await api.summary(activeRepoId, effectiveFocusMap[activeRepoId]),
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
        api.operations()
      ]);

      if (requestId !== refreshRequestId.current) return;

      if (focusWasReset) {
        skipNextWorkspaceRefresh.current = true;
        setFocusedWorktreePaths(effectiveFocusMap);
        setError("A worktree em foco já não existe. Voltei ao workspace local.");
      }

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
      if (requestId !== refreshRequestId.current) return;
      setError(errorMessage(caught));
    } finally {
      if (requestId === refreshRequestId.current) {
        setLoading(false);
      }
    }
  }

  async function refreshDetail(repoId = selectedRepoId, worktreePath?: string) {
    if (!repoId) return;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const nextDetail = await api.detail(repoId, worktreePath);
      setDetail(nextDetail);
      setDetailWorktreePath(nextDetail.worktree.path);
    } catch (caught) {
      if (worktreePath && isInvalidFocusedWorktreeError(caught)) {
        setDetailWorktreePath(null);
        const fallbackDetail = await api.detail(repoId);
        setDetail(fallbackDetail);
        setDetailError("A worktree selecionada já não existe. Mostro o workspace local.");
        return;
      }

      setDetail(null);
      setDetailError(errorMessage(caught));
    } finally {
      setDetailLoading(false);
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

  async function runExternalAction(label: string, action: () => Promise<unknown>) {
    setActionLoading(label);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setActionLoading(null);
    }
  }

  function openExternalPath(path: string, target: OpenTarget) {
    void runExternalAction(openTargetActionLabel(target), () => api.openPath(path, target));
  }

  function requestSensitiveAction(action: Omit<SensitiveActionDialogState, "kind">) {
    setDialog({ kind: "sensitive-action", ...action });
  }

  function confirmBranchCheckout(branch: BranchRecord) {
    if (!selectedRepoId || !selectedRepo) return;

    const repoId = selectedRepoId;
    const worktreePath = selectedFocusedWorktreePath ?? selectedRepo.path;
    const branchName = branch.name;

    requestSensitiveAction({
      title: "Confirmar checkout de branch",
      description: "Esta operação muda a branch da worktree em foco. O Git pode bloquear se existirem alterações locais incompatíveis.",
      confirmLabel: "Confirmar checkout",
      details: [
        { label: "Repositório", value: selectedRepo.name },
        { label: "Worktree", value: worktreePath },
        { label: "Branch destino", value: branchName }
      ],
      warnings: sensitiveWarningsForPath(worktreePath),
      onConfirm: () =>
        runAction(`Checkout ${branchName}`, () =>
          api.checkoutBranch(repoId, branchName, worktreePath)
        )
    });
  }

  function confirmPull(worktreePath: string | undefined, mode: "detail" | "focused") {
    if (!selectedRepoId || !selectedRepo) return;

    const repoId = selectedRepoId;
    const targetPath = worktreePath ?? selectedFocusedWorktreePath ?? selectedRepo.path;

    requestSensitiveAction({
      title: "Confirmar pull",
      description: "Esta operação executa git pull --ff-only e pode atualizar ficheiros no workspace selecionado.",
      confirmLabel: "Executar pull",
      details: [
        { label: "Repositório", value: selectedRepo.name },
        { label: "Worktree", value: targetPath },
        { label: "Comando", value: "git pull --ff-only" }
      ],
      warnings: sensitiveWarningsForPath(targetPath),
      onConfirm: () =>
        mode === "detail"
          ? runDetailAction("Pull", () => api.pullRepo(repoId, targetPath))
          : runAction("Pull", () => api.pullRepo(repoId, targetPath))
    });
  }

  function confirmHandoffWorktreeToLocal(worktree: WorktreeRecord) {
    if (!selectedRepo) return;

    requestSensitiveAction({
      title: "Confirmar handoff para local",
      description: "A branch desta worktree vai passar para o workspace local e a worktree de origem ficará detached.",
      confirmLabel: "Confirmar checkout local",
      details: [
        { label: "Repositório", value: selectedRepo.name },
        { label: "Branch", value: worktree.branch ?? "detached" },
        { label: "Origem", value: worktree.path },
        { label: "Destino local", value: selectedRepo.path }
      ],
      steps: [
        "Guardar alterações não commitadas numa stash temporária.",
        "Fazer detach da branch na worktree de origem.",
        "Fazer checkout da branch no workspace local.",
        "Reaplicar as alterações não commitadas no workspace local."
      ],
      warnings: [
        "A worktree de origem deixa de ter a branch checked out.",
        ...sensitiveWarningsForPath(worktree.path)
      ],
      onConfirm: () => handoffWorktreeToLocal(worktree)
    });
  }

  function confirmMoveLocalBranchToWorktree() {
    if (!selectedRepo) return;

    const localWorktree = findKnownWorktree(selectedRepo.path);
    const branch = localWorktree?.branch ?? selectedSummary?.currentBranch ?? "branch atual";

    requestSensitiveAction({
      title: "Confirmar mover para worktree",
      description: "A branch local atual vai passar para uma worktree, deixando o workspace local em main ou master.",
      confirmLabel: "Confirmar mover",
      details: [
        { label: "Repositório", value: selectedRepo.name },
        { label: "Branch", value: branch },
        { label: "Workspace local", value: selectedRepo.path },
        { label: "Destino", value: "Worktree existente compatível ou nova pasta padrão" }
      ],
      steps: [
        "Reutilizar uma worktree detached existente, quando existir.",
        "Guardar alterações não commitadas locais numa stash temporária.",
        "Fazer checkout de main ou master no workspace local.",
        "Guardar alterações existentes na worktree de destino.",
        "Fazer checkout da branch na worktree.",
        "Reaplicar as alterações não commitadas na worktree."
      ],
      warnings: sensitiveWarningsForPath(selectedRepo.path),
      onConfirm: () => moveLocalBranchToWorktree()
    });
  }

  async function runConfirmedSensitiveAction(action: SensitiveActionDialogState) {
    setDialog(null);
    await action.onConfirm();
  }

  function findKnownWorktree(worktreePath: string): WorktreeRecord | null {
    const candidates = detail?.worktrees ? [...worktrees, ...detail.worktrees] : worktrees;
    return candidates.find((worktree) => sameWorktreePath(worktree.path, worktreePath)) ?? null;
  }

  function sensitiveWarningsForPath(worktreePath: string): string[] {
    const knownWorktree = findKnownWorktree(worktreePath);
    const status =
      knownWorktree?.status ??
      (detail && sameWorktreePath(detail.worktree.path, worktreePath) ? detail.status : null);

    if (!status || status.clean) return [];

    const warnings = [`Esta worktree tem ${formatChangeCount(status.total)} não commitadas.`];
    if (status.conflicted) {
      warnings.push(`${status.conflicted === 1 ? "Existe" : "Existem"} ${formatConflictCount(status.conflicted)} nesta worktree.`);
    }
    if (status.untracked) {
      warnings.push(
        `${status.untracked === 1 ? "Existe" : "Existem"} ${status.untracked} ${
          status.untracked === 1 ? "ficheiro novo" : "ficheiros novos"
        } por seguir.`
      );
    }
    return warnings;
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

  function openRepoDetail(repoId: string) {
    const repo = repos.find((item) => item.id === repoId);
    setSelectedRepoId(repoId);
    setDetailWorktreePath(repo?.path ?? null);
    navigateToPage("detail");
  }

  function openWorktreeDetail(worktree: WorktreeRecord) {
    setDetailWorktreePath(worktree.path);
    navigateToPage("detail");
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

  async function runDetailAction(label: string, action: () => Promise<unknown>) {
    if (!selectedRepoId) return;
    const repoId = selectedRepoId;
    const repoIds = workspaceRepoIds;
    const currentDetailPath = detail?.worktree.path ?? detailWorktreePath ?? undefined;

    setActionLoading(label);
    setError(null);
    setDetailError(null);
    try {
      await action();
      await Promise.all([
        refreshDashboard(repoId, repoIds, focusedWorktreePaths),
        refreshDetail(repoId, currentDetailPath)
      ]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setActionLoading(null);
    }
  }

  async function refreshOperations() {
    setLoading(true);
    setError(null);
    try {
      setOperations(await api.operations());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  const localBranches = branches.filter((branch) => !branch.isRemote);
  const navItems: Array<{ page: AppPage; label: string; icon: ReactNode }> = [
    { page: "dashboard", label: "Dashboard", icon: <Home size={18} /> },
    { page: "detail", label: "Detalhe", icon: <FolderGit2 size={18} /> },
    { page: "worktrees", label: "Worktrees", icon: <GitFork size={18} /> },
    { page: "branches", label: "Branches", icon: <GitBranch size={18} /> },
    { page: "operations", label: "Operações", icon: <TerminalSquare size={18} /> },
    { page: "settings", label: "Configurações", icon: <Settings size={18} /> }
  ];
  const pageMeta = getPageMeta(activePage);

  function navigateToPage(page: AppPage) {
    setActivePage(page);
    setSidebarOpen(false);
    if (window.location.hash !== `#${page}`) {
      window.location.hash = page;
    }
  }

  function renderRepoHero() {
    if (!selectedSummary) return null;

    return (
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
          {selectedSummary.changedFileCount ? (
            <span className="badge amber">{formatChangeCount(selectedSummary.changedFileCount)}</span>
          ) : (
            <span className="badge green">Sem alterações</span>
          )}
          {selectedSummary.stashCount ? (
            <span className="badge purple">{formatStashCount(selectedSummary.stashCount)}</span>
          ) : null}
          {renderSyncBadges(selectedSummary)}
          <span>{selectedSummary.gitVersion}</span>
        </div>
      </section>
    );
  }

  function renderRepoStats() {
    if (!selectedSummary) return null;

    return (
      <section className="stats-grid" aria-label="Métricas">
        <StatCard
          tone="purple"
          icon={<GitFork />}
          label="Worktrees"
          value={selectedSummary.worktreeCount}
          detail={selectedSummary.dirtyWorktreeCount ? `${selectedSummary.dirtyWorktreeCount} com alterações` : "Todas limpas"}
        />
        <StatCard tone="blue" icon={<GitBranch />} label="Branches" value={selectedSummary.branchCount} detail="Total" />
        <StatCard tone="green" icon={<CheckCircle2 />} label="Atual" value={selectedSummary.currentBranch} detail="Branch atual" />
        <StatCard
          tone="purple"
          icon={<RefreshCcw />}
          label="Sincronização"
          value={syncLabel(selectedSummary.ahead ?? 0, selectedSummary.behind ?? 0)}
          detail={`${selectedSummary.branchAheadCount ?? 0} ahead / ${selectedSummary.branchBehindCount ?? 0} behind`}
        />
        <StatCard
          tone="amber"
          icon={<AlertTriangle />}
          label="Alterações"
          value={selectedSummary.changedFileCount ?? 0}
          detail={selectedSummary.stashCount ? formatStashCount(selectedSummary.stashCount) : "Sem stash"}
        />
        <StatCard tone="amber" icon={<Code2 />} label="Commits" value={selectedSummary.commitCount} detail="Total" />
      </section>
    );
  }

  function renderFocusedRepoPlaceholder() {
    return (
      <FocusedRepoPlaceholder
        loading={loading}
        repo={selectedRepo}
        error={selectedRepoId ? repoSummaryErrors[selectedRepoId] : null}
      />
    );
  }

  function renderDetailPage() {
    if (!selectedRepo) return renderFocusedRepoPlaceholder();

    return (
      <RepoDetailView
        detail={detail?.repo.id === selectedRepo.id ? detail : null}
        error={detailError}
        loading={detailLoading}
        localWorkspacePath={selectedRepo.path}
        onRefresh={() => void refreshDetail(selectedRepo.id, detail?.worktree.path ?? detailWorktreePath ?? selectedFocusedWorktreePath ?? undefined)}
        onSelectWorktree={openWorktreeDetail}
        onOpen={openExternalPath}
        onCopy={(path) => void copyPath(path, setError)}
        onFetch={(path) => void runDetailAction("Fetch", () => api.fetchRepo(selectedRepo.id, path))}
        onPull={(path) => confirmPull(path, "detail")}
        onHandoffLocal={confirmHandoffWorktreeToLocal}
        onMoveLocalToWorktree={confirmMoveLocalBranchToWorktree}
      />
    );
  }

  function renderWorktreesPage() {
    if (!selectedRepo || !selectedSummary) return renderFocusedRepoPlaceholder();

    return (
      <>
        {renderRepoHero()}
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
            onInspect={openWorktreeDetail}
            onHandoffLocal={confirmHandoffWorktreeToLocal}
            onMoveLocalToWorktree={confirmMoveLocalBranchToWorktree}
            onOpen={openExternalPath}
            onCopy={(path) => void copyPath(path, setError)}
            onDelete={(worktree) => setDialog({ kind: "delete-worktree", worktree })}
          />
        </DashboardSection>
      </>
    );
  }

  function renderBranchesPage() {
    if (!selectedRepo || !selectedSummary) return renderFocusedRepoPlaceholder();

    return (
      <>
        {renderRepoHero()}
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
              <button className="secondary-button" onClick={() => confirmPull(selectedFocusedWorktreePath ?? undefined, "focused")}>
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
            onCheckout={confirmBranchCheckout}
            onDelete={(branch) => setDialog({ kind: "delete-branch", branch })}
          />
        </DashboardSection>
      </>
    );
  }

  function renderOperationsPage() {
    return (
      <DashboardSection
        id="operations"
        title="Operações recentes"
        subtitle="Histórico local dos comandos Git"
        actions={
          <button className="secondary-button" onClick={() => void refreshOperations()}>
            {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            Atualizar
          </button>
        }
      >
        <OperationsTable operations={operations} />
      </DashboardSection>
    );
  }

  function renderSettingsPage() {
    return (
      <DashboardSection id="settings" title="Configurações" subtitle="Preferências locais">
        <div className="settings-grid">
          <div className="settings-item">
            <ThemeControl value={themePreference} onChange={setThemePreference} />
          </div>
          <div className="settings-item">
            <span className="settings-label">Versão</span>
            <strong>v1.0.0</strong>
          </div>
        </div>
      </DashboardSection>
    );
  }

  function renderPageContent() {
    if (activePage === "settings") return renderSettingsPage();
    if (activePage === "operations") return renderOperationsPage();

    if (!workspaceRepos.length) {
      return <EmptyState loading={loading} onSelectRepo={() => setDialog({ kind: "repo-picker" })} />;
    }

    if (activePage === "detail") return renderDetailPage();
    if (activePage === "worktrees") return renderWorktreesPage();
    if (activePage === "branches") return renderBranchesPage();

    return (
      <>
        <WorkspaceOverview
          repos={workspaceRepos}
          selectedRepoId={selectedRepoId}
          summaries={repoSummaries}
          errors={repoSummaryErrors}
          totals={workspaceTotals}
          onSelect={openRepoDetail}
          onRemove={removeRepoFromWorkspace}
          onAdd={() => setDialog({ kind: "repo-picker" })}
          onRefresh={() => void refreshDashboard(selectedRepoId, workspaceRepoIds, focusedWorktreePaths)}
          loading={loading}
        />

        {selectedRepo && selectedSummary ? (
          <>
            {renderRepoHero()}
            {renderRepoStats()}
          </>
        ) : (
          renderFocusedRepoPlaceholder()
        )}
      </>
    );
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <GitFork aria-hidden="true" />
          <span>Worktree Manager</span>
        </div>

        <nav className="nav-stack" aria-label="Navegação">
          <span className="nav-label">Navegação</span>
          {navItems.map((item) => (
            <button
              key={item.page}
              aria-current={activePage === item.page ? "page" : undefined}
              className={activePage === item.page ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() => navigateToPage(item.page)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
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
          <ThemeControl value={themePreference} onChange={setThemePreference} />
          <span>v1.0.0</span>
        </div>
      </aside>

      <main className="main-area" id={activePage}>
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div>
            <h1>{pageMeta.title}</h1>
            <p>{pageMeta.subtitle}</p>
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

        {renderPageContent()}
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

      {dialog?.kind === "sensitive-action" ? (
        <ConfirmSensitiveActionDialog
          action={dialog}
          busy={actionLoading !== null}
          onClose={() => setDialog(null)}
          onConfirm={() => void runConfirmedSensitiveAction(dialog)}
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
  const valueText = String(value);
  const valueClassName = valueText.length > 9 ? "stat-value compact" : "stat-value";

  return (
    <article className={`stat-card ${tone}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-body">
        <span>{label}</span>
        <strong className={valueClassName} title={valueText}>{value}</strong>
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

const CLEAN_GIT_STATUS: GitStatusSummary = {
  staged: 0,
  unstaged: 0,
  untracked: 0,
  conflicted: 0,
  total: 0,
  clean: true
};

function getWorktreeStatus(worktree: WorktreeRecord): GitStatusSummary {
  return worktree.status ?? CLEAN_GIT_STATUS;
}

function matchesWorktreeFilter(worktree: WorktreeRecord, filter: WorktreeFilter): boolean {
  const status = getWorktreeStatus(worktree);

  if (filter === "current") return worktree.isCurrent;
  if (filter === "dirty") return !status.clean;
  if (filter === "clean") return status.clean;
  if (filter === "ahead") return (worktree.ahead ?? 0) > 0;
  if (filter === "behind") return (worktree.behind ?? 0) > 0;
  if (filter === "detached") return worktree.detached || !worktree.branch;
  return true;
}

function matchesBranchFilter(branch: BranchRecord, filter: BranchFilter): boolean {
  if (filter === "local") return !branch.isRemote;
  if (filter === "remote") return branch.isRemote;
  if (filter === "current") return branch.current;
  if (filter === "ahead") return (branch.ahead ?? 0) > 0;
  if (filter === "behind") return (branch.behind ?? 0) > 0;
  if (filter === "no-upstream") return !branch.isRemote && !branch.upstream;
  return true;
}

function matchesOperationFilter(operation: OperationRecord, filter: OperationFilter): boolean {
  if (filter === "success") return operation.status === "success";
  if (filter === "error") return operation.status === "error";
  if (filter === "timeout") return Boolean(operation.timedOut);
  return true;
}

function matchesSearch(values: Array<string | null | undefined>, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  return values.some((value) => normalizeSearchText(value ?? "").includes(normalizedQuery));
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase("pt-PT");
}

function renderWorktreeStatusBadges(worktree: WorktreeRecord, showClean = false) {
  const status = getWorktreeStatus(worktree);

  if (status.clean) {
    return showClean ? <span className="badge green">Limpa</span> : null;
  }

  return (
    <>
      {status.conflicted ? (
        <span className="badge danger">{formatConflictCount(status.conflicted)}</span>
      ) : null}
      <span className="badge amber">{formatChangeCount(status.total)}</span>
      {status.untracked ? (
        <span className="badge purple">{formatUntrackedCount(status.untracked)}</span>
      ) : null}
    </>
  );
}

function renderSyncBadges(
  sync: { ahead?: number; behind?: number; upstream?: string | null },
  showSynced = false
) {
  const ahead = sync.ahead ?? 0;
  const behind = sync.behind ?? 0;

  if (!ahead && !behind) {
    if (!showSynced) return null;
    return <span className={`badge ${sync.upstream ? "green" : "neutral"}`}>{sync.upstream ? "Sync" : "Sem upstream"}</span>;
  }

  return (
    <span className="badges sync-badges">
      {ahead ? <span className="badge amber">Ahead {ahead}</span> : null}
      {behind ? <span className="badge purple">Behind {behind}</span> : null}
    </span>
  );
}

function formatChangeCount(value: number): string {
  return `${value} ${value === 1 ? "alteração" : "alterações"}`;
}

function formatConflictCount(value: number): string {
  return `${value} ${value === 1 ? "conflito" : "conflitos"}`;
}

function formatUntrackedCount(value: number): string {
  return `${value} ${value === 1 ? "nova" : "novas"}`;
}

function formatStashCount(value: number): string {
  return `${value} ${value === 1 ? "stash" : "stashes"}`;
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
  totals: {
    worktreeCount: number;
    branchCount: number;
    commitCount: number;
    dirtyWorktreeCount: number;
    changedFileCount: number;
    stashCount: number;
    branchAheadCount: number;
    branchBehindCount: number;
  };
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
          <AlertTriangle size={18} />
          <strong>{totals.changedFileCount}</strong>
          <span>Alterações</span>
        </div>
        <div>
          <Clock3 size={18} />
          <strong>{totals.stashCount}</strong>
          <span>Stashes</span>
        </div>
        <div>
          <GitBranch size={18} />
          <strong>{totals.branchCount}</strong>
          <span>Branches</span>
        </div>
        <div>
          <RefreshCcw size={18} />
          <strong>{totals.branchAheadCount}</strong>
          <span>Ahead</span>
        </div>
        <div>
          <RefreshCcw size={18} />
          <strong>{totals.branchBehindCount}</strong>
          <span>Behind</span>
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
                    {summary.changedFileCount ? (
                      <span className="badge amber">{formatChangeCount(summary.changedFileCount)}</span>
                    ) : (
                      <span className="badge green">Limpo</span>
                    )}
                    {summary.stashCount ? (
                      <span className="badge purple">{formatStashCount(summary.stashCount)}</span>
                    ) : null}
                    {renderSyncBadges(summary)}
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

function RepoDetailView({
  detail,
  error,
  loading,
  localWorkspacePath,
  onRefresh,
  onSelectWorktree,
  onOpen,
  onCopy,
  onFetch,
  onPull,
  onHandoffLocal,
  onMoveLocalToWorktree
}: {
  detail: RepoDetail | null;
  error: string | null;
  loading: boolean;
  localWorkspacePath: string;
  onRefresh: () => void;
  onSelectWorktree: (worktree: WorktreeRecord) => void;
  onOpen: (path: string, target: OpenTarget) => void;
  onCopy: (path: string) => void;
  onFetch: (path: string) => void;
  onPull: (path: string) => void;
  onHandoffLocal: (worktree: WorktreeRecord) => void;
  onMoveLocalToWorktree: () => void;
}) {
  if (!detail) {
    return (
      <section className="panel focus-placeholder">
        {loading ? <Loader2 className="spin" size={22} /> : <AlertTriangle size={22} />}
        <div>
          <h2>{error ? "Detalhe indisponível" : "A carregar detalhe"}</h2>
          <p>{error ?? "A recolher estado Git da worktree selecionada."}</p>
        </div>
      </section>
    );
  }

  const isLocalWorkspace = sameWorktreePath(detail.worktree.path, localWorkspacePath);
  const checkoutLocalDisabled = isLocalWorkspace || !detail.worktree.branch || detail.worktree.detached || detail.worktree.bare;
  const moveLocalDisabled =
    !isLocalWorkspace ||
    !detail.worktree.branch ||
    detail.worktree.detached ||
    detail.worktree.bare ||
    isBaseBranch(detail.worktree.branch);

  return (
    <>
      {error ? (
        <div className="inline-warning">
          <AlertTriangle size={17} />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="repo-hero detail-hero" aria-label="Detalhe da worktree">
        <div className="hero-left">
          <div className="hero-icon">
            {isLocalWorkspace ? <Home size={34} /> : <GitFork size={34} />}
          </div>
          <div>
            <span>{detail.repo.name}</span>
            <h2>{detail.branch ?? "Detached HEAD"}</h2>
            <p title={detail.worktree.path}>{detail.worktree.path}</p>
          </div>
        </div>
        <div className="detail-hero-actions">
          <button className="secondary-button" onClick={onRefresh}>
            {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            Atualizar
          </button>
          <button className="secondary-button" onClick={() => onOpen(detail.worktree.path, "folder")}>
            <Folder size={16} />
            Pasta
          </button>
          <button className="secondary-button" onClick={() => onOpen(detail.worktree.path, "editor")}>
            <Code2 size={16} />
            Editor
          </button>
          <button className="secondary-button" onClick={() => onOpen(detail.worktree.path, "terminal")}>
            <TerminalSquare size={16} />
            Terminal
          </button>
          <button className="secondary-button" onClick={() => onCopy(detail.worktree.path)}>
            <Copy size={16} />
            Copiar
          </button>
          <button className="secondary-button" onClick={() => onFetch(detail.worktree.path)}>
            <RefreshCcw size={16} />
            Fetch
          </button>
          <button className="secondary-button" onClick={() => onPull(detail.worktree.path)}>
            <RefreshCcw size={16} />
            Pull
          </button>
          {isLocalWorkspace ? (
            <button className="primary-button" disabled={moveLocalDisabled} onClick={onMoveLocalToWorktree}>
              <GitFork size={16} />
              Mover para worktree
            </button>
          ) : (
            <button className="primary-button" disabled={checkoutLocalDisabled} onClick={() => onHandoffLocal(detail.worktree)}>
              <Home size={16} />
              Checkout local
            </button>
          )}
        </div>
      </section>

      <section className="stats-grid detail-stats" aria-label="Estado Git">
        <StatCard tone="green" icon={<GitBranch />} label="Branch" value={detail.branch ?? "detached"} detail={detail.worktree.detached ? "HEAD destacado" : "Branch associada"} />
        <StatCard tone="blue" icon={<GitFork />} label="Upstream" value={detail.upstream ?? "-"} detail="Ramo remoto" />
        <StatCard tone="purple" icon={<RefreshCcw />} label="Sincronização" value={syncLabel(detail.ahead, detail.behind)} detail="Ahead / behind" />
        <StatCard tone="amber" icon={<Clock3 />} label="Último fetch" value={relativeDate(detail.lastFetchAt)} detail="FETCH_HEAD" />
      </section>

      <DashboardSection id="detail-status" title="Estado local" subtitle="Alterações nesta worktree">
        <div className="detail-status-grid">
          <StatusPill label="Total" value={detail.status.total} tone="amber" />
          <StatusPill label="Staged" value={detail.status.staged} tone="green" />
          <StatusPill label="Unstaged" value={detail.status.unstaged} tone="blue" />
          <StatusPill label="Untracked" value={detail.status.untracked} tone="purple" />
          <StatusPill label="Conflitos" value={detail.status.conflicted} tone="danger" />
          <StatusPill label="Stashes" value={detail.stashCount} tone="purple" />
        </div>
        <ChangedFilesTable files={detail.files} />
      </DashboardSection>

      <DashboardSection id="detail-worktrees" title="Worktrees" subtitle="Worktrees deste repositório">
        <div className="detail-worktree-grid">
          {detail.worktrees.map((worktree) => {
            const active = sameWorktreePath(worktree.path, detail.worktree.path);
            const local = sameWorktreePath(worktree.path, localWorkspacePath);

            return (
              <button
                key={worktree.id}
                className={active ? "detail-worktree-card active" : "detail-worktree-card"}
                onClick={() => onSelectWorktree(worktree)}
                title={worktree.path}
              >
                <span className="workspace-card-icon">
                  {local ? <Home size={18} /> : <GitFork size={18} />}
                </span>
                <span>
                  <strong>{worktree.branch ?? "detached"}</strong>
                  <small>{worktree.path}</small>
                </span>
                <span className="badges">
                  {active ? <span className="badge green">Selecionada</span> : null}
                  {local ? <span className="badge blue">Local</span> : null}
                  {renderWorktreeStatusBadges(worktree, true)}
                  {renderSyncBadges(worktree)}
                </span>
              </button>
            );
          })}
        </div>
      </DashboardSection>
    </>
  );
}

function StatusPill({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "green" | "blue" | "purple" | "amber" | "danger";
}) {
  return (
    <div className={`status-pill ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ChangedFilesTable({ files }: { files: RepoDetail["files"] }) {
  if (!files.length) {
    return <p className="empty-copy">Sem alterações locais.</p>;
  }

  return (
    <div className="table-wrap detail-files-table">
      <table>
        <thead>
          <tr>
            <th>Ficheiro</th>
            <th>Estado</th>
            <th>Index</th>
            <th>Worktree</th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <tr key={`${file.indexStatus}${file.worktreeStatus}-${file.path}`}>
              <td>
                <div className="file-path-cell">
                  <span title={file.path}>{file.path}</span>
                  {file.originalPath ? <small title={file.originalPath}>{file.originalPath}</small> : null}
                </div>
              </td>
              <td>
                <span className={`badge ${file.label === "Conflito" ? "danger" : file.label === "Por seguir" ? "purple" : "blue"}`}>
                  {file.label}
                </span>
              </td>
              <td><code>{file.indexStatus}</code></td>
              <td><code>{file.worktreeStatus}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

function TableFilters({
  query,
  onQueryChange,
  placeholder,
  activeFilter,
  onFilterChange,
  filters
}: {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder: string;
  activeFilter: string;
  onFilterChange: (value: string) => void;
  filters: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="table-filter-bar">
      <label className="search-field">
        <Search size={16} />
        <input
          aria-label={placeholder}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
        />
      </label>
      <div className="filter-chips" aria-label="Filtros">
        {filters.map((filter) => (
          <button
            key={filter.value}
            aria-pressed={activeFilter === filter.value}
            type="button"
            onClick={() => onFilterChange(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function WorktreeTable({
  worktrees,
  localWorkspacePath,
  onInspect,
  onHandoffLocal,
  onMoveLocalToWorktree,
  onOpen,
  onCopy,
  onDelete
}: {
  worktrees: WorktreeRecord[];
  localWorkspacePath: string;
  onInspect: (worktree: WorktreeRecord) => void;
  onHandoffLocal: (worktree: WorktreeRecord) => void;
  onMoveLocalToWorktree: () => void;
  onOpen: (path: string, target: OpenTarget) => void;
  onCopy: (path: string) => void;
  onDelete: (worktree: WorktreeRecord) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WorktreeFilter>("all");
  const filteredWorktrees = useMemo(
    () =>
      worktrees.filter((worktree) => {
        if (!matchesWorktreeFilter(worktree, filter)) return false;
        return matchesSearch(
          [
            worktree.path,
            worktree.branch,
            worktree.head,
            worktree.upstream,
            worktree.lastCommit?.subject,
            worktree.lastCommit?.sha
          ],
          query
        );
      }),
    [filter, query, worktrees]
  );

  return (
    <>
      <TableFilters
        query={query}
        onQueryChange={setQuery}
        placeholder="Pesquisar worktrees"
        activeFilter={filter}
        onFilterChange={(value) => setFilter(value as WorktreeFilter)}
        filters={[
          { value: "all", label: "Todas" },
          { value: "current", label: "Em foco" },
          { value: "dirty", label: "Com alterações" },
          { value: "clean", label: "Limpas" },
          { value: "ahead", label: "Ahead" },
          { value: "behind", label: "Behind" },
          { value: "detached", label: "Detached" }
        ]}
      />
      {filteredWorktrees.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Caminho</th>
                <th>Branch</th>
                <th>Sync</th>
                <th>HEAD</th>
                <th>Último Commit</th>
                <th>Data</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredWorktrees.map((worktree) => {
                const isLocalWorkspace = sameWorktreePath(worktree.path, localWorkspacePath);
                const checkoutLocalDisabled = isLocalWorkspace || !worktree.branch || worktree.detached || worktree.bare;
                const moveLocalDisabled =
                  !isLocalWorkspace || !worktree.branch || worktree.detached || worktree.bare || isBaseBranch(worktree.branch);

                return (
                  <tr key={worktree.id}>
                    <td>
                      <button className="path-cell path-button" title={worktree.path} onClick={() => onInspect(worktree)}>
                        {worktree.isCurrent ? <Home size={16} /> : <GitFork size={16} />}
                        <span>{worktree.path}</span>
                      </button>
                    </td>
                    <td>
                      <div className="badges">
                        {worktree.isCurrent ? <span className="badge green">Em foco</span> : null}
                        <span className="badge blue">{worktree.branch ?? "detached"}</span>
                        {renderWorktreeStatusBadges(worktree, true)}
                      </div>
                    </td>
                    <td>{renderSyncBadges(worktree, Boolean(worktree.branch && !worktree.detached))}</td>
                    <td>{worktree.head ? worktree.head.slice(0, 7) : "-"}</td>
                    <td>{worktree.lastCommit?.subject ?? "-"}</td>
                    <td>{relativeDate(worktree.lastCommit?.date)}</td>
                    <td>
                      <div className="inline-actions">
                        <RowActions
                          items={[
                            { label: "Abrir pasta", icon: <Folder size={15} />, onClick: () => onOpen(worktree.path, "folder") },
                            { label: "Abrir no editor", icon: <Code2 size={15} />, onClick: () => onOpen(worktree.path, "editor") },
                            { label: "Abrir no terminal", icon: <TerminalSquare size={15} />, onClick: () => onOpen(worktree.path, "terminal") },
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
      ) : (
        <p className="empty-copy">Sem worktrees para os filtros atuais.</p>
      )}
      <p className="table-foot">
        Mostrando {filteredWorktrees.length} de {worktrees.length} worktrees
      </p>
    </>
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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<BranchFilter>("all");
  const filteredBranches = useMemo(
    () =>
      branches.filter((branch) => {
        if (!matchesBranchFilter(branch, filter)) return false;
        return matchesSearch(
          [
            branch.name,
            branch.upstream,
            branch.head,
            branch.lastCommit?.subject,
            branch.lastCommit?.sha
          ],
          query
        );
      }),
    [branches, filter, query]
  );

  return (
    <>
      <TableFilters
        query={query}
        onQueryChange={setQuery}
        placeholder="Pesquisar branches"
        activeFilter={filter}
        onFilterChange={(value) => setFilter(value as BranchFilter)}
        filters={[
          { value: "all", label: "Todas" },
          { value: "local", label: "Locais" },
          { value: "remote", label: "Remotas" },
          { value: "current", label: "Atual" },
          { value: "ahead", label: "Ahead" },
          { value: "behind", label: "Behind" },
          { value: "no-upstream", label: "Sem upstream" }
        ]}
      />
      {filteredBranches.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Atual</th>
                <th>Upstream</th>
                <th>Sync</th>
                <th>Último Commit</th>
                <th>Data</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredBranches.map((branch) => (
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
                  <td>{branch.isRemote ? "-" : renderSyncBadges(branch, true)}</td>
                  <td>{branch.lastCommit?.subject ?? "-"}</td>
                  <td>{relativeDate(branch.lastCommit?.date)}</td>
                  <td>
                    <div className="inline-actions">
                      <RowActions
                        items={[
                          {
                            label: "Checkout nesta worktree",
                            icon: <GitBranch size={15} />,
                            disabled: branch.current || branch.isRemote,
                            onClick: () => onCheckout(branch)
                          },
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
      ) : (
        <p className="empty-copy">Sem branches para os filtros atuais.</p>
      )}
      <p className="table-foot">
        Mostrando {filteredBranches.length} de {branches.length} branches
      </p>
    </>
  );
}

function OperationsTable({ operations }: { operations: OperationRecord[] }) {
  const [expandedOperationId, setExpandedOperationId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<OperationFilter>("all");
  const filteredOperations = useMemo(
    () =>
      operations.filter((operation) => {
        if (!matchesOperationFilter(operation, filter)) return false;
        return matchesSearch(
          [
            formatCommand(operation),
            operation.cwd,
            operation.summary,
            operation.status,
            operation.stdout,
            operation.stderr
          ],
          query
        );
      }),
    [filter, operations, query]
  );

  if (!operations.length) {
    return <p className="empty-copy">Ainda não há operações registadas.</p>;
  }

  return (
    <>
      <TableFilters
        query={query}
        onQueryChange={setQuery}
        placeholder="Pesquisar operações"
        activeFilter={filter}
        onFilterChange={(value) => setFilter(value as OperationFilter)}
        filters={[
          { value: "all", label: "Todas" },
          { value: "success", label: "OK" },
          { value: "error", label: "Erro" },
          { value: "timeout", label: "Timeout" }
        ]}
      />
      {filteredOperations.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Estado</th>
                <th>Comando</th>
                <th>Resumo</th>
                <th>Duração</th>
                <th>Data</th>
                <th>Logs</th>
              </tr>
            </thead>
            <tbody>
              {filteredOperations.slice(0, 24).map((operation) => {
                const expanded = expandedOperationId === operation.id;
                const command = formatCommand(operation);

                return (
                  <Fragment key={operation.id}>
                    <tr className="operation-row">
                      <td>
                        <span className={`badge ${operation.status === "success" ? "green" : "danger"}`}>
                          {operation.status === "success" ? "OK" : "Erro"}
                        </span>
                        {operation.timedOut ? <span className="badge amber">Timeout</span> : null}
                      </td>
                      <td>
                        <div className="operation-command">
                          <code>{command}</code>
                          <small title={operation.cwd}>{operation.cwd}</small>
                        </div>
                      </td>
                      <td>{operation.summary}</td>
                      <td>{formatDuration(operation.durationMs)}</td>
                      <td>{relativeDate(operation.finishedAt)}</td>
                      <td>
                        <button
                          aria-expanded={expanded}
                          aria-label={`${expanded ? "Ocultar" : "Ver"} logs de ${command}`}
                          className="icon-button compact operation-toggle"
                          title={expanded ? "Ocultar logs" : "Ver logs"}
                          type="button"
                          onClick={() => setExpandedOperationId(expanded ? null : operation.id)}
                        >
                          <TerminalSquare size={16} />
                        </button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="operation-detail-row">
                        <td colSpan={6}>
                          <OperationDetail operation={operation} command={command} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-copy">Sem operações para os filtros atuais.</p>
      )}
      <p className="table-foot">
        Mostrando {Math.min(filteredOperations.length, 24)} de {operations.length} operações
      </p>
    </>
  );
}

function OperationDetail({
  operation,
  command
}: {
  operation: OperationRecord;
  command: string;
}) {
  return (
    <div className="operation-detail">
      <div className="operation-meta-grid">
        <div>
          <span>Comando</span>
          <code>{command}</code>
        </div>
        <div>
          <span>Diretório</span>
          <code title={operation.cwd}>{operation.cwd}</code>
        </div>
        <div>
          <span>Exit code</span>
          <strong>{operation.exitCode ?? "-"}</strong>
        </div>
        <div>
          <span>Duração</span>
          <strong>{formatDuration(operation.durationMs)}</strong>
        </div>
        <div>
          <span>Timeout</span>
          <strong>{operation.timeoutMs ? formatDuration(operation.timeoutMs) : "-"}</strong>
        </div>
        <div>
          <span>Sinal</span>
          <strong>{operation.signal ?? "-"}</strong>
        </div>
      </div>

      <div className="log-grid">
        <OperationLogBlock title="stdout" value={operation.stdout ?? ""} truncated={operation.stdoutTruncated} />
        <OperationLogBlock title="stderr" value={operation.stderr} truncated={operation.stderrTruncated} />
      </div>
    </div>
  );
}

function OperationLogBlock({
  title,
  value,
  truncated
}: {
  title: string;
  value: string;
  truncated?: boolean;
}) {
  const output = value.trim();

  return (
    <section className="log-panel">
      <header>
        <h3>{title}</h3>
        {truncated ? <span className="badge amber">Truncado</span> : null}
      </header>
      {output ? <pre>{output}</pre> : <p className="log-empty">Sem output.</p>}
    </section>
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

function ThemeControl({
  value,
  onChange
}: {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
}) {
  const options: Array<{ value: ThemePreference; label: string; icon: ReactNode }> = [
    { value: "dark", label: "Escuro", icon: <Moon size={15} /> },
    { value: "light", label: "Claro", icon: <Sun size={15} /> },
    { value: "system", label: "Sistema", icon: <Monitor size={15} /> }
  ];

  return (
    <div className="theme-control" aria-label="Tema">
      <span>Tema</span>
      <div className="theme-segmented" role="group" aria-label="Escolher tema">
        {options.map((option) => (
          <button
            key={option.value}
            aria-pressed={value === option.value}
            className={value === option.value ? "active" : ""}
            title={option.label}
            type="button"
            onClick={() => onChange(option.value)}
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        ))}
      </div>
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
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const branchListId = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    onCreate({
      branch,
      newBranch: mode === "new",
      name: name || undefined,
      path: targetPath || undefined
    });
  }

  return (
    <Modal title="Nova Worktree" onClose={onClose}>
      <form className="dialog-form" onSubmit={submit}>
        <fieldset className="choice-field">
          <legend>Tipo</legend>
          <div className="choice-grid">
            <button
              type="button"
              aria-pressed={mode === "existing"}
              className={mode === "existing" ? "active" : ""}
              onClick={() => setMode("existing")}
            >
              <GitBranch size={16} />
              Branch existente
            </button>
            <button
              type="button"
              aria-pressed={mode === "new"}
              className={mode === "new" ? "active" : ""}
              onClick={() => setMode("new")}
            >
              <Plus size={16} />
              Nova branch
            </button>
          </div>
        </fieldset>
        <label>
          {mode === "new" ? "Nova branch" : "Branch existente"}
          <input
            list={mode === "existing" ? branchListId : undefined}
            required
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            placeholder={mode === "new" ? "feature/nova-area" : "feature/auth"}
          />
        </label>
        <datalist id={branchListId}>
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

function ConfirmSensitiveActionDialog({
  action,
  busy,
  onClose,
  onConfirm
}: {
  action: SensitiveActionDialogState;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title={action.title} onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <div className="sensitive-summary">
          <AlertTriangle size={18} />
          <p>{action.description}</p>
        </div>

        <dl className="confirmation-details">
          {action.details.map((detail) => (
            <div key={detail.label}>
              <dt>{detail.label}</dt>
              <dd title={detail.value}>{detail.value}</dd>
            </div>
          ))}
        </dl>

        {action.steps?.length ? (
          <div className="confirmation-block">
            <h3>Passos previstos</h3>
            <ol>
              {action.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        ) : null}

        {action.warnings?.length ? (
          <div className="confirmation-warnings">
            {action.warnings.map((warning) => (
              <p key={warning}>
                <AlertTriangle size={15} />
                <span>{warning}</span>
              </p>
            ))}
          </div>
        ) : null}

        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
            {action.confirmLabel}
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
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = modalRef.current;
    const firstFocusable = modal ? getFocusableElements(modal)[0] : null;

    (firstFocusable ?? modal)?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !modalRef.current) return;

      const focusable = getFocusableElements(modalRef.current);
      if (!focusable.length) {
        event.preventDefault();
        modalRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1);
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !modalRef.current.contains(active))) {
        event.preventDefault();
        last?.focus();
      }

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousActiveElement?.isConnected) {
        previousActiveElement.focus();
      }
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
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

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
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

function formatDuration(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  if (value < 1_000) return `${Math.max(0, Math.round(value))} ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(value / 60_000)} min ${Math.round((value % 60_000) / 1_000)} s`;
}

function formatCommand(operation: OperationRecord) {
  return [operation.command, ...operation.args.map(formatCommandArg)].join(" ");
}

function formatCommandArg(value: string) {
  if (!value) return '""';
  if (/^[a-zA-Z0-9_./:=@%+-]+$/.test(value)) return value;
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function openTargetActionLabel(target: OpenTarget) {
  if (target === "editor") return "Abrir no editor";
  if (target === "terminal") return "Abrir no terminal";
  return "Abrir pasta";
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

function getPageMeta(page: AppPage) {
  const meta: Record<AppPage, { title: string; subtitle: string }> = {
    dashboard: {
      title: "Dashboard",
      subtitle: "Visão geral da área de trabalho e do repositório em foco"
    },
    detail: {
      title: "Detalhe",
      subtitle: "Estado Git da worktree selecionada"
    },
    worktrees: {
      title: "Worktrees",
      subtitle: "Gerir worktrees do repositório em foco"
    },
    branches: {
      title: "Branches",
      subtitle: "Gerir branches e sincronização Git"
    },
    operations: {
      title: "Operações",
      subtitle: "Histórico local dos comandos Git"
    },
    settings: {
      title: "Configurações",
      subtitle: "Preferências locais da aplicação"
    }
  };

  return meta[page];
}

function readPageFromHash(): AppPage {
  const value = window.location.hash.replace(/^#/, "");
  return isAppPage(value) ? value : DEFAULT_PAGE;
}

function isAppPage(value: unknown): value is AppPage {
  return (
    value === "dashboard" ||
    value === "detail" ||
    value === "worktrees" ||
    value === "branches" ||
    value === "operations" ||
    value === "settings"
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Erro inesperado.";
}

function isInvalidFocusedWorktreeError(error: unknown) {
  return errorMessage(error).includes("worktree selecionada não pertence");
}

function syncLabel(ahead: number, behind: number) {
  if (!ahead && !behind) return "Sync";
  if (ahead && behind) return `A${ahead} / B${behind}`;
  return ahead ? `Ahead ${ahead}` : `Behind ${behind}`;
}

async function copyPath(path: string, setError: (value: string | null) => void) {
  try {
    await navigator.clipboard.writeText(path);
  } catch {
    setError("Não foi possível copiar o caminho.");
  }
}

function readThemePreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

function persistThemePreference(theme: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Browsers can disable storage; the current theme still applies for the session.
  }
}

function applyThemePreference(theme: ThemePreference) {
  const root = document.documentElement;
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");

  function syncTheme() {
    const resolvedTheme = theme === "system" ? (media?.matches ? "dark" : "light") : theme;
    root.dataset.theme = resolvedTheme;
    root.dataset.themePreference = theme;
    root.style.colorScheme = resolvedTheme;
  }

  syncTheme();

  if (theme !== "system" || !media) return undefined;

  if (media.addEventListener) {
    media.addEventListener("change", syncTheme);
  } else {
    media.addListener(syncTheme);
  }

  return () => {
    if (media.removeEventListener) {
      media.removeEventListener("change", syncTheme);
    } else {
      media.removeListener(syncTheme);
    }
  };
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "dark" || value === "light" || value === "system";
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
