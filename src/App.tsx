import { Component, ErrorInfo, Fragment, FormEvent, KeyboardEvent, ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Command as CommandIcon,
  Code2,
  Copy,
  Database,
  EyeOff,
  Folder,
  FolderGit2,
  GitBranch,
  GitFork,
  HelpCircle,
  Home,
  Languages,
  Loader2,
  Menu,
  Monitor,
  MoreVertical,
  Moon,
  Plug,
  Plus,
  RefreshCcw,
  Settings,
  Search,
  Shield,
  ShieldCheck,
  ShieldOff,
  Sun,
  TerminalSquare,
  Trash2,
  X
} from "lucide-react";
import { api } from "./api";
import type {
  BranchRecord,
  DiagnosticsSnapshot,
  FsEntry,
  FsListResponse,
  GitStatusSummary,
  IntegrationCatalog,
  IntegrationRecord,
  Locale,
  OpenTarget,
  AppSettings,
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
  | { kind: "guided-workflow"; workflowId: GuidedWorkflowId }
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
type AppPage =
  | "dashboard"
  | "detail"
  | "workflows"
  | "worktrees"
  | "branches"
  | "operations"
  | "integrations"
  | "privacy"
  | "help"
  | "settings";
type WorktreeFilter = "all" | "current" | "dirty" | "clean" | "ahead" | "behind" | "detached";
type BranchFilter = "all" | "local" | "remote" | "current" | "ahead" | "behind" | "no-upstream";
type OperationFilter = "all" | "success" | "error" | "timeout";
type GuidedWorkflowId =
  | "parallel-worktree"
  | "handoff-local"
  | "local-to-worktree"
  | "sync-focused"
  | "review-changes";
type WorkflowStatusTone = "ready" | "attention" | "blocked";
type GuidedWorkflowDefinition = {
  id: GuidedWorkflowId;
  title: string;
  description: string;
  section: string;
  icon: ReactNode;
  status: WorkflowStatusTone;
  statusLabel: string;
  steps: string[];
  requirements: string[];
  primaryLabel: string;
  secondaryLabel?: string;
  disabled?: boolean;
};
type GuidedWorkflowRunOptions = {
  worktreeId?: string;
};
type CommandPaletteAction = {
  id: string;
  title: string;
  subtitle?: string;
  section: string;
  keywords?: string[];
  shortcut?: string;
  icon: ReactNode;
  run: () => void;
};
type ToastRecord = {
  id: string;
  tone: "success" | "error" | "info";
  title: string;
  detail?: string;
};

const ACTIVE_REPOS_STORAGE_KEY = "worktree-manager.activeRepoIds";
const FOCUSED_WORKTREES_STORAGE_KEY = "worktree-manager.focusedWorktreePaths";
const THEME_STORAGE_KEY = "worktree-manager.theme";
const ONBOARDING_STORAGE_KEY = "worktree-manager.onboardingDismissed";
const DEFAULT_PAGE: AppPage = "dashboard";

const PAGE_COPY: Record<Locale, Record<AppPage, { nav: string; title: string; subtitle: string }>> = {
  pt: {
    dashboard: {
      nav: "Dashboard",
      title: "Dashboard",
      subtitle: "Visão geral da área de trabalho e do repositório em foco"
    },
    detail: {
      nav: "Detalhe",
      title: "Detalhe",
      subtitle: "Estado Git da worktree selecionada"
    },
    workflows: {
      nav: "Workflows",
      title: "Workflows",
      subtitle: "Operações guiadas para trabalho em paralelo"
    },
    worktrees: {
      nav: "Worktrees",
      title: "Worktrees",
      subtitle: "Gerir worktrees do repositório em foco"
    },
    branches: {
      nav: "Branches",
      title: "Branches",
      subtitle: "Gerir branches e sincronização Git"
    },
    operations: {
      nav: "Operações",
      title: "Operações",
      subtitle: "Histórico local dos comandos Git"
    },
    integrations: {
      nav: "Integrações",
      title: "Integrações",
      subtitle: "Editor, terminal e ferramentas externas"
    },
    privacy: {
      nav: "Dados e privacidade",
      title: "Dados e privacidade",
      subtitle: "Local-first, telemetria e dados guardados"
    },
    help: {
      nav: "Ajuda",
      title: "Ajuda",
      subtitle: "Atalhos, acessibilidade e primeiros passos"
    },
    settings: {
      nav: "Configurações",
      title: "Configurações",
      subtitle: "Preferências locais da aplicação"
    }
  },
  en: {
    dashboard: {
      nav: "Dashboard",
      title: "Dashboard",
      subtitle: "Workspace and focused repository overview"
    },
    detail: {
      nav: "Detail",
      title: "Detail",
      subtitle: "Git status for the selected worktree"
    },
    workflows: {
      nav: "Workflows",
      title: "Workflows",
      subtitle: "Guided operations for parallel work"
    },
    worktrees: {
      nav: "Worktrees",
      title: "Worktrees",
      subtitle: "Manage worktrees in the focused repository"
    },
    branches: {
      nav: "Branches",
      title: "Branches",
      subtitle: "Manage branches and Git synchronization"
    },
    operations: {
      nav: "Operations",
      title: "Operations",
      subtitle: "Local history of Git commands"
    },
    integrations: {
      nav: "Integrations",
      title: "Integrations",
      subtitle: "Editor, terminal and external tools"
    },
    privacy: {
      nav: "Data and privacy",
      title: "Data and privacy",
      subtitle: "Local-first behavior, telemetry and stored data"
    },
    help: {
      nav: "Help",
      title: "Help",
      subtitle: "Shortcuts, accessibility and first steps"
    },
    settings: {
      nav: "Settings",
      title: "Settings",
      subtitle: "Local application preferences"
    }
  }
};

const EMPTY_COPY = {
  pt: {
    title: "Selecione um repositório para começar",
    description: "Escolha uma pasta de repositório Git local para gerir worktrees e branches.",
    action: "Selecionar Repositório"
  },
  en: {
    title: "Select a repository to get started",
    description: "Choose a local Git repository folder to manage worktrees and branches.",
    action: "Select Repository"
  }
} satisfies Record<Locale, { title: string; description: string; action: string }>;

const ONBOARDING_COPY = {
  pt: {
    title: "Primeiro arranque",
    description: "Em menos de um minuto ficas com o workspace pronto para trabalho paralelo.",
    action: "Selecionar repositório",
    dismiss: "Ignorar",
    steps: [
      "Seleciona uma pasta Git local.",
      "Adiciona mais repositórios à área de trabalho quando precisares.",
      "Usa Workflows para handoff, sync e revisão com confirmação prévia."
    ]
  },
  en: {
    title: "First run",
    description: "Get the workspace ready for parallel Git work in under a minute.",
    action: "Select repository",
    dismiss: "Dismiss",
    steps: [
      "Select a local Git folder.",
      "Add more repositories to the workspace whenever needed.",
      "Use Workflows for handoff, sync and review with confirmation first."
    ]
  }
} satisfies Record<Locale, { title: string; description: string; action: string; dismiss: string; steps: string[] }>;

const HELP_COPY = {
  pt: {
    introTitle: "Centro de ajuda rápido",
    intro:
      "Os comandos principais estão acessíveis por teclado, mouse e leitores de ecrã. A navegação mantém-se disponível mesmo quando há erros inline.",
    shortcutsTitle: "Atalhos de teclado",
    shortcutsSubtitle: "Referência rápida para navegação sem tirar as mãos do teclado",
    accessibilityTitle: "Acessibilidade",
    accessibility:
      "Todos os controlos novos têm estados de foco visíveis, etiquetas ARIA e navegação por teclado. As mensagens de estado usam regiões live.",
    i18nTitle: "Idioma",
    i18n: "A base de internacionalização já suporta Português e Inglês nas páginas principais, onboarding, ajuda e preferências.",
    shortcuts: [
      { keys: ["Cmd", "K"], label: "Paleta de comandos", description: "Abre ações, navegação, repos e workflows." },
      { keys: ["Ctrl", "K"], label: "Paleta de comandos", description: "Alternativa para Windows e Linux." },
      { keys: ["↑", "↓"], label: "Navegar resultados", description: "Percorre opções dentro da paleta." },
      { keys: ["Enter"], label: "Executar", description: "Executa a opção ativa." },
      { keys: ["Esc"], label: "Fechar", description: "Fecha menus, modais e a paleta." },
      { keys: ["Tab"], label: "Foco seguinte", description: "Percorre botões, filtros e campos." }
    ]
  },
  en: {
    introTitle: "Quick help center",
    intro:
      "Core commands are available through keyboard, mouse and screen readers. Navigation remains available even when inline errors appear.",
    shortcutsTitle: "Keyboard shortcuts",
    shortcutsSubtitle: "Quick reference for keyboard-first navigation",
    accessibilityTitle: "Accessibility",
    accessibility:
      "New controls include visible focus states, ARIA labels and keyboard navigation. Status messages use live regions.",
    i18nTitle: "Language",
    i18n: "The i18n foundation already supports Portuguese and English across primary pages, onboarding, help and preferences.",
    shortcuts: [
      { keys: ["Cmd", "K"], label: "Command palette", description: "Open actions, navigation, repositories and workflows." },
      { keys: ["Ctrl", "K"], label: "Command palette", description: "Alternative for Windows and Linux." },
      { keys: ["↑", "↓"], label: "Navigate results", description: "Move through options in the palette." },
      { keys: ["Enter"], label: "Run", description: "Run the active option." },
      { keys: ["Esc"], label: "Close", description: "Close menus, dialogs and the palette." },
      { keys: ["Tab"], label: "Next focus", description: "Move through buttons, filters and fields." }
    ]
  }
} satisfies Record<
  Locale,
  {
    introTitle: string;
    intro: string;
    shortcutsTitle: string;
    shortcutsSubtitle: string;
    accessibilityTitle: string;
    accessibility: string;
    i18nTitle: string;
    i18n: string;
    shortcuts: Array<{ keys: string[]; label: string; description: string }>;
  }
>;

const PRIVACY_COPY = {
  pt: {
    heroTitle: "Nada sai da máquina sem autorização",
    heroDescription:
      "Worktree Manager é local-first. Repositórios, branches, worktrees, diagnósticos e preferências ficam guardados localmente. Não existe telemetria remota implementada.",
    copyReport: "Copiar relatório local",
    copied: "Copiado",
    telemetryTitle: "Telemetria",
    telemetryStatus: "Inexistente",
    telemetryDescription:
      "A aplicação não envia métricas, eventos, erros, nomes de repositórios, caminhos ou comandos para serviços externos.",
    localDataTitle: "Dados locais",
    localDataDescription: "Dados que podem ficar guardados no ficheiro local da app ou no localStorage do browser.",
    stateFile: "Ficheiro de estado",
    repositories: "Repositórios recentes",
    operations: "Operações registadas",
    preferences: "Preferências locais",
    outboundTitle: "Ações que podem sair da máquina",
    outboundDescription:
      "Apenas ações iniciadas pelo utilizador, como fetch/pull contra remotos Git ou abrir ferramentas externas, podem contactar sistemas fora da app.",
    auditTitle: "Auditoria",
    auditDescription:
      "Diagnósticos e relatórios são gerados localmente. Copiar JSON coloca os dados na área de transferência para tu decidires onde os partilhar.",
    storedItems: [
      "Lista de repositórios recentes e timestamps de abertura.",
      "Histórico local dos últimos comandos Git executados pela app.",
      "Preferências como tema, idioma, modo seguro e integrações.",
      "Estado visual local: repositórios ativos, worktree em foco e onboarding dispensado."
    ],
    outboundItems: [
      "Git fetch/pull comunica com os remotos configurados no teu repositório.",
      "Abrir editor/terminal/pasta delega a ação ao sistema operativo.",
      "Copiar diagnóstico ou relatório só escreve na área de transferência local."
    ]
  },
  en: {
    heroTitle: "Nothing leaves your machine without permission",
    heroDescription:
      "Worktree Manager is local-first. Repositories, branches, worktrees, diagnostics and preferences stay local. Remote telemetry is not implemented.",
    copyReport: "Copy local report",
    copied: "Copied",
    telemetryTitle: "Telemetry",
    telemetryStatus: "Not implemented",
    telemetryDescription:
      "The app does not send metrics, events, errors, repository names, paths or commands to external services.",
    localDataTitle: "Local data",
    localDataDescription: "Data that may be stored in the app state file or browser localStorage.",
    stateFile: "State file",
    repositories: "Recent repositories",
    operations: "Recorded operations",
    preferences: "Local preferences",
    outboundTitle: "Actions that can leave the machine",
    outboundDescription:
      "Only user-initiated actions, such as fetch/pull against Git remotes or opening external tools, can contact systems outside the app.",
    auditTitle: "Audit",
    auditDescription:
      "Diagnostics and reports are generated locally. Copying JSON places data on the clipboard so you decide where to share it.",
    storedItems: [
      "Recent repository list and opening timestamps.",
      "Local history of recent Git commands run by the app.",
      "Preferences such as theme, language, safe mode and integrations.",
      "Local UI state: active repositories, focused worktree and dismissed onboarding."
    ],
    outboundItems: [
      "Git fetch/pull communicates with remotes configured in your repository.",
      "Opening editor/terminal/folder delegates the action to the operating system.",
      "Copying diagnostics or reports only writes to the local clipboard."
    ]
  }
} satisfies Record<
  Locale,
  {
    heroTitle: string;
    heroDescription: string;
    copyReport: string;
    copied: string;
    telemetryTitle: string;
    telemetryStatus: string;
    telemetryDescription: string;
    localDataTitle: string;
    localDataDescription: string;
    stateFile: string;
    repositories: string;
    operations: string;
    preferences: string;
    outboundTitle: string;
    outboundDescription: string;
    auditTitle: string;
    auditDescription: string;
    storedItems: string[];
    outboundItems: string[];
  }
>;

const SETTINGS_COPY = {
  pt: {
    language: "Idioma",
    languageAria: "Escolher idioma",
    portuguese: "Português",
    english: "English",
    version: "Versão"
  },
  en: {
    language: "Language",
    languageAria: "Choose language",
    portuguese: "Português",
    english: "English",
    version: "Version"
  }
} satisfies Record<
  Locale,
  { language: string; languageAria: string; portuguese: string; english: string; version: string }
>;

const A11Y_COPY = {
  pt: {
    progress: "Ação em curso",
    openNavigation: "Abrir navegação",
    closeNavigation: "Fechar navegação",
    openCommands: "Abrir comandos",
    dismissAlert: "Dispensar erro"
  },
  en: {
    progress: "Action in progress",
    openNavigation: "Open navigation",
    closeNavigation: "Close navigation",
    openCommands: "Open commands",
    dismissAlert: "Dismiss error"
  }
} satisfies Record<Locale, { progress: string; openNavigation: string; closeNavigation: string; openCommands: string; dismissAlert: string }>;

const SHELL_COPY = {
  pt: {
    navigation: "Navegação",
    workspace: "Área de trabalho",
    activeRepository: "repositório ativo",
    activeRepositories: "repositórios ativos",
    addRepository: "Adicionar Repositório",
    addRepositoryLower: "Adicionar repositório",
    selectRepository: "Selecionar repositório",
    commands: "Comandos"
  },
  en: {
    navigation: "Navigation",
    workspace: "Workspace",
    activeRepository: "active repository",
    activeRepositories: "active repositories",
    addRepository: "Add Repository",
    addRepositoryLower: "Add repository",
    selectRepository: "Select repository",
    commands: "Commands"
  }
} satisfies Record<
  Locale,
  {
    navigation: string;
    workspace: string;
    activeRepository: string;
    activeRepositories: string;
    addRepository: string;
    addRepositoryLower: string;
    selectRepository: string;
    commands: string;
  }
>;

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Erro de UI capturado", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <AppCrashFallback
          message={this.state.error.message}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }

    return this.props.children;
  }
}

export function App() {
  return (
    <AppErrorBoundary>
      <WorktreeManagerApp />
    </AppErrorBoundary>
  );
}

function WorktreeManagerApp() {
  const [repos, setRepos] = useState<RepoRecord[]>([]);
  const [workspaceRepoIds, setWorkspaceRepoIds] = useState<string[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [repoSummaries, setRepoSummaries] = useState<RepoSummaryMap>({});
  const [repoSummaryErrors, setRepoSummaryErrors] = useState<RepoErrorMap>({});
  const [focusedWorktreePaths, setFocusedWorktreePaths] = useState<FocusedWorktreeMap>({});
  const [worktrees, setWorktrees] = useState<WorktreeRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [operations, setOperations] = useState<OperationRecord[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null);
  const [integrationCatalog, setIntegrationCatalog] = useState<IntegrationCatalog | null>(null);
  const [detail, setDetail] = useState<RepoDetail | null>(null);
  const [detailWorktreePath, setDetailWorktreePath] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => readThemePreference());
  const [settings, setSettings] = useState<AppSettings>({
    safeMode: true,
    locale: "pt",
    integrations: {
      editor: "auto",
      terminal: "auto"
    }
  });
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => readBooleanFlag(ONBOARDING_STORAGE_KEY));
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const [privacyReportCopied, setPrivacyReportCopied] = useState(false);
  const [activePage, setActivePage] = useState<AppPage>(() => readPageFromHash());
  const refreshRequestId = useRef(0);
  const skipNextWorkspaceRefresh = useRef(false);
  const toastId = useRef(0);

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
  const locale = settings.locale ?? "pt";
  const pageCopy = PAGE_COPY[locale] ?? PAGE_COPY.pt;
  const emptyCopy = EMPTY_COPY[locale] ?? EMPTY_COPY.pt;
  const onboardingCopy = ONBOARDING_COPY[locale] ?? ONBOARDING_COPY.pt;
  const helpCopy = HELP_COPY[locale] ?? HELP_COPY.pt;
  const privacyCopy = PRIVACY_COPY[locale] ?? PRIVACY_COPY.pt;
  const settingsCopy = SETTINGS_COPY[locale] ?? SETTINGS_COPY.pt;
  const a11yCopy = A11Y_COPY[locale] ?? A11Y_COPY.pt;
  const shellCopy = SHELL_COPY[locale] ?? SHELL_COPY.pt;
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
    function handleGlobalKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    }

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
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
    setLoading(true);
    try {
      const [repoList, operationList, appSettings, integrations, diagnosticsSnapshot] = await Promise.all([
        api.listRepos(),
        api.operations(),
        api.getSettings(),
        api.integrations(),
        api.diagnostics()
      ]);
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
      setSettings(appSettings);
      setIntegrationCatalog(integrations);
      setDiagnostics(diagnosticsSnapshot);
      setFocusedWorktreePaths(readFocusedWorktreePaths(repoList.map((repo) => repo.id)));
      setWorkspaceRepoIds(initialActiveIds);
      setSelectedRepoId(initialActiveIds[0] ?? null);
      setWorkspaceHydrated(true);
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: "Arranque falhou", detail: message });
    } finally {
      setLoading(false);
    }
  }

  function notify(toast: Omit<ToastRecord, "id">, durationMs = 3_800) {
    const id = `toast-${++toastId.current}`;
    setToasts((items) => [...items, { ...toast, id }].slice(-4));
    window.setTimeout(() => dismissToast(id), durationMs);
  }

  function dismissToast(id: string) {
    setToasts((items) => items.filter((toast) => toast.id !== id));
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

      const [summaryResults, nextOperations, diagnosticsSnapshot] = await Promise.all([
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
        api.operations(),
        api.diagnostics()
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
      setDiagnostics(diagnosticsSnapshot);
    } catch (caught) {
      if (requestId !== refreshRequestId.current) return;
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: "Atualização falhou", detail: message });
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
      setDiagnostics(await api.diagnostics());
      notify({ tone: "success", title: "Repositório adicionado", detail: repo.name });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: "Não foi possível adicionar", detail: message });
      await recordUiError("select_repository_failed", message, { path });
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
      notify({ tone: "success", title: "Ação concluída", detail: label });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: "Ação falhou", detail: message });
      await recordUiError("action_failed", message, { label });
    } finally {
      setActionLoading(null);
    }
  }

  async function runExternalAction(label: string, action: () => Promise<unknown>) {
    setActionLoading(label);
    setError(null);
    try {
      await action();
      notify({ tone: "success", title: "Ação concluída", detail: label });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: "Ação falhou", detail: message });
      await recordUiError("external_action_failed", message, { label });
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

  async function updateSafeMode(safeMode: boolean) {
    setActionLoading("settings");
    setError(null);
    try {
      const nextSettings = await api.updateSettings({ safeMode });
      setSettings(nextSettings);
      setDiagnostics(await api.diagnostics());
      notify({ tone: "success", title: "Modo seguro atualizado", detail: safeMode ? "Ativo" : "Desligado" });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: "Configuração falhou", detail: message });
      await recordUiError("update_settings_failed", message, { safeMode });
    } finally {
      setActionLoading(null);
    }
  }

  async function updateLocale(nextLocale: Locale) {
    setActionLoading("settings");
    setError(null);
    try {
      const nextSettings = await api.updateSettings({ locale: nextLocale });
      setSettings(nextSettings);
      setDiagnostics(await api.diagnostics());
      notify({
        tone: "success",
        title: nextLocale === "pt" ? "Idioma atualizado" : "Language updated"
      });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: "Configuração falhou", detail: message });
      await recordUiError("update_locale_failed", message, { locale: nextLocale });
    } finally {
      setActionLoading(null);
    }
  }

  async function refreshIntegrations() {
    setActionLoading("integrations");
    setError(null);
    try {
      setIntegrationCatalog(await api.integrations());
      notify({ tone: "success", title: "Integrações atualizadas" });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: "Deteção falhou", detail: message });
      await recordUiError("refresh_integrations_failed", message);
    } finally {
      setActionLoading(null);
    }
  }

  async function updateIntegrations(nextIntegrations: AppSettings["integrations"]) {
    setActionLoading("integrations");
    setError(null);
    try {
      const nextSettings = await api.updateSettings({ integrations: nextIntegrations });
      const nextCatalog = await api.integrations();
      setSettings(nextSettings);
      setIntegrationCatalog(nextCatalog);
      notify({ tone: "success", title: "Integração guardada" });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: "Integração falhou", detail: message });
      await recordUiError("update_integrations_failed", message, nextIntegrations);
    } finally {
      setActionLoading(null);
    }
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
      notify({ tone: "success", title: "Handoff concluído", detail: result.branch });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: "Handoff falhou", detail: message });
      await recordUiError("handoff_worktree_to_local_failed", message, { repoId, worktree: worktree.path });
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
      notify({ tone: "success", title: "Branch movida para worktree", detail: result.branch });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: "Handoff falhou", detail: message });
      await recordUiError("move_local_branch_to_worktree_failed", message, { repoId });
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
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: "Detalhe falhou", detail: message });
      await recordUiError("detail_action_failed", message, {
        label,
        repoId,
        worktreePath: currentDetailPath ?? null
      });
    } finally {
      setActionLoading(null);
    }
  }

  async function refreshOperations() {
    setLoading(true);
    setError(null);
    try {
      const [nextOperations, diagnosticsSnapshot] = await Promise.all([
        api.operations(),
        api.diagnostics()
      ]);
      setOperations(nextOperations);
      setDiagnostics(diagnosticsSnapshot);
      notify({ tone: "success", title: "Operações atualizadas" });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: "Atualização falhou", detail: message });
      await recordUiError("refresh_operations_failed", message);
    } finally {
      setLoading(false);
    }
  }

  async function refreshDiagnostics() {
    setActionLoading("diagnostics");
    setError(null);
    try {
      setDiagnostics(await api.diagnostics());
      notify({ tone: "success", title: "Diagnóstico atualizado" });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: "Diagnóstico falhou", detail: message });
      await recordUiError("refresh_diagnostics_failed", message);
    } finally {
      setActionLoading(null);
    }
  }

  async function copyDiagnostics() {
    setActionLoading("diagnostics-copy");
    setError(null);
    try {
      const snapshot = await api.diagnostics();
      setDiagnostics(snapshot);
      await writeClipboard(JSON.stringify(snapshot, null, 2));
      setDiagnosticsCopied(true);
      window.setTimeout(() => setDiagnosticsCopied(false), 1800);
      notify({ tone: "success", title: "Diagnóstico copiado" });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: "Cópia falhou", detail: message });
      await recordUiError("copy_diagnostics_failed", message);
    } finally {
      setActionLoading(null);
    }
  }

  async function copyPrivacyReport() {
    setActionLoading("privacy-copy");
    setError(null);
    try {
      const report = buildPrivacyReport({
        diagnostics,
        operations,
        repos,
        workspaceRepos,
        settings,
        themePreference,
        focusedWorktreePaths,
        onboardingDismissed
      });
      await writeClipboard(JSON.stringify(report, null, 2));
      setPrivacyReportCopied(true);
      window.setTimeout(() => setPrivacyReportCopied(false), 1800);
      notify({ tone: "success", title: locale === "pt" ? "Relatório copiado" : "Report copied" });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: locale === "pt" ? "Cópia falhou" : "Copy failed", detail: message });
      await recordUiError("copy_privacy_report_failed", message);
    } finally {
      setActionLoading(null);
    }
  }

  async function recordUiError(name: string, message: string, context: Record<string, unknown> = {}) {
    try {
      await api.recordDiagnosticEvent({
        level: "error",
        name,
        message,
        context: {
          page: activePage,
          selectedRepoId,
          ...context
        }
      });
      const [nextOperations, diagnosticsSnapshot] = await Promise.all([
        api.operations(),
        api.diagnostics()
      ]);
      setOperations(nextOperations);
      setDiagnostics(diagnosticsSnapshot);
    } catch {
      // Diagnostic logging must never mask the original user-facing error.
    }
  }

  const localBranches = branches.filter((branch) => !branch.isRemote);
  const navItems: Array<{ page: AppPage; label: string; icon: ReactNode }> = [
    { page: "dashboard", label: pageCopy.dashboard.nav, icon: <Home size={18} /> },
    { page: "detail", label: pageCopy.detail.nav, icon: <FolderGit2 size={18} /> },
    { page: "workflows", label: pageCopy.workflows.nav, icon: <CheckCircle2 size={18} /> },
    { page: "worktrees", label: pageCopy.worktrees.nav, icon: <GitFork size={18} /> },
    { page: "branches", label: pageCopy.branches.nav, icon: <GitBranch size={18} /> },
    { page: "operations", label: pageCopy.operations.nav, icon: <TerminalSquare size={18} /> },
    { page: "integrations", label: pageCopy.integrations.nav, icon: <Plug size={18} /> },
    { page: "privacy", label: pageCopy.privacy.nav, icon: <Shield size={18} /> },
    { page: "help", label: pageCopy.help.nav, icon: <HelpCircle size={18} /> },
    { page: "settings", label: pageCopy.settings.nav, icon: <Settings size={18} /> }
  ];
  const pageMeta = pageCopy[activePage];
  const guidedWorkflows = buildGuidedWorkflows();
  const commandActions = buildCommandActions();

  function navigateToPage(page: AppPage) {
    setActivePage(page);
    setSidebarOpen(false);
    if (window.location.hash !== `#${page}`) {
      window.location.hash = page;
    }
  }

  function runCommandAction(action: CommandPaletteAction) {
    setCommandPaletteOpen(false);
    window.setTimeout(action.run, 0);
  }

  function dismissOnboarding() {
    setOnboardingDismissed(true);
    persistBooleanFlag(ONBOARDING_STORAGE_KEY, true);
  }

  function openGuidedWorkflow(workflowId: GuidedWorkflowId) {
    setCommandPaletteOpen(false);
    setDialog({ kind: "guided-workflow", workflowId });
  }

  function runGuidedWorkflow(workflowId: GuidedWorkflowId, options: GuidedWorkflowRunOptions = {}) {
    setDialog(null);

    if (!selectedRepo) {
      setDialog({ kind: "repo-picker" });
      return;
    }

    const focusedPath = selectedFocusedWorktreePath ?? selectedRepo.path;

    if (workflowId === "parallel-worktree") {
      setDialog({ kind: "create-worktree" });
      return;
    }

    if (workflowId === "handoff-local") {
      const worktree =
        worktrees.find((item) => item.id === options.worktreeId) ??
        worktrees.find((item) => !sameWorktreePath(item.path, selectedRepo.path) && Boolean(item.branch));
      if (!worktree) {
        setError("Não existe uma worktree elegível para handoff.");
        return;
      }
      confirmHandoffWorktreeToLocal(worktree);
      return;
    }

    if (workflowId === "local-to-worktree") {
      confirmMoveLocalBranchToWorktree();
      return;
    }

    if (workflowId === "sync-focused") {
      confirmPull(focusedPath, "focused");
      return;
    }

    setDetailWorktreePath(focusedPath);
    navigateToPage("detail");
  }

  function runGuidedWorkflowSecondary(workflowId: GuidedWorkflowId) {
    setDialog(null);
    if (!selectedRepo) {
      setDialog({ kind: "repo-picker" });
      return;
    }

    const focusedPath = selectedFocusedWorktreePath ?? selectedRepo.path;
    if (workflowId === "sync-focused") {
      void runAction("Fetch", () => api.fetchRepo(selectedRepo.id, focusedPath));
    }
  }

  function buildGuidedWorkflows(): GuidedWorkflowDefinition[] {
    const focusedPath = selectedFocusedWorktreePath ?? selectedRepo?.path ?? "";
    const focusedWorktree = focusedPath ? findKnownWorktree(focusedPath) : null;
    const changedFiles = focusedWorktree?.status?.total ?? selectedSummary?.changedFileCount ?? 0;
    const blockedWithoutRepo = !selectedRepo;
    const eligibleHandoffWorktrees = selectedRepo
      ? worktrees.filter((worktree) => !sameWorktreePath(worktree.path, selectedRepo.path) && Boolean(worktree.branch))
      : [];
    const localWorktree = selectedRepo ? findKnownWorktree(selectedRepo.path) : null;
    const localBranch = localWorktree?.branch ?? selectedSummary?.currentBranch ?? "branch atual";
    const syncState = syncWorkflowStatus(selectedSummary);

    return [
      {
        id: "parallel-worktree",
        title: "Começar trabalho paralelo",
        description: "Criar uma worktree para uma branch existente ou nova.",
        section: "Worktrees",
        icon: <GitFork size={20} />,
        status: blockedWithoutRepo ? "blocked" : "ready",
        statusLabel: blockedWithoutRepo ? "Sem repositório" : "Pronto",
        steps: [
          "Escolher branch existente ou criar uma nova branch.",
          "Confirmar nome ou caminho da pasta da worktree.",
          "Criar a worktree e passar o foco para ela."
        ],
        requirements: selectedRepo
          ? [`Repositório: ${selectedRepo.name}`, `Worktree em foco: ${basename(focusedPath)}`]
          : ["Seleciona um repositório para começar."],
        primaryLabel: "Criar worktree",
        disabled: blockedWithoutRepo
      },
      {
        id: "handoff-local",
        title: "Handoff de worktree para local",
        description: "Trazer a branch de uma worktree para o workspace local.",
        section: "Handoff",
        icon: <ArrowRight size={20} />,
        status: blockedWithoutRepo || !eligibleHandoffWorktrees.length ? "blocked" : "attention",
        statusLabel: blockedWithoutRepo
          ? "Sem repositório"
          : eligibleHandoffWorktrees.length
            ? `${eligibleHandoffWorktrees.length} disponível${eligibleHandoffWorktrees.length === 1 ? "" : "is"}`
            : "Sem worktree elegível",
        steps: [
          "Guardar alterações não commitadas na worktree de origem.",
          "Fazer detach da branch na worktree de origem.",
          "Fazer checkout da branch no workspace local.",
          "Reaplicar alterações não commitadas no workspace local."
        ],
        requirements: selectedRepo
          ? [
              `Destino local: ${selectedRepo.path}`,
              eligibleHandoffWorktrees.length
                ? "Existe pelo menos uma worktree com branch associada."
                : "Não existe worktree com branch pronta para handoff."
            ]
          : ["Seleciona um repositório para começar."],
        primaryLabel: "Preparar handoff",
        disabled: blockedWithoutRepo || !eligibleHandoffWorktrees.length
      },
      {
        id: "local-to-worktree",
        title: "Handoff de local para worktree",
        description: "Mover a branch local para uma worktree e libertar o workspace local.",
        section: "Handoff",
        icon: <GitFork size={20} />,
        status: blockedWithoutRepo ? "blocked" : changedFiles ? "attention" : "ready",
        statusLabel: blockedWithoutRepo
          ? "Sem repositório"
          : changedFiles
            ? formatChangeCount(changedFiles)
            : "Pronto",
        steps: [
          "Reutilizar uma worktree detached existente quando possível.",
          "Guardar alterações não commitadas locais.",
          "Fazer checkout de main ou master localmente.",
          "Fazer checkout da branch na worktree.",
          "Reaplicar alterações não commitadas na worktree."
        ],
        requirements: selectedRepo
          ? [`Branch local: ${localBranch}`, `Workspace local: ${selectedRepo.path}`]
          : ["Seleciona um repositório para começar."],
        primaryLabel: "Preparar mover",
        disabled: blockedWithoutRepo
      },
      {
        id: "sync-focused",
        title: "Sincronizar worktree em foco",
        description: "Executar fetch ou pull na worktree selecionada.",
        section: "Sincronização",
        icon: <RefreshCcw size={20} />,
        status: blockedWithoutRepo ? "blocked" : syncState.status,
        statusLabel: blockedWithoutRepo ? "Sem repositório" : syncState.label,
        steps: [
          "Confirmar a worktree em foco.",
          "Executar fetch para atualizar referências remotas.",
          "Executar pull --ff-only quando for seguro avançar."
        ],
        requirements: selectedRepo
          ? [
              `Worktree em foco: ${focusedPath}`,
              settings.safeMode ? "Modo seguro ativo." : "Modo seguro desligado."
            ]
          : ["Seleciona um repositório para começar."],
        primaryLabel: "Preparar pull",
        secondaryLabel: "Executar fetch",
        disabled: blockedWithoutRepo
      },
      {
        id: "review-changes",
        title: "Rever alterações locais",
        description: "Abrir o detalhe da worktree em foco para ver ficheiros alterados.",
        section: "Revisão",
        icon: <Search size={20} />,
        status: blockedWithoutRepo ? "blocked" : changedFiles ? "attention" : "ready",
        statusLabel: blockedWithoutRepo
          ? "Sem repositório"
          : changedFiles
            ? formatChangeCount(changedFiles)
            : "Sem alterações",
        steps: [
          "Abrir a vista de detalhe da worktree em foco.",
          "Rever ficheiros staged, unstaged e por seguir.",
          "Decidir entre commit, stash, handoff ou limpeza manual."
        ],
        requirements: selectedRepo
          ? [`Worktree em foco: ${focusedPath}`, `${formatChangeCount(changedFiles)} detetadas.`]
          : ["Seleciona um repositório para começar."],
        primaryLabel: "Abrir detalhe",
        disabled: blockedWithoutRepo
      }
    ];
  }

  function buildCommandActions(): CommandPaletteAction[] {
    const actions: CommandPaletteAction[] = navItems.map((item) => ({
      id: `page:${item.page}`,
      title: `Ir para ${item.label}`,
      subtitle: getPageMeta(item.page, locale).subtitle,
      section: "Navegação",
      keywords: [item.page, item.label],
      shortcut: item.page === activePage ? "Atual" : undefined,
      icon: item.icon,
      run: () => navigateToPage(item.page)
    }));

    actions.push({
      id: "repo:add",
      title: repos.length ? "Adicionar repositório" : "Selecionar repositório",
      subtitle: "Abrir o navegador de pastas local",
      section: "Repositório",
      keywords: ["repo", "git", "pasta", "selecionar"],
      icon: <Folder size={18} />,
      run: () => setDialog({ kind: "repo-picker" })
    });

    guidedWorkflows.forEach((workflow) => {
      actions.push({
        id: `workflow:${workflow.id}`,
        title: `Workflow: ${workflow.title}`,
        subtitle: workflow.statusLabel,
        section: "Workflows",
        keywords: ["workflow", "guiado", workflow.title, workflow.section, workflow.statusLabel],
        shortcut: workflow.disabled ? "Bloqueado" : undefined,
        icon: workflow.icon,
        run: () => openGuidedWorkflow(workflow.id)
      });
    });

    workspaceRepos.forEach((repo) => {
      actions.push({
        id: `repo:select:${repo.id}`,
        title: `Ativar repositório: ${repo.name}`,
        subtitle: repo.path,
        section: "Workspace",
        keywords: ["repo", "workspace", repo.name, repo.path],
        shortcut: repo.id === selectedRepoId ? "Ativo" : undefined,
        icon: <FolderGit2 size={18} />,
        run: () => setSelectedRepoId(repo.id)
      });
      actions.push({
        id: `repo:detail:${repo.id}`,
        title: `Abrir detalhe: ${repo.name}`,
        subtitle: repo.path,
        section: "Workspace",
        keywords: ["detalhe", "repo", repo.name, repo.path],
        icon: <ArrowRight size={18} />,
        run: () => openRepoDetail(repo.id)
      });
    });

    if (!selectedRepo) return actions;

    const focusedPath = selectedFocusedWorktreePath ?? selectedRepo.path;
    actions.push(
      {
        id: "repo:refresh",
        title: "Atualizar dashboard",
        subtitle: selectedRepo.name,
        section: "Ações",
        keywords: ["refresh", "recarregar", "atualizar"],
        icon: <RefreshCcw size={18} />,
        run: () => void refreshDashboard(selectedRepoId, workspaceRepoIds, focusedWorktreePaths)
      },
      {
        id: "repo:fetch",
        title: "Executar fetch",
        subtitle: `git fetch --prune em ${basename(focusedPath)}`,
        section: "Git",
        keywords: ["fetch", "prune", "remoto"],
        icon: <RefreshCcw size={18} />,
        run: () => void runAction("Fetch", () => api.fetchRepo(selectedRepo.id, focusedPath))
      },
      {
        id: "repo:pull",
        title: "Executar pull",
        subtitle: `git pull --ff-only em ${basename(focusedPath)}`,
        section: "Git",
        keywords: ["pull", "ff", "atualizar"],
        icon: <GitBranch size={18} />,
        run: () => confirmPull(focusedPath, "focused")
      },
      {
        id: "worktree:create",
        title: "Criar worktree",
        subtitle: selectedRepo.name,
        section: "Worktrees",
        keywords: ["nova", "criar", "worktree"],
        icon: <GitFork size={18} />,
        run: () => setDialog({ kind: "create-worktree" })
      },
      {
        id: "branch:create",
        title: "Criar branch",
        subtitle: basename(focusedPath),
        section: "Branches",
        keywords: ["nova", "criar", "branch"],
        icon: <GitBranch size={18} />,
        run: () => setDialog({ kind: "create-branch" })
      },
      {
        id: "local:move-to-worktree",
        title: "Mover branch local para worktree",
        subtitle: "Handoff do workspace local para uma worktree",
        section: "Worktrees",
        keywords: ["handoff", "mover", "local", "worktree"],
        icon: <GitFork size={18} />,
        run: confirmMoveLocalBranchToWorktree
      },
      {
        id: "open:folder",
        title: "Abrir pasta em foco",
        subtitle: focusedPath,
        section: "Abrir",
        keywords: ["abrir", "finder", "folder", "pasta"],
        icon: <Folder size={18} />,
        run: () => openExternalPath(focusedPath, "folder")
      },
      {
        id: "open:editor",
        title: "Abrir em editor",
        subtitle: focusedPath,
        section: "Abrir",
        keywords: ["abrir", "editor", "code"],
        icon: <Code2 size={18} />,
        run: () => openExternalPath(focusedPath, "editor")
      },
      {
        id: "open:terminal",
        title: "Abrir no terminal",
        subtitle: focusedPath,
        section: "Abrir",
        keywords: ["abrir", "terminal", "shell"],
        icon: <TerminalSquare size={18} />,
        run: () => openExternalPath(focusedPath, "terminal")
      }
    );

    worktrees.forEach((worktree) => {
      const title = worktree.branch ? `Focar worktree: ${worktree.branch}` : `Focar worktree: ${basename(worktree.path)}`;
      actions.push({
        id: `worktree:focus:${worktree.id}`,
        title,
        subtitle: worktree.path,
        section: "Worktrees",
        keywords: ["focar", "worktree", worktree.branch ?? "", worktree.path],
        shortcut: worktree.isCurrent ? "Foco" : undefined,
        icon: <GitFork size={18} />,
        run: () => {
          setFocusedWorktreePaths((focusMap) => ({ ...focusMap, [selectedRepo.id]: worktree.path }));
          openWorktreeDetail(worktree);
        }
      });

      if (!sameWorktreePath(worktree.path, selectedRepo.path) && worktree.branch) {
        actions.push({
          id: `worktree:handoff:${worktree.id}`,
          title: `Handoff para local: ${worktree.branch}`,
          subtitle: worktree.path,
          section: "Worktrees",
          keywords: ["handoff", "local", "checkout", worktree.branch, worktree.path],
          icon: <ArrowRight size={18} />,
          run: () => confirmHandoffWorktreeToLocal(worktree)
        });
      }
    });

    localBranches
      .filter((branch) => !branch.current)
      .forEach((branch) => {
        actions.push({
          id: `branch:checkout:${branch.name}`,
          title: `Checkout branch: ${branch.name}`,
          subtitle: branch.upstream ?? "Branch local",
          section: "Branches",
          keywords: ["checkout", "switch", "branch", branch.name, branch.upstream ?? ""],
          icon: <GitBranch size={18} />,
          run: () => confirmBranchCheckout(branch)
        });
      });

    actions.push(
      {
        id: "settings:safe-mode",
        title: settings.safeMode ? "Desligar modo seguro" : "Ativar modo seguro",
        subtitle: "Pré-validação para operações Git sensíveis",
        section: "Configurações",
        keywords: ["safe", "seguro", "modo"],
        icon: settings.safeMode ? <ShieldOff size={18} /> : <ShieldCheck size={18} />,
        run: () => void updateSafeMode(!settings.safeMode)
      },
      {
        id: "settings:theme:dark",
        title: "Tema escuro",
        subtitle: "Aplicar tema escuro",
        section: "Configurações",
        keywords: ["tema", "escuro", "dark"],
        shortcut: themePreference === "dark" ? "Atual" : undefined,
        icon: <Moon size={18} />,
        run: () => setThemePreference("dark")
      },
      {
        id: "settings:theme:light",
        title: "Tema claro",
        subtitle: "Aplicar tema claro",
        section: "Configurações",
        keywords: ["tema", "claro", "light"],
        shortcut: themePreference === "light" ? "Atual" : undefined,
        icon: <Sun size={18} />,
        run: () => setThemePreference("light")
      },
      {
        id: "settings:theme:system",
        title: "Tema do sistema",
        subtitle: "Seguir preferência do sistema",
        section: "Configurações",
        keywords: ["tema", "sistema", "system"],
        shortcut: themePreference === "system" ? "Atual" : undefined,
        icon: <Monitor size={18} />,
        run: () => setThemePreference("system")
      }
    );

    return actions;
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

  function renderWorkflowsPage() {
    if (!workspaceRepos.length) {
      return (
        <EmptyState
          loading={loading}
          copy={emptyCopy}
          onSelectRepo={() => setDialog({ kind: "repo-picker" })}
        />
      );
    }

    return (
      <>
        {selectedRepo && selectedSummary ? renderRepoHero() : renderFocusedRepoPlaceholder()}
        <DashboardSection
          id="workflows"
          title="Workflows guiados"
          subtitle="Fluxos orientados para operações frequentes e sensíveis"
          actions={
            <button className="secondary-button" onClick={() => void refreshDashboard()}>
              {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
              Atualizar
            </button>
          }
        >
          <div className="workflow-grid">
            {guidedWorkflows.map((workflow) => (
              <WorkflowCard
                key={workflow.id}
                workflow={workflow}
                onOpen={() => openGuidedWorkflow(workflow.id)}
              />
            ))}
          </div>
        </DashboardSection>
      </>
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
            onCreate={() => setDialog({ kind: "create-worktree" })}
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
            onCreate={() => setDialog({ kind: "create-branch" })}
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
        <OperationsTable operations={operations} onRefresh={() => void refreshOperations()} />
      </DashboardSection>
    );
  }

  function renderIntegrationsPage() {
    const focusedPath = selectedFocusedWorktreePath ?? selectedRepo?.path ?? null;

    return (
      <DashboardSection
        id="integrations"
        title="Integrações"
        subtitle="Ferramentas externas para abrir worktrees"
        actions={
          <>
            <button className="secondary-button" onClick={() => void refreshIntegrations()}>
              {actionLoading === "integrations" ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
              Detetar
            </button>
            {focusedPath ? (
              <>
                <button className="secondary-button" onClick={() => openExternalPath(focusedPath, "editor")}>
                  <Code2 size={16} />
                  Testar editor
                </button>
                <button className="secondary-button" onClick={() => openExternalPath(focusedPath, "terminal")}>
                  <TerminalSquare size={16} />
                  Testar terminal
                </button>
              </>
            ) : null}
          </>
        }
      >
        <IntegrationsPanel
          catalog={integrationCatalog}
          settings={settings}
          busy={actionLoading === "integrations"}
          onChange={updateIntegrations}
        />
      </DashboardSection>
    );
  }

  function renderSettingsPage() {
    return (
      <DashboardSection id="settings" title={pageCopy.settings.title} subtitle={pageCopy.settings.subtitle}>
        <div className="settings-grid">
          <div className="settings-item">
            <ThemeControl value={themePreference} onChange={setThemePreference} />
          </div>
          <div className="settings-item">
            <LanguageControl
              value={locale}
              busy={actionLoading === "settings"}
              copy={settingsCopy}
              onChange={(nextLocale) => void updateLocale(nextLocale)}
            />
          </div>
          <div className="settings-item">
            <SafeModeControl
              value={settings.safeMode}
              busy={actionLoading === "settings"}
              onChange={(safeMode) => void updateSafeMode(safeMode)}
            />
          </div>
          <div className="settings-item">
            <span className="settings-label">{settingsCopy.version}</span>
            <strong>v1.0.0</strong>
          </div>
        </div>
        <DiagnosticsPanel
          diagnostics={diagnostics}
          busy={actionLoading === "diagnostics" || actionLoading === "diagnostics-copy"}
          copied={diagnosticsCopied}
          onRefresh={() => void refreshDiagnostics()}
          onCopy={() => void copyDiagnostics()}
        />
      </DashboardSection>
    );
  }

  function renderHelpPage() {
    return <HelpPage copy={helpCopy} />;
  }

  function renderPrivacyPage() {
    return (
      <PrivacyPage
        copy={privacyCopy}
        diagnostics={diagnostics}
        operations={operations}
        repos={repos}
        workspaceRepos={workspaceRepos}
        settings={settings}
        copied={privacyReportCopied}
        busy={actionLoading === "privacy-copy"}
        onCopyReport={() => void copyPrivacyReport()}
      />
    );
  }

  function renderPageContent() {
    if (!workspaceHydrated && loading) return <DashboardSkeleton />;
    if (activePage === "help") return renderHelpPage();
    if (activePage === "privacy") return renderPrivacyPage();
    if (activePage === "settings") return renderSettingsPage();
    if (activePage === "integrations") return renderIntegrationsPage();
    if (activePage === "operations") return renderOperationsPage();

    if (!workspaceRepos.length) {
      return (
        <>
          <EmptyState
            loading={loading}
            copy={emptyCopy}
            onSelectRepo={() => setDialog({ kind: "repo-picker" })}
          />
          {!onboardingDismissed ? (
            <OnboardingPanel
              copy={onboardingCopy}
              onDismiss={dismissOnboarding}
              onSelectRepo={() => setDialog({ kind: "repo-picker" })}
            />
          ) : null}
        </>
      );
    }

    if (activePage === "detail") return renderDetailPage();
    if (activePage === "workflows") return renderWorkflowsPage();
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
      {loading || actionLoading || detailLoading ? (
        <div className="app-progress" role="progressbar" aria-label={a11yCopy.progress} />
      ) : null}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />

      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <GitFork aria-hidden="true" />
          <span>Worktree Manager</span>
        </div>

        <nav className="nav-stack" aria-label={shellCopy.navigation}>
          <span className="nav-label">{shellCopy.navigation}</span>
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
          <span className="nav-label">{shellCopy.workspace}</span>
          {workspaceRepos.length ? (
            <>
              <div className="repo-current">
                <span className="status-dot" />
                <div>
                  <span>
                    {workspaceRepos.length}{" "}
                    {workspaceRepos.length === 1 ? shellCopy.activeRepository : shellCopy.activeRepositories}
                  </span>
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
                {shellCopy.addRepositoryLower}
              </button>
            </>
          ) : (
            <button className="ghost-button full" onClick={() => setDialog({ kind: "repo-picker" })}>
              {shellCopy.selectRepository}
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
          <button
            className="icon-button mobile-menu"
            type="button"
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? a11yCopy.closeNavigation : a11yCopy.openNavigation}
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div>
            <h1>{pageMeta.title}</h1>
            <p>{pageMeta.subtitle}</p>
          </div>
          <div className="topbar-actions">
            <button
              className="command-trigger"
              type="button"
              aria-label={a11yCopy.openCommands}
              onClick={() => setCommandPaletteOpen(true)}
            >
              <CommandIcon size={17} />
              <span>{shellCopy.commands}</span>
            </button>
            <button className="primary-button" onClick={() => setDialog({ kind: "repo-picker" })}>
              <Folder size={18} />
              {shellCopy.addRepository}
            </button>
          </div>
        </header>

        {error ? (
          <div className="alert" role="alert">
            <AlertTriangle size={18} />
            <span>{error}</span>
            <button className="icon-button compact" type="button" aria-label={a11yCopy.dismissAlert} onClick={() => setError(null)}>
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
          branches={branches}
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

      {dialog?.kind === "guided-workflow" ? (
        <GuidedWorkflowDialog
          workflow={guidedWorkflows.find((workflow) => workflow.id === dialog.workflowId) ?? null}
          worktrees={worktrees}
          localWorkspacePath={selectedRepo?.path ?? null}
          busy={actionLoading !== null}
          onClose={() => setDialog(null)}
          onRun={runGuidedWorkflow}
          onSecondaryRun={runGuidedWorkflowSecondary}
        />
      ) : null}

      {commandPaletteOpen ? (
        <CommandPalette
          actions={commandActions}
          busy={actionLoading !== null || loading || detailLoading}
          onClose={() => setCommandPaletteOpen(false)}
          onRun={runCommandAction}
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

function ToastViewport({
  toasts,
  onDismiss
}: {
  toasts: ToastRecord[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="toast-viewport" role="status" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.tone}`}>
          <div className="toast-icon">
            {toast.tone === "success" ? <CheckCircle2 size={17} /> : toast.tone === "error" ? <AlertTriangle size={17} /> : <Clock3 size={17} />}
          </div>
          <div>
            <strong>{toast.title}</strong>
            {toast.detail ? <span>{toast.detail}</span> : null}
          </div>
          <button className="icon-button compact" type="button" onClick={() => onDismiss(toast.id)}>
            <X size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <section className="repo-hero skeleton-block">
        <div className="hero-left">
          <div className="hero-icon skeleton-pulse" />
          <div className="skeleton-copy">
            <span className="skeleton-line short" />
            <span className="skeleton-line title" />
            <span className="skeleton-line long" />
          </div>
        </div>
      </section>
      <section className="stats-grid" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="stat-card skeleton-card">
            <span className="skeleton-line short" />
            <span className="skeleton-line title" />
            <span className="skeleton-line medium" />
          </div>
        ))}
      </section>
      <section className="panel skeleton-panel" aria-hidden="true">
        <span className="skeleton-line title" />
        <span className="skeleton-line long" />
        <span className="skeleton-line long" />
        <span className="skeleton-line medium" />
      </section>
    </>
  );
}

function AppCrashFallback({
  message,
  onRetry
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <main className="crash-shell">
      <section className="crash-panel">
        <div className="hero-icon">
          <AlertTriangle size={34} />
        </div>
        <div>
          <h1>Erro de interface</h1>
          <p>{message || "A aplicação encontrou um erro inesperado."}</p>
        </div>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onRetry}>
            Tentar novamente
          </button>
          <button className="primary-button" type="button" onClick={() => window.location.reload()}>
            Recarregar
          </button>
        </div>
      </section>
    </main>
  );
}

function WorkflowCard({
  workflow,
  onOpen
}: {
  workflow: GuidedWorkflowDefinition;
  onOpen: () => void;
}) {
  return (
    <article className={`workflow-card ${workflow.status}`}>
      <div className="workflow-card-header">
        <div className="workflow-icon">{workflow.icon}</div>
        <span className={`workflow-status ${workflow.status}`}>{workflow.statusLabel}</span>
      </div>
      <div className="workflow-card-copy">
        <span>{workflow.section}</span>
        <h3>{workflow.title}</h3>
        <p>{workflow.description}</p>
      </div>
      <ol className="workflow-mini-steps">
        {workflow.steps.slice(0, 3).map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <button className="secondary-button" disabled={workflow.disabled} type="button" onClick={onOpen}>
        <CheckCircle2 size={16} />
        Abrir workflow
      </button>
    </article>
  );
}

function GuidedWorkflowDialog({
  workflow,
  worktrees,
  localWorkspacePath,
  busy,
  onClose,
  onRun,
  onSecondaryRun
}: {
  workflow: GuidedWorkflowDefinition | null;
  worktrees: WorktreeRecord[];
  localWorkspacePath: string | null;
  busy: boolean;
  onClose: () => void;
  onRun: (workflowId: GuidedWorkflowId, options?: GuidedWorkflowRunOptions) => void;
  onSecondaryRun: (workflowId: GuidedWorkflowId) => void;
}) {
  const handoffOptions = localWorkspacePath
    ? worktrees.filter((worktree) => !sameWorktreePath(worktree.path, localWorkspacePath) && Boolean(worktree.branch))
    : [];
  const firstHandoffId = handoffOptions[0]?.id ?? "";
  const [worktreeId, setWorktreeId] = useState(firstHandoffId);

  useEffect(() => {
    if (workflow?.id === "handoff-local") setWorktreeId(firstHandoffId);
  }, [firstHandoffId, workflow?.id]);

  if (!workflow) return null;

  const requiresWorktreeChoice = workflow.id === "handoff-local";
  const selectedHandoffWorktree = handoffOptions.find((worktree) => worktree.id === worktreeId) ?? null;
  const primaryDisabled = busy || workflow.disabled || (requiresWorktreeChoice && !selectedHandoffWorktree);

  return (
    <Modal title={workflow.title} onClose={onClose}>
      <div className="workflow-dialog">
        <div className={`workflow-dialog-status ${workflow.status}`}>
          <div className="workflow-icon">{workflow.icon}</div>
          <div>
            <span>{workflow.section}</span>
            <strong>{workflow.statusLabel}</strong>
          </div>
        </div>

        <p className="workflow-dialog-description">{workflow.description}</p>

        {requiresWorktreeChoice ? (
          <label className="workflow-selector">
            Worktree de origem
            <select value={worktreeId} onChange={(event) => setWorktreeId(event.target.value)} disabled={!handoffOptions.length}>
              {handoffOptions.length ? (
                handoffOptions.map((worktree) => (
                  <option key={worktree.id} value={worktree.id}>
                    {worktree.branch ?? basename(worktree.path)} - {worktree.path}
                  </option>
                ))
              ) : (
                <option value="">Sem worktree elegível</option>
              )}
            </select>
          </label>
        ) : null}

        <div className="workflow-dialog-grid">
          <section className="workflow-dialog-block">
            <h3>Passos</h3>
            <ol>
              {workflow.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
          <section className="workflow-dialog-block">
            <h3>Pré-condições</h3>
            <ul>
              {workflow.requirements.map((requirement) => (
                <li key={requirement}>
                  <CheckCircle2 size={15} />
                  <span>{requirement}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancelar
          </button>
          {workflow.secondaryLabel ? (
            <button
              className="secondary-button"
              type="button"
              disabled={busy || workflow.disabled}
              onClick={() => onSecondaryRun(workflow.id)}
            >
              {busy ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
              {workflow.secondaryLabel}
            </button>
          ) : null}
          <button
            className="primary-button"
            type="button"
            disabled={primaryDisabled}
            onClick={() => onRun(workflow.id, { worktreeId })}
          >
            {busy ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
            {workflow.primaryLabel}
          </button>
        </div>
      </div>
    </Modal>
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

function ActionEmptyState({
  icon,
  title,
  description,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary
}: {
  icon: ReactNode;
  title: string;
  description: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <div className="action-empty-state">
      <div className="action-empty-icon">{icon}</div>
      <div className="action-empty-copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="action-empty-actions">
        <button className="primary-button" type="button" onClick={onPrimary}>
          {primaryLabel}
        </button>
        {secondaryLabel && onSecondary ? (
          <button className="secondary-button" type="button" onClick={onSecondary}>
            {secondaryLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function WorktreeTable({
  worktrees,
  localWorkspacePath,
  onInspect,
  onCreate,
  onHandoffLocal,
  onMoveLocalToWorktree,
  onOpen,
  onCopy,
  onDelete
}: {
  worktrees: WorktreeRecord[];
  localWorkspacePath: string;
  onInspect: (worktree: WorktreeRecord) => void;
  onCreate: () => void;
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
        <ActionEmptyState
          icon={<GitFork size={20} />}
          title={worktrees.length ? "Sem worktrees para os filtros atuais" : "Ainda não existem worktrees"}
          description={
            worktrees.length
              ? "Ajusta a pesquisa ou limpa os filtros para voltar à lista completa."
              : "Cria uma worktree para trabalhar numa branch em paralelo sem mexer no workspace local."
          }
          primaryLabel="Nova Worktree"
          onPrimary={onCreate}
          secondaryLabel={worktrees.length ? "Limpar filtros" : undefined}
          onSecondary={() => {
            setQuery("");
            setFilter("all");
          }}
        />
      )}
      <p className="table-foot">
        Mostrando {filteredWorktrees.length} de {worktrees.length} worktrees
      </p>
    </>
  );
}

function BranchTable({
  branches,
  onCreate,
  onCheckout,
  onDelete
}: {
  branches: BranchRecord[];
  onCreate: () => void;
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
        <ActionEmptyState
          icon={<GitBranch size={20} />}
          title={branches.length ? "Sem branches para os filtros atuais" : "Ainda não existem branches locais"}
          description={
            branches.length
              ? "A pesquisa ou filtro atual não encontrou branches."
              : "Cria uma branch local para iniciar trabalho isolado ou preparar uma nova worktree."
          }
          primaryLabel="Nova Branch"
          onPrimary={onCreate}
          secondaryLabel={branches.length ? "Limpar filtros" : undefined}
          onSecondary={() => {
            setQuery("");
            setFilter("all");
          }}
        />
      )}
      <p className="table-foot">
        Mostrando {filteredBranches.length} de {branches.length} branches
      </p>
    </>
  );
}

function OperationsTable({
  operations,
  onRefresh
}: {
  operations: OperationRecord[];
  onRefresh: () => void;
}) {
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
    return (
      <ActionEmptyState
        icon={<TerminalSquare size={20} />}
        title="Ainda não há operações registadas"
        description="Executa uma ação Git ou atualiza o dashboard para popular o histórico local."
        primaryLabel="Atualizar"
        onPrimary={onRefresh}
      />
    );
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
        <ActionEmptyState
          icon={<TerminalSquare size={20} />}
          title="Sem operações para os filtros atuais"
          description="Ajusta a pesquisa ou limpa os filtros para consultar o histórico completo."
          primaryLabel="Limpar filtros"
          onPrimary={() => {
            setQuery("");
            setFilter("all");
          }}
          secondaryLabel="Atualizar"
          onSecondary={onRefresh}
        />
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

    function handleKeyDown(event: globalThis.KeyboardEvent) {
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
        aria-label="Abrir menu de ações"
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

function SafeModeControl({
  value,
  busy,
  onChange
}: {
  value: boolean;
  busy: boolean;
  onChange: (value: boolean) => void;
}) {
  const options: Array<{ value: boolean; label: string; icon: ReactNode }> = [
    { value: true, label: "Ativo", icon: <ShieldCheck size={15} /> },
    { value: false, label: "Desligado", icon: <ShieldOff size={15} /> }
  ];

  return (
    <div className="settings-control" aria-label="Modo seguro">
      <span>Modo seguro</span>
      <div className="settings-segmented two" role="group" aria-label="Escolher modo seguro">
        {options.map((option) => (
          <button
            key={String(option.value)}
            aria-pressed={value === option.value}
            className={value === option.value ? "active" : ""}
            disabled={busy}
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

function LanguageControl({
  value,
  busy,
  copy,
  onChange
}: {
  value: Locale;
  busy: boolean;
  copy: (typeof SETTINGS_COPY)[Locale];
  onChange: (value: Locale) => void;
}) {
  const options: Array<{ value: Locale; label: string }> = [
    { value: "pt", label: copy.portuguese },
    { value: "en", label: copy.english }
  ];

  return (
    <div className="settings-control" aria-label={copy.language}>
      <span>{copy.language}</span>
      <div className="settings-segmented two" role="group" aria-label={copy.languageAria}>
        {options.map((option) => (
          <button
            key={option.value}
            aria-pressed={value === option.value}
            className={value === option.value ? "active" : ""}
            disabled={busy}
            title={option.label}
            type="button"
            onClick={() => onChange(option.value)}
          >
            <Languages size={15} />
            <span>{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DiagnosticsPanel({
  diagnostics,
  busy,
  copied,
  onRefresh,
  onCopy
}: {
  diagnostics: DiagnosticsSnapshot | null;
  busy: boolean;
  copied: boolean;
  onRefresh: () => void;
  onCopy: () => void;
}) {
  const stats = diagnostics?.operationStats;
  const latestFailure = diagnostics?.recentFailures[0] ?? null;

  return (
    <section className="diagnostics-panel" aria-label="Observabilidade">
      <div className="diagnostics-header">
        <div>
          <span className="settings-label">Observabilidade</span>
          <h3>Diagnóstico local</h3>
        </div>
        <div className="diagnostics-actions">
          <button className="secondary-button" disabled={busy} type="button" onClick={onRefresh}>
            {busy ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            Atualizar
          </button>
          <button className="primary-button" disabled={busy || !diagnostics} type="button" onClick={onCopy}>
            <Copy size={16} />
            {copied ? "Copiado" : "Copiar JSON"}
          </button>
        </div>
      </div>

      {diagnostics ? (
        <>
          <div className="diagnostics-grid">
            <div className="diagnostic-card">
              <span>Runtime</span>
              <strong>{diagnostics.runtime}</strong>
              <small>{diagnostics.platform}</small>
            </div>
            <div className="diagnostic-card">
              <span>Repositórios</span>
              <strong>{diagnostics.repositoryCount}</strong>
              <small>v{diagnostics.appVersion}</small>
            </div>
            <div className="diagnostic-card">
              <span>Operações</span>
              <strong>{diagnostics.operationCount}</strong>
              <small>{stats ? `${stats.success} ok / ${stats.error} falhas` : "-"}</small>
            </div>
            <div className="diagnostic-card">
              <span>P95</span>
              <strong>{formatDuration(stats?.p95DurationMs)}</strong>
              <small>média {formatDuration(stats?.averageDurationMs)}</small>
            </div>
            <div className="diagnostic-card">
              <span>Timeouts</span>
              <strong>{stats?.timedOut ?? 0}</strong>
              <small>pior {formatDuration(stats?.slowestDurationMs)}</small>
            </div>
            <div className="diagnostic-card">
              <span>Última falha</span>
              <strong>{relativeDate(stats?.lastFailureAt)}</strong>
              <small>{latestFailure?.summary || "Sem falhas recentes"}</small>
            </div>
          </div>

          <div className="diagnostics-detail">
            <div>
              <span className="settings-label">State file</span>
              <code>{diagnostics.statePath ?? "-"}</code>
            </div>
            <div>
              <span className="settings-label">Gerado</span>
              <strong>{relativeDate(diagnostics.generatedAt)}</strong>
            </div>
          </div>

          {diagnostics.recentFailures.length ? (
            <div className="diagnostics-failures">
              {diagnostics.recentFailures.map((operation) => (
                <div key={operation.id} className="diagnostic-failure">
                  <AlertTriangle size={15} />
                  <span>{operation.summary || formatCommand(operation)}</span>
                  <small>{relativeDate(operation.finishedAt)}</small>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="empty-inline">Sem diagnóstico disponível.</div>
      )}
    </section>
  );
}

function IntegrationsPanel({
  catalog,
  settings,
  busy,
  onChange
}: {
  catalog: IntegrationCatalog | null;
  settings: AppSettings;
  busy: boolean;
  onChange: (integrations: AppSettings["integrations"]) => void;
}) {
  const editors = catalog?.editors ?? [];
  const terminals = catalog?.terminals ?? [];

  return (
    <div className="integrations-layout">
      <IntegrationGroup
        title="Editor"
        icon={<Code2 size={18} />}
        options={editors}
        selectedId={settings.integrations.editor}
        busy={busy}
        onSelect={(editor) => onChange({ ...settings.integrations, editor })}
      />
      <IntegrationGroup
        title="Terminal"
        icon={<TerminalSquare size={18} />}
        options={terminals}
        selectedId={settings.integrations.terminal}
        busy={busy}
        onSelect={(terminal) => onChange({ ...settings.integrations, terminal })}
      />
    </div>
  );
}

function IntegrationGroup<TId extends string>({
  title,
  icon,
  options,
  selectedId,
  busy,
  onSelect
}: {
  title: string;
  icon: ReactNode;
  options: IntegrationRecord<TId>[];
  selectedId: TId;
  busy: boolean;
  onSelect: (id: TId) => void;
}) {
  return (
    <section className="integration-group">
      <div className="integration-group-header">
        <div className="workflow-icon">{icon}</div>
        <div>
          <span className="settings-label">Integração</span>
          <h3>{title}</h3>
        </div>
      </div>

      <div className="integration-options">
        {options.length ? (
          options.map((option) => (
            <button
              key={option.id}
              className={option.id === selectedId ? "integration-option active" : "integration-option"}
              disabled={busy}
              type="button"
              onClick={() => onSelect(option.id)}
            >
              <span className={`integration-availability ${option.available ? "available" : "missing"}`}>
                {option.available ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              </span>
              <span className="integration-copy">
                <strong>{option.label}</strong>
                <small>{option.description}</small>
                {option.command ? <code>{option.command}</code> : null}
              </span>
              {option.id === selectedId ? <span className="badge green">Selecionado</span> : null}
            </button>
          ))
        ) : (
          <div className="empty-inline">A carregar integrações.</div>
        )}
      </div>
    </section>
  );
}

function PrivacyPage({
  copy,
  diagnostics,
  operations,
  repos,
  workspaceRepos,
  settings,
  copied,
  busy,
  onCopyReport
}: {
  copy: (typeof PRIVACY_COPY)[Locale];
  diagnostics: DiagnosticsSnapshot | null;
  operations: OperationRecord[];
  repos: RepoRecord[];
  workspaceRepos: RepoRecord[];
  settings: AppSettings;
  copied: boolean;
  busy: boolean;
  onCopyReport: () => void;
}) {
  return (
    <div className="privacy-layout">
      <section className="privacy-hero">
        <div className="privacy-hero-copy">
          <div className="hero-icon compact-icon">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h2>{copy.heroTitle}</h2>
            <p>{copy.heroDescription}</p>
          </div>
        </div>
        <button className="primary-button" disabled={busy} type="button" onClick={onCopyReport}>
          {busy ? <Loader2 className="spin" size={16} /> : <Copy size={16} />}
          {copied ? copy.copied : copy.copyReport}
        </button>
      </section>

      <div className="privacy-grid">
        <article className="privacy-card">
          <div className="privacy-card-header">
            <EyeOff size={20} />
            <div>
              <span className="settings-label">{copy.telemetryTitle}</span>
              <h3>{copy.telemetryStatus}</h3>
            </div>
          </div>
          <p>{copy.telemetryDescription}</p>
          <span className="badge green">Local-only</span>
        </article>

        <article className="privacy-card">
          <div className="privacy-card-header">
            <Database size={20} />
            <div>
              <span className="settings-label">{copy.localDataTitle}</span>
              <h3>{diagnostics?.statePath ? basename(diagnostics.statePath) : "-"}</h3>
            </div>
          </div>
          <p>{copy.localDataDescription}</p>
          <div className="privacy-metric-grid">
            <div>
              <span>{copy.repositories}</span>
              <strong>{repos.length}</strong>
            </div>
            <div>
              <span>{copy.operations}</span>
              <strong>{operations.length}</strong>
            </div>
            <div>
              <span>{copy.preferences}</span>
              <strong>{settings.safeMode ? "Safe" : "Manual"}</strong>
            </div>
          </div>
          <code title={diagnostics?.statePath ?? undefined}>{diagnostics?.statePath ?? "-"}</code>
        </article>
      </div>

      <div className="privacy-grid">
        <DashboardSection id="privacy-stored-data" title={copy.localDataTitle} subtitle={copy.localDataDescription}>
          <ul className="privacy-list">
            {copy.storedItems.map((item) => (
              <li key={item}>
                <CheckCircle2 size={16} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </DashboardSection>

        <DashboardSection id="privacy-outbound-actions" title={copy.outboundTitle} subtitle={copy.outboundDescription}>
          <ul className="privacy-list">
            {copy.outboundItems.map((item) => (
              <li key={item}>
                <AlertTriangle size={16} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </DashboardSection>
      </div>

      <DashboardSection id="privacy-audit" title={copy.auditTitle} subtitle={copy.auditDescription}>
        <div className="privacy-audit-grid">
          <div>
            <span className="settings-label">{copy.stateFile}</span>
            <code>{diagnostics?.statePath ?? "-"}</code>
          </div>
          <div>
            <span className="settings-label">{copy.repositories}</span>
            <strong>{workspaceRepos.length} / {repos.length}</strong>
          </div>
          <div>
            <span className="settings-label">{copy.operations}</span>
            <strong>{operations.length}</strong>
          </div>
          <div>
            <span className="settings-label">{copy.telemetryTitle}</span>
            <strong>{copy.telemetryStatus}</strong>
          </div>
        </div>
      </DashboardSection>
    </div>
  );
}

function HelpPage({ copy }: { copy: (typeof HELP_COPY)[Locale] }) {
  return (
    <div className="help-layout">
      <DashboardSection id="help-intro" title={copy.introTitle} subtitle={copy.intro}>
        <div className="help-callouts">
          <article>
            <HelpCircle size={20} />
            <div>
              <h3>{copy.accessibilityTitle}</h3>
              <p>{copy.accessibility}</p>
            </div>
          </article>
          <article>
            <Languages size={20} />
            <div>
              <h3>{copy.i18nTitle}</h3>
              <p>{copy.i18n}</p>
            </div>
          </article>
        </div>
      </DashboardSection>

      <DashboardSection id="keyboard-shortcuts" title={copy.shortcutsTitle} subtitle={copy.shortcutsSubtitle}>
        <div className="shortcut-grid">
          {copy.shortcuts.map((shortcut) => (
            <article key={`${shortcut.label}-${shortcut.keys.join("-")}`} className="shortcut-card">
              <div className="shortcut-keys" aria-label={shortcut.keys.join(" + ")}>
                {shortcut.keys.map((key) => (
                  <kbd key={key}>{key}</kbd>
                ))}
              </div>
              <div>
                <h3>{shortcut.label}</h3>
                <p>{shortcut.description}</p>
              </div>
            </article>
          ))}
        </div>
      </DashboardSection>
    </div>
  );
}

function CommandPalette({
  actions,
  busy,
  onClose,
  onRun
}: {
  actions: CommandPaletteAction[];
  busy: boolean;
  onClose: () => void;
  onRun: (action: CommandPaletteAction) => void;
}) {
  const titleId = useId();
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const visibleActions = useMemo(() => filterCommandActions(actions, query), [actions, query]);
  const groups = useMemo(() => groupCommandActions(visibleActions), [visibleActions]);
  const activeAction = visibleActions[activeIndex] ?? null;
  const activeOptionId = activeAction ? commandOptionId(activeAction.id) : undefined;

  useEffect(() => {
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();

    return () => {
      if (previousActiveElement?.isConnected) previousActiveElement.focus();
    };
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (activeIndex >= visibleActions.length) {
      setActiveIndex(Math.max(0, visibleActions.length - 1));
    }
  }, [activeIndex, visibleActions.length]);

  function run(action: CommandPaletteAction | null) {
    if (!action) return;
    onRun(action);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (visibleActions.length ? (index + 1) % visibleActions.length : 0));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (visibleActions.length ? (index - 1 + visibleActions.length) % visibleActions.length : 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      run(activeAction);
    }
  }

  return createPortal(
    <div
      className="command-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
      >
        <div className="command-input-shell">
          <Search size={18} />
          <input
            ref={inputRef}
            aria-label="Pesquisar comandos"
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
            value={query}
            placeholder="Pesquisar comandos, repositórios, worktrees ou branches"
            onChange={(event) => setQuery(event.target.value)}
          />
          {busy ? <Loader2 className="spin" size={16} /> : null}
          <button className="icon-button compact" type="button" aria-label="Fechar comandos" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <h2 id={titleId} className="sr-only">
          Paleta de comandos
        </h2>

        <div id={listboxId} className="command-results" role="listbox" aria-label="Comandos">
          {visibleActions.length ? (
            groups.map((group) => (
              <div key={group.section} className="command-group">
                <span>{group.section}</span>
                {group.items.map(({ action, index }) => (
                  <button
                    key={action.id}
                    id={commandOptionId(action.id)}
                    className={index === activeIndex ? "command-item active" : "command-item"}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => run(action)}
                  >
                    <span className="command-icon">{action.icon}</span>
                    <span className="command-copy">
                      <strong>{action.title}</strong>
                      {action.subtitle ? <small>{action.subtitle}</small> : null}
                    </span>
                    {action.shortcut ? <kbd>{action.shortcut}</kbd> : null}
                  </button>
                ))}
              </div>
            ))
          ) : (
            <div className="command-empty">Nenhum comando encontrado.</div>
          )}
        </div>
      </div>
    </div>,
    document.body
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

    function handleKeyDown(event: globalThis.KeyboardEvent) {
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

function OnboardingPanel({
  copy,
  onDismiss,
  onSelectRepo
}: {
  copy: (typeof ONBOARDING_COPY)[Locale];
  onDismiss: () => void;
  onSelectRepo: () => void;
}) {
  return (
    <section className="onboarding-panel" aria-labelledby="onboarding-title">
      <div className="onboarding-heading">
        <div className="hero-icon compact-icon">
          <CheckCircle2 size={24} />
        </div>
        <div>
          <h2 id="onboarding-title">{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
      </div>
      <ol className="onboarding-steps">
        {copy.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="onboarding-actions">
        <button className="primary-button" type="button" onClick={onSelectRepo}>
          <Folder size={16} />
          {copy.action}
        </button>
        <button className="secondary-button" type="button" onClick={onDismiss}>
          {copy.dismiss}
        </button>
      </div>
    </section>
  );
}

function EmptyState({
  loading,
  copy,
  onSelectRepo
}: {
  loading: boolean;
  copy: (typeof EMPTY_COPY)[Locale];
  onSelectRepo: () => void;
}) {
  return (
    <section className="empty-state">
      <div className="hero-icon">
        {loading ? <Loader2 className="spin" size={32} /> : <Folder size={34} />}
      </div>
      <div>
        <h2>{copy.title}</h2>
        <p>{copy.description}</p>
      </div>
      <button className="primary-button" type="button" onClick={onSelectRepo}>
        {copy.action}
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

function filterCommandActions(actions: CommandPaletteAction[], query: string): CommandPaletteAction[] {
  const normalizedQuery = normalizeCommandText(query).trim();
  if (!normalizedQuery) return actions;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  return actions
    .map((action, index) => {
      const score = scoreCommandAction(action, normalizedQuery, tokens);
      return score === null ? null : { action, index, score };
    })
    .filter((item): item is { action: CommandPaletteAction; index: number; score: number } => Boolean(item))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.action)
    .slice(0, 60);
}

function scoreCommandAction(action: CommandPaletteAction, query: string, tokens: string[]): number | null {
  const title = normalizeCommandText(action.title);
  const subtitle = normalizeCommandText(action.subtitle ?? "");
  const section = normalizeCommandText(action.section);
  const keywords = normalizeCommandText((action.keywords ?? []).join(" "));
  const haystack = [title, subtitle, section, keywords].join(" ");

  if (!tokens.every((token) => haystack.includes(token))) return null;

  let score = 0;
  if (title === query) score += 80;
  if (title.startsWith(query)) score += 55;
  if (title.includes(query)) score += 35;
  if (keywords.includes(query)) score += 20;
  if (subtitle.includes(query)) score += 12;
  if (section.includes(query)) score += 8;
  score += Math.max(0, 20 - title.length / 10);
  return score;
}

function groupCommandActions(actions: CommandPaletteAction[]) {
  const groups: Array<{ section: string; items: Array<{ action: CommandPaletteAction; index: number }> }> = [];
  actions.forEach((action, index) => {
    let group = groups.find((item) => item.section === action.section);
    if (!group) {
      group = { section: action.section, items: [] };
      groups.push(group);
    }
    group.items.push({ action, index });
  });
  return groups;
}

function commandOptionId(id: string) {
  return `command-option-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function buildPrivacyReport({
  diagnostics,
  operations,
  repos,
  workspaceRepos,
  settings,
  themePreference,
  focusedWorktreePaths,
  onboardingDismissed
}: {
  diagnostics: DiagnosticsSnapshot | null;
  operations: OperationRecord[];
  repos: RepoRecord[];
  workspaceRepos: RepoRecord[];
  settings: AppSettings;
  themePreference: ThemePreference;
  focusedWorktreePaths: FocusedWorktreeMap;
  onboardingDismissed: boolean;
}) {
  return {
    generatedAt: new Date().toISOString(),
    product: "Worktree Manager",
    privacyModel: {
      localFirst: true,
      remoteTelemetryImplemented: false,
      telemetryDefault: "off",
      automaticDataUpload: false,
      userControlledExports: ["copy diagnostics JSON", "copy privacy report"]
    },
    localStorageKeys: [
      ACTIVE_REPOS_STORAGE_KEY,
      FOCUSED_WORKTREES_STORAGE_KEY,
      THEME_STORAGE_KEY,
      ONBOARDING_STORAGE_KEY
    ],
    localState: {
      statePath: diagnostics?.statePath ?? null,
      recentRepositories: repos.length,
      activeRepositories: workspaceRepos.length,
      recordedOperations: operations.length,
      recentFailures: diagnostics?.recentFailures.length ?? 0
    },
    preferences: {
      safeMode: settings.safeMode,
      locale: settings.locale,
      themePreference,
      integrations: settings.integrations,
      onboardingDismissed
    },
    focusedWorktreePaths,
    outboundActions: [
      "Git fetch/pull communicates with remotes configured by the repository when the user runs those actions.",
      "Opening folders, editors or terminals delegates to the local operating system.",
      "Clipboard copy actions keep data local unless the user pastes it elsewhere."
    ]
  };
}

function normalizeCommandText(value: string) {
  return value
    .toLocaleLowerCase("pt-PT")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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

async function writeClipboard(value: string) {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Área de transferência indisponível.");
  }

  await navigator.clipboard.writeText(value);
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

function getPageMeta(page: AppPage, locale: Locale = "pt") {
  return (PAGE_COPY[locale] ?? PAGE_COPY.pt)[page];
}

function readPageFromHash(): AppPage {
  const value = window.location.hash.replace(/^#/, "");
  return isAppPage(value) ? value : DEFAULT_PAGE;
}

function isAppPage(value: unknown): value is AppPage {
  return (
    value === "dashboard" ||
    value === "detail" ||
    value === "workflows" ||
    value === "worktrees" ||
    value === "branches" ||
    value === "operations" ||
    value === "integrations" ||
    value === "privacy" ||
    value === "help" ||
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

function syncWorkflowStatus(summary: RepoSummary | null): { status: WorkflowStatusTone; label: string } {
  if (!summary) return { status: "blocked", label: "Sem dados" };
  const ahead = summary.ahead ?? 0;
  const behind = summary.behind ?? 0;
  if (ahead && behind) return { status: "attention", label: `Divergente: A${ahead} / B${behind}` };
  if (behind) return { status: "attention", label: `Behind ${behind}` };
  if (ahead) return { status: "attention", label: `Ahead ${ahead}` };
  return { status: "ready", label: "Sincronizado" };
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

function readBooleanFlag(key: string) {
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function persistBooleanFlag(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Browsers can disable storage; the current session still reflects the choice.
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
