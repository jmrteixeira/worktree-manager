import { Component, createContext, ErrorInfo, Fragment, FormEvent, KeyboardEvent, ReactNode, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
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
  PanelLeftClose,
  PanelLeftOpen,
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
  ArchivedWorktreeRecord,
  BranchRecord,
  DiagnosticsSnapshot,
  DiffMode,
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
  ReviewDiffFile,
  ReviewDiffResponse,
  RepoSummary,
  WorktreeRecord
} from "./types";

type DialogState =
  | { kind: "repo-picker" }
  | { kind: "settings"; section?: SettingsSectionId }
  | { kind: "review"; worktreePath: string }
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
type SettingsSectionId = "general" | "git" | "integrations" | "observability";
type AppPage =
  | "dashboard"
  | "detail"
  | "workflows"
  | "worktrees"
  | "branches"
  | "review"
  | "operations"
  | "integrations"
  | "privacy"
  | "help"
  | "settings";
type WorktreeFilter = "all" | "current" | "dirty" | "clean" | "ahead" | "behind" | "detached";
type BranchFilter = "all" | "local" | "remote" | "current" | "ahead" | "behind" | "no-upstream";
type OperationFilter = "all" | "success" | "error" | "timeout";
type ReviewFilter = "all" | DiffMode;
type DiffViewMode = "unified" | "split";
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
type I18nContextValue = {
  locale: Locale;
  t: (value: string) => string;
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
    review: {
      nav: "Revisão",
      title: "Revisão",
      subtitle: "Comparar alterações locais da worktree em foco"
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
    review: {
      nav: "Review",
      title: "Review",
      subtitle: "Compare local changes in the focused worktree"
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
    collapseSidebar: "Colapsar barra lateral",
    expandSidebar: "Expandir barra lateral",
    openCommands: "Abrir comandos",
    dismissAlert: "Dispensar erro"
  },
  en: {
    progress: "Action in progress",
    openNavigation: "Open navigation",
    closeNavigation: "Close navigation",
    collapseSidebar: "Collapse sidebar",
    expandSidebar: "Expand sidebar",
    openCommands: "Open commands",
    dismissAlert: "Dismiss error"
  }
} satisfies Record<
  Locale,
  {
    progress: string;
    openNavigation: string;
    closeNavigation: string;
    collapseSidebar: string;
    expandSidebar: string;
    openCommands: string;
    dismissAlert: string;
  }
>;

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

const I18N_CONTEXT = createContext<I18nContextValue>({
  locale: "pt",
  t: (value) => value
});

const EN_TRANSLATIONS: Record<string, string> = {
  "Arranque falhou": "Startup failed",
  "A worktree em foco já não existe. Voltei ao workspace local.": "The focused worktree no longer exists. I switched back to the local workspace.",
  "Atualização falhou": "Refresh failed",
  "A worktree selecionada já não existe. Mostro o workspace local.": "The selected worktree no longer exists. Showing the local workspace.",
  "Repositório adicionado": "Repository added",
  "Não foi possível adicionar": "Could not add",
  "Ação concluída": "Action completed",
  "Ação falhou": "Action failed",
  "Modo seguro atualizado": "Safe mode updated",
  "Ativo": "On",
  "Desligado": "Off",
  "Configuração falhou": "Settings failed",
  "Defaults atualizados": "Defaults updated",
  "Configurações da aplicação": "Application settings",
  "Secções de configuração": "Settings sections",
  "Geral": "General",
  "Preferências gerais": "General preferences",
  "Tema, idioma, segurança e versão da aplicação.": "Theme, language, safety and application version.",
  "Preferências Git": "Git preferences",
  "Defaults usados ao criar branches e worktrees.": "Defaults used when creating branches and worktrees.",
  "Diagnóstico e suporte": "Diagnostics and support",
  "Estado local, métricas e exportação de diagnóstico.": "Local state, metrics and diagnostics export.",
  "Ajustar configurações": "Adjust settings",
  "Defaults de trabalho": "Work defaults",
  "Prefixo de branch": "Branch prefix",
  "Local default das worktrees": "Default worktree location",
  "Guardar defaults": "Save defaults",
  "Usar pasta irmã do repositório": "Use repository sibling folder",
  "Escolher local default das worktrees": "Choose default worktree location",
  "Limpar": "Clear",
  "Idioma atualizado": "Language updated",
  "Integrações atualizadas": "Integrations refreshed",
  "Deteção falhou": "Detection failed",
  "Integração guardada": "Integration saved",
  "Integração falhou": "Integration failed",
  "Confirmar checkout de branch": "Confirm branch checkout",
  "Esta operação muda a branch da worktree em foco. O Git pode bloquear se existirem alterações locais incompatíveis.": "This operation changes the branch in the focused worktree. Git can block it if incompatible local changes exist.",
  "Confirmar checkout": "Confirm checkout",
  "Repositório": "Repository",
  "Abrir": "Open",
  "Branch": "Branch",
  "Branch destino": "Target branch",
  "Confirmar pull": "Confirm pull",
  "Esta operação executa git pull --ff-only e pode atualizar ficheiros no workspace selecionado.": "This operation runs git pull --ff-only and can update files in the selected workspace.",
  "Executar pull": "Run pull",
  "Comando": "Command",
  "Confirmar handoff para local": "Confirm handoff to local",
  "A branch desta worktree vai passar para o workspace local e a worktree de origem ficará detached.": "This worktree branch will move to the local workspace and the source worktree will become detached.",
  "Confirmar checkout local": "Confirm local checkout",
  "Origem": "Source",
  "Destino local": "Local destination",
  "Guardar alterações não commitadas numa stash temporária.": "Stash uncommitted changes temporarily.",
  "Fazer detach da branch na worktree de origem.": "Detach the branch from the source worktree.",
  "Fazer checkout da branch no workspace local.": "Check out the branch in the local workspace.",
  "Reaplicar as alterações não commitadas no workspace local.": "Reapply uncommitted changes in the local workspace.",
  "A worktree de origem deixa de ter a branch checked out.": "The source worktree will no longer have the branch checked out.",
  "branch atual": "current branch",
  "Confirmar mover para worktree": "Confirm move to worktree",
  "A branch local atual vai passar para uma worktree, deixando o workspace local em main ou master.": "The current local branch will move to a worktree, leaving the local workspace on main or master.",
  "Confirmar mover": "Confirm move",
  "Workspace local": "Local workspace",
  "Destino": "Destination",
  "Worktree existente compatível ou nova pasta padrão": "Compatible existing worktree or new default folder",
  "Reutilizar uma worktree detached existente, quando existir.": "Reuse an existing detached worktree when available.",
  "Guardar alterações não commitadas locais numa stash temporária.": "Stash local uncommitted changes temporarily.",
  "Fazer checkout de main ou master no workspace local.": "Check out main or master in the local workspace.",
  "Guardar alterações existentes na worktree de destino.": "Stash existing changes in the destination worktree.",
  "Fazer checkout da branch na worktree.": "Check out the branch in the worktree.",
  "Reaplicar as alterações não commitadas na worktree.": "Reapply uncommitted changes in the worktree.",
  "Handoff concluído": "Handoff completed",
  "Handoff falhou": "Handoff failed",
  "Arquivar": "Archive",
  "Arquivo": "Archive",
  "Arquivar worktree": "Archive worktree",
  "Restaurar": "Restore",
  "Restaurar worktree": "Restore worktree",
  "Worktree arquivada": "Worktree archived",
  "Worktree restaurada": "Worktree restored",
  "Arquivo falhou": "Archive failed",
  "Restauro falhou": "Restore failed",
  "Worktrees escondidas na app; continuam no disco.": "Worktrees hidden in the app; they remain on disk.",
  "Sem worktrees arquivadas": "No archived worktrees",
  "Arquiva uma worktree para a esconder sem remover do disco.": "Archive a worktree to hide it without removing it from disk.",
  "Arquivada em": "Archived",
  "Remover worktree": "Remove worktree",
  "Apagar branch": "Delete branch",
  "Mover para worktree": "Move to worktree",
  "Branch movida para worktree": "Branch moved to worktree",
  "Detalhe falhou": "Detail failed",
  "Operações atualizadas": "Operations refreshed",
  "Diagnóstico atualizado": "Diagnostics refreshed",
  "Diagnóstico falhou": "Diagnostics failed",
  "Diagnóstico copiado": "Diagnostics copied",
  "Cópia falhou": "Copy failed",
  "Relatório copiado": "Report copied",
  "Não existe uma worktree elegível para handoff.": "No eligible worktree exists for handoff.",
  "Começar trabalho paralelo": "Start parallel work",
  "Criar uma worktree para uma branch existente ou nova.": "Create a worktree for an existing or new branch.",
  "Sem repositório": "No repository",
  "Pronto": "Ready",
  "Escolher branch existente ou criar uma nova branch.": "Choose an existing branch or create a new one.",
  "Confirmar nome ou caminho da pasta da worktree.": "Confirm the worktree folder name or path.",
  "Criar a worktree e passar o foco para ela.": "Create the worktree and move focus to it.",
  "Seleciona um repositório para começar.": "Select a repository to get started.",
  "Criar worktree": "Create worktree",
  "Handoff de worktree para local": "Handoff from worktree to local",
  "Trazer a branch de uma worktree para o workspace local.": "Bring a worktree branch into the local workspace.",
  "Sem worktree elegível": "No eligible worktree",
  "Guardar alterações não commitadas na worktree de origem.": "Stash uncommitted changes in the source worktree.",
  "Reaplicar alterações não commitadas no workspace local.": "Reapply uncommitted changes in the local workspace.",
  "Existe pelo menos uma worktree com branch associada.": "At least one worktree has an associated branch.",
  "Não existe worktree com branch pronta para handoff.": "No worktree has a branch ready for handoff.",
  "Preparar handoff": "Prepare handoff",
  "Handoff de local para worktree": "Handoff from local to worktree",
  "Mover a branch local para uma worktree e libertar o workspace local.": "Move the local branch to a worktree and free the local workspace.",
  "Reutilizar uma worktree detached existente quando possível.": "Reuse an existing detached worktree when possible.",
  "Guardar alterações não commitadas locais.": "Stash local uncommitted changes.",
  "Reaplicar alterações não commitadas na worktree.": "Reapply uncommitted changes in the worktree.",
  "Preparar mover": "Prepare move",
  "Sincronizar worktree em foco": "Sync focused worktree",
  "Executar fetch ou pull na worktree selecionada.": "Run fetch or pull in the selected worktree.",
  "Sincronização": "Sync",
  "Confirmar a worktree em foco.": "Confirm the focused worktree.",
  "Executar fetch para atualizar referências remotas.": "Run fetch to update remote refs.",
  "Executar pull --ff-only quando for seguro avançar.": "Run pull --ff-only when it is safe to proceed.",
  "Modo seguro ativo.": "Safe mode on.",
  "Modo seguro desligado.": "Safe mode off.",
  "Preparar pull": "Prepare pull",
  "Executar fetch": "Run fetch",
  "Rever alterações locais": "Review local changes",
  "Abrir o visualizador de revisão da worktree em foco.": "Open the focused worktree review viewer.",
  "Revisão": "Review",
  "Rever alterações": "Review changes",
  "Abrir a revisão da worktree em foco.": "Open the focused worktree review.",
  "Rever ficheiros staged, unstaged e por seguir.": "Review staged, unstaged and untracked files.",
  "Decidir entre commit, stash, handoff ou limpeza manual.": "Decide between commit, stash, handoff or manual cleanup.",
  "Abrir revisão": "Open review",
  "Navegação": "Navigation",
  "Repositório em foco": "Focused repository",
  "Válido": "Valid",
  "Sem alterações": "No changes",
  "Métricas": "Metrics",
  "Todas limpas": "All clean",
  "Atual": "Current",
  "Branch atual": "Current branch",
  "Alterações": "Changes",
  "Visualizador de revisão": "Review viewer",
  "Ficheiros alterados": "Changed files",
  "Pesquisar ficheiros": "Search files",
  "Todos": "All",
  "Staged": "Staged",
  "Unstaged": "Unstaged",
  "Untracked": "Untracked",
  "Unified": "Unified",
  "Split": "Split",
  "Sem ficheiro selecionado": "No file selected",
  "Seleciona um ficheiro para rever o diff.": "Select a file to review the diff.",
  "Sem alterações para revisão": "No changes to review",
  "A worktree em foco está limpa.": "The focused worktree is clean.",
  "Sem ficheiros para os filtros atuais": "No files for the current filters",
  "Não pré-visualizável": "Not previewable",
  "Ficheiro binário": "Binary file",
  "Demasiado grande": "Too large",
  "adicionadas": "added",
  "removidas": "removed",
  "Revisão indisponível": "Review unavailable",
  "A carregar revisão": "Loading review",
  "A gerar diffs da worktree em foco.": "Generating diffs for the focused worktree.",
  "Modo de visualização": "View mode",
  "Revisão read-only de staged, unstaged e untracked.": "Read-only review of staged, unstaged and untracked changes.",
  "Prontas para commit": "Ready for commit",
  "Alterações locais": "Local changes",
  "Sem diff para mostrar": "No diff to show",
  "Este estado não tem conteúdo textual renderizável.": "This state has no renderable text content.",
  "Escolher repositório em foco": "Choose focused repository",
  "Sem repositórios": "No repositories",
  "Sem stash": "No stash",
  "Commits": "Commits",
  "Workflows guiados": "Guided workflows",
  "Fluxos orientados para operações frequentes e sensíveis": "Guided flows for frequent and sensitive operations",
  "Atualizar": "Refresh",
  "Nova Worktree": "New Worktree",
  "Gerir worktrees do repositório": "Manage repository worktrees",
  "Gerir branches do repositório": "Manage repository branches",
  "Nova Branch": "New Branch",
  "Operações recentes": "Recent operations",
  "Histórico local dos comandos Git": "Local history of Git commands",
  "Integrações": "Integrations",
  "Ferramentas externas para abrir worktrees": "External tools for opening worktrees",
  "Detetar": "Detect",
  "Testar editor": "Test editor",
  "Testar terminal": "Test terminal",
  "Erro de interface": "Interface error",
  "A aplicação encontrou um erro inesperado.": "The application encountered an unexpected error.",
  "Tentar novamente": "Try again",
  "Recarregar": "Reload",
  "Abrir workflow": "Open workflow",
  "Worktree de origem": "Source worktree",
  "Passos": "Steps",
  "Pré-condições": "Preconditions",
  "Cancelar": "Cancel",
  "Limpa": "Clean",
  "Sem upstream": "No upstream",
  "Área de trabalho": "Workspace",
  "Gerir vários repositórios em paralelo e escolher o foco das operações.": "Manage multiple repositories in parallel and choose the operation focus.",
  "Atualizar todos": "Refresh all",
  "Adicionar": "Add",
  "Repos ativos": "Active repos",
  "Limpo": "Clean",
  "Erro": "Error",
  "A carregar": "Loading",
  "Remover da área de trabalho": "Remove from workspace",
  "Detalhe indisponível": "Detail unavailable",
  "A carregar detalhe": "Loading detail",
  "A recolher estado Git da worktree selecionada.": "Collecting Git status from the selected worktree.",
  "Detalhe da worktree": "Worktree detail",
  "Pasta": "Folder",
  "Editor": "Editor",
  "Terminal": "Terminal",
  "Copiar": "Copy",
  "Checkout local": "Local checkout",
  "Estado Git": "Git status",
  "HEAD destacado": "Detached HEAD",
  "Branch associada": "Associated branch",
  "Ramo remoto": "Remote branch",
  "Ahead / behind": "Ahead / behind",
  "Último fetch": "Last fetch",
  "Estado local": "Local status",
  "Alterações nesta worktree": "Changes in this worktree",
  "Conflitos": "Conflicts",
  "Worktrees deste repositório": "Repository worktrees",
  "Selecionada": "Selected",
  "Local": "Local",
  "Sem alterações locais.": "No local changes.",
  "Ficheiro": "File",
  "Estado": "Status",
  "Sem repositório em foco": "No focused repository",
  "A carregar os dados do repositório selecionado.": "Loading selected repository data.",
  "Filtros": "Filters",
  "Pesquisar worktrees": "Search worktrees",
  "Todas": "All",
  "Em foco": "Focused",
  "Com alterações": "Changed",
  "Limpas": "Clean",
  "Detached": "Detached",
  "Caminho": "Path",
  "Último Commit": "Last Commit",
  "Data": "Date",
  "Ações": "Actions",
  "Abrir pasta": "Open folder",
  "Abrir no editor": "Open in editor",
  "Abrir no terminal": "Open in terminal",
  "Copiar caminho": "Copy path",
  "Remover": "Remove",
  "Sem worktrees para os filtros atuais": "No worktrees for the current filters",
  "Ainda não existem worktrees": "No worktrees yet",
  "Ajusta a pesquisa ou limpa os filtros para voltar à lista completa.": "Adjust the search or clear filters to return to the full list.",
  "Cria uma worktree para trabalhar numa branch em paralelo sem mexer no workspace local.": "Create a worktree to work on a branch in parallel without touching the local workspace.",
  "Limpar filtros": "Clear filters",
  "Pesquisar branches": "Search branches",
  "Locais": "Local",
  "Remotas": "Remote",
  "Remota": "Remote",
  "Nome": "Name",
  "Checkout nesta worktree": "Checkout in this worktree",
  "Apagar": "Delete",
  "Sem branches para os filtros atuais": "No branches for the current filters",
  "Ainda não existem branches locais": "No local branches yet",
  "A pesquisa ou filtro atual não encontrou branches.": "The current search or filter did not find branches.",
  "Cria uma branch local para iniciar trabalho isolado ou preparar uma nova worktree.": "Create a local branch to start isolated work or prepare a new worktree.",
  "Ainda não há operações registadas": "No operations recorded yet",
  "Executa uma ação Git ou atualiza o dashboard para popular o histórico local.": "Run a Git action or refresh the dashboard to populate local history.",
  "Pesquisar operações": "Search operations",
  "Resumo": "Summary",
  "Duração": "Duration",
  "Logs": "Logs",
  "Ocultar": "Hide",
  "Ver": "View",
  "Ocultar logs": "Hide logs",
  "Ver logs": "View logs",
  "Sem operações para os filtros atuais": "No operations for the current filters",
  "Ajusta a pesquisa ou limpa os filtros para consultar o histórico completo.": "Adjust the search or clear filters to browse the full history.",
  "Diretório": "Directory",
  "Sinal": "Signal",
  "Truncado": "Truncated",
  "Sem output.": "No output.",
  "Modificado": "Modified",
  "Por seguir": "Untracked",
  "Conflito": "Conflict",
  "Renomeado": "Renamed",
  "Adicionado": "Added",
  "Apagado": "Deleted",
  "Abrir menu de ações": "Open actions menu",
  "Escuro": "Dark",
  "Claro": "Light",
  "Sistema": "System",
  "Mudar tema": "Change theme",
  "Tema atual": "Current theme",
  "Mudar para": "Change to",
  "Tema": "Theme",
  "Escolher tema": "Choose theme",
  "Modo seguro": "Safe mode",
  "Escolher modo seguro": "Choose safe mode",
  "Observabilidade": "Observability",
  "Diagnóstico local": "Local diagnostics",
  "Copiar JSON": "Copy JSON",
  "Copiado": "Copied",
  "Repositórios": "Repositories",
  "falhas": "failures",
  "média": "avg",
  "pior": "worst",
  "Última falha": "Last failure",
  "Sem falhas recentes": "No recent failures",
  "Gerado": "Generated",
  "Sem diagnóstico disponível.": "No diagnostics available.",
  "Integração": "Integration",
  "Selecionado": "Selected",
  "A carregar integrações.": "Loading integrations.",
  "Pesquisar comandos": "Search commands",
  "Pesquisar comandos, repositórios, worktrees ou branches": "Search commands, repositories, worktrees or branches",
  "Fechar comandos": "Close commands",
  "Paleta de comandos": "Command palette",
  "Comandos": "Commands",
  "Nenhum comando encontrado.": "No command found.",
  "Selecionar Repositório": "Select Repository",
  "Escolher pasta": "Choose folder",
  "Escolher outra pasta": "Choose another folder",
  "Pasta selecionada": "Selected folder",
  "A pasta escolhida não é um repositório Git. Escolhe uma pasta com .git ou abre uma subpasta listada.": "The selected folder is not a Git repository. Choose a folder with .git or open one of the listed subfolders.",
  "Ir": "Go",
  "Selecionar pasta atual": "Select current folder",
  "Recentes": "Recent",
  "Nenhum repositório recente.": "No recent repository.",
  "Selecionar": "Select",
  "Tipo": "Type",
  "Branch existente": "Existing branch",
  "Nova branch": "New branch",
  "Branch base": "Base branch",
  "Nome da pasta": "Folder name",
  "opcional": "optional",
  "Local completo": "Full path",
  "Criar": "Create",
  "A partir de": "From",
  "HEAD atual": "Current HEAD",
  "Passos previstos": "Planned steps",
  "Escreve": "Type",
  "Área de transferência indisponível.": "Clipboard unavailable.",
  "Erro inesperado.": "Unexpected error.",
  "Não foi possível copiar o caminho.": "Could not copy the path.",
  "Sem dados": "No data",
  "Divergente": "Diverged",
  "Sincronizado": "Synced"
};

function useI18n() {
  return useContext(I18N_CONTEXT);
}

function translate(locale: Locale, value: string) {
  return locale === "en" ? EN_TRANSLATIONS[value] ?? value : value;
}

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
  const [archivedWorktrees, setArchivedWorktrees] = useState<ArchivedWorktreeRecord[]>([]);
  const [branches, setBranches] = useState<BranchRecord[]>([]);
  const [operations, setOperations] = useState<OperationRecord[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null);
  const [integrationCatalog, setIntegrationCatalog] = useState<IntegrationCatalog | null>(null);
  const [detail, setDetail] = useState<RepoDetail | null>(null);
  const [detailWorktreePath, setDetailWorktreePath] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [review, setReview] = useState<ReviewDiffResponse | null>(null);
  const [reviewWorktreePath, setReviewWorktreePath] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [selectedReviewFileId, setSelectedReviewFileId] = useState<string | null>(null);
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(() => readInitialDialog());
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => readThemePreference());
  const [settings, setSettings] = useState<AppSettings>({
    safeMode: true,
    locale: "pt",
    branchPrefix: "",
    worktreeDirectory: "",
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
  const t = useMemo(() => (value: string) => translate(locale, value), [locale]);
  const i18n = useMemo(() => ({ locale, t }), [locale, t]);
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
    document.documentElement.lang = locale === "en" ? "en" : "pt-PT";
  }, [locale]);

  useEffect(() => {
    function handleHashChange() {
      const hash = window.location.hash.replace(/^#/, "");
      if (hash === "settings" || hash === "integrations") {
        setDialog({ kind: "settings", section: hash === "integrations" ? "integrations" : undefined });
        return;
      }
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
      setArchivedWorktrees([]);
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

  useEffect(() => {
    if (!workspaceHydrated || dialog?.kind !== "review" || !selectedRepoId) return;

    void refreshReview(selectedRepoId, dialog.worktreePath);
  }, [dialog, selectedRepoId, workspaceHydrated]);

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
      notify({ tone: "error", title: t("Arranque falhou"), detail: message });
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
      let [nextWorktrees, nextBranches, nextArchivedWorktrees] = await Promise.all([
        api.worktrees(repoId, selectedFocusPath),
        api.branches(repoId, selectedFocusPath),
        api.archivedWorktrees(repoId)
      ]).catch(async (caught) => {
        if (!selectedFocusPath || !isInvalidFocusedWorktreeError(caught)) {
          throw caught;
        }

        effectiveFocusMap = { ...effectiveFocusMap };
        delete effectiveFocusMap[repoId];
        selectedFocusPath = undefined;
        focusWasReset = true;

        return Promise.all([api.worktrees(repoId), api.branches(repoId), api.archivedWorktrees(repoId)]);
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
        setError(t("A worktree em foco já não existe. Voltei ao workspace local."));
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
      setArchivedWorktrees(nextArchivedWorktrees);
      setBranches(nextBranches);
      setOperations(nextOperations);
      setDiagnostics(diagnosticsSnapshot);
    } catch (caught) {
      if (requestId !== refreshRequestId.current) return;
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: t("Atualização falhou"), detail: message });
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
        setDetailError(t("A worktree selecionada já não existe. Mostro o workspace local."));
        return;
      }

      setDetail(null);
      setDetailError(errorMessage(caught));
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshReview(repoId = selectedRepoId, worktreePath?: string) {
    if (!repoId) return;
    setReviewLoading(true);
    setReviewError(null);
    try {
      const nextReview = await api.review(repoId, worktreePath);
      setReview(nextReview);
      setReviewWorktreePath(nextReview.worktree.path);
      setSelectedReviewFileId((currentId) =>
        currentId && nextReview.files.some((file) => file.id === currentId)
          ? currentId
          : nextReview.files[0]?.id ?? null
      );
    } catch (caught) {
      if (worktreePath && isInvalidFocusedWorktreeError(caught)) {
        setReviewWorktreePath(null);
        const fallbackReview = await api.review(repoId);
        setReview(fallbackReview);
        setSelectedReviewFileId(fallbackReview.files[0]?.id ?? null);
        setReviewError(t("A worktree selecionada já não existe. Mostro o workspace local."));
        return;
      }

      setReview(null);
      setSelectedReviewFileId(null);
      setReviewError(errorMessage(caught));
    } finally {
      setReviewLoading(false);
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
      notify({ tone: "success", title: t("Repositório adicionado"), detail: repo.name });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: t("Não foi possível adicionar"), detail: message });
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
      notify({ tone: "success", title: t("Ação concluída"), detail: label });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: t("Ação falhou"), detail: message });
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
      notify({ tone: "success", title: t("Ação concluída"), detail: label });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: t("Ação falhou"), detail: message });
      await recordUiError("external_action_failed", message, { label });
    } finally {
      setActionLoading(null);
    }
  }

  function openExternalPath(path: string, target: OpenTarget) {
    void runExternalAction(openTargetActionLabel(target, locale), () => api.openPath(path, target));
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
      notify({ tone: "success", title: t("Modo seguro atualizado"), detail: safeMode ? t("Ativo") : t("Desligado") });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: t("Configuração falhou"), detail: message });
      await recordUiError("update_settings_failed", message, { safeMode });
    } finally {
      setActionLoading(null);
    }
  }

  async function updateWorkDefaults(defaults: Pick<AppSettings, "branchPrefix" | "worktreeDirectory">) {
    setActionLoading("settings");
    setError(null);
    try {
      const nextSettings = await api.updateSettings({
        branchPrefix: defaults.branchPrefix,
        worktreeDirectory: defaults.worktreeDirectory
      });
      setSettings(nextSettings);
      setDiagnostics(await api.diagnostics());
      notify({ tone: "success", title: t("Defaults atualizados") });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: t("Configuração falhou"), detail: message });
      await recordUiError("update_work_defaults_failed", message, defaults);
    } finally {
      setActionLoading(null);
    }
  }

  async function pickDefaultWorktreeDirectory(): Promise<string | null> {
    setActionLoading("settings-folder");
    setError(null);
    try {
      const selected = await api.pickFolder();
      return selected?.path ?? null;
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: t("Configuração falhou"), detail: message });
      await recordUiError("pick_default_worktree_directory_failed", message);
      return null;
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
        title: translate(nextLocale, "Idioma atualizado")
      });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: t("Configuração falhou"), detail: message });
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
      notify({ tone: "success", title: t("Integrações atualizadas") });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: t("Deteção falhou"), detail: message });
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
      notify({ tone: "success", title: t("Integração guardada") });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: t("Integração falhou"), detail: message });
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
      title: t("Confirmar checkout de branch"),
      description: t("Esta operação muda a branch da worktree em foco. O Git pode bloquear se existirem alterações locais incompatíveis."),
      confirmLabel: t("Confirmar checkout"),
      details: [
        { label: t("Repositório"), value: selectedRepo.name },
        { label: "Worktree", value: worktreePath },
        { label: t("Branch destino"), value: branchName }
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
      title: t("Confirmar pull"),
      description: t("Esta operação executa git pull --ff-only e pode atualizar ficheiros no workspace selecionado."),
      confirmLabel: t("Executar pull"),
      details: [
        { label: t("Repositório"), value: selectedRepo.name },
        { label: "Worktree", value: targetPath },
        { label: t("Comando"), value: "git pull --ff-only" }
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
      title: t("Confirmar handoff para local"),
      description: t("A branch desta worktree vai passar para o workspace local e a worktree de origem ficará detached."),
      confirmLabel: t("Confirmar checkout local"),
      details: [
        { label: t("Repositório"), value: selectedRepo.name },
        { label: "Branch", value: worktree.branch ?? "detached" },
        { label: t("Origem"), value: worktree.path },
        { label: t("Destino local"), value: selectedRepo.path }
      ],
      steps: [
        t("Guardar alterações não commitadas numa stash temporária."),
        t("Fazer detach da branch na worktree de origem."),
        t("Fazer checkout da branch no workspace local."),
        t("Reaplicar as alterações não commitadas no workspace local.")
      ],
      warnings: [
        t("A worktree de origem deixa de ter a branch checked out."),
        ...sensitiveWarningsForPath(worktree.path)
      ],
      onConfirm: () => handoffWorktreeToLocal(worktree)
    });
  }

  function confirmMoveLocalBranchToWorktree() {
    if (!selectedRepo) return;

    const localWorktree = findKnownWorktree(selectedRepo.path);
    const branch = localWorktree?.branch ?? selectedSummary?.currentBranch ?? t("branch atual");

    requestSensitiveAction({
      title: t("Confirmar mover para worktree"),
      description: t("A branch local atual vai passar para uma worktree, deixando o workspace local em main ou master."),
      confirmLabel: t("Confirmar mover"),
      details: [
        { label: t("Repositório"), value: selectedRepo.name },
        { label: "Branch", value: branch },
        { label: t("Workspace local"), value: selectedRepo.path },
        { label: t("Destino"), value: t("Worktree existente compatível ou nova pasta padrão") }
      ],
      steps: [
        t("Reutilizar uma worktree detached existente, quando existir."),
        t("Guardar alterações não commitadas locais numa stash temporária."),
        t("Fazer checkout de main ou master no workspace local."),
        t("Guardar alterações existentes na worktree de destino."),
        t("Fazer checkout da branch na worktree."),
        t("Reaplicar as alterações não commitadas na worktree.")
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

    const warnings = [
      locale === "en"
        ? `This worktree has ${formatChangeCount(status.total, locale)} uncommitted.`
        : `Esta worktree tem ${formatChangeCount(status.total, locale)} não commitadas.`
    ];
    if (status.conflicted) {
      warnings.push(
        locale === "en"
          ? `There ${status.conflicted === 1 ? "is" : "are"} ${formatConflictCount(status.conflicted, locale)} in this worktree.`
          : `${status.conflicted === 1 ? "Existe" : "Existem"} ${formatConflictCount(status.conflicted, locale)} nesta worktree.`
      );
    }
    if (status.untracked) {
      warnings.push(
        locale === "en"
          ? `There ${status.untracked === 1 ? "is" : "are"} ${status.untracked} ${
              status.untracked === 1 ? "new untracked file" : "new untracked files"
            }.`
          : `${status.untracked === 1 ? "Existe" : "Existem"} ${status.untracked} ${
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

  function openReviewForWorktreePath(worktreePath: string) {
    const knownWorktree = findKnownWorktree(worktreePath);
    const status =
      knownWorktree?.status ??
      (detail && sameWorktreePath(detail.worktree.path, worktreePath) ? detail.status : null);

    if (status && !hasReviewableChanges(status)) {
      notify({ tone: "info", title: t("Sem alterações para revisão"), detail: basename(worktreePath) });
      return;
    }

    setReviewWorktreePath(worktreePath);
    setReview(null);
    setSelectedReviewFileId(null);
    setReviewError(null);
    setDialog({ kind: "review", worktreePath });
  }

  function openWorktreeReview(worktree: WorktreeRecord) {
    openReviewForWorktreePath(worktree.path);
  }

  async function archiveWorktree(worktree: WorktreeRecord) {
    if (!selectedRepoId || !selectedRepo) return;

    const repoId = selectedRepoId;
    const repoIds = workspaceRepoIds;
    const wasFocused = selectedFocusedWorktreePath
      ? sameWorktreePath(selectedFocusedWorktreePath, worktree.path)
      : false;
    const nextFocusMap = wasFocused
      ? { ...focusedWorktreePaths, [repoId]: selectedRepo.path }
      : focusedWorktreePaths;

    setActionLoading(t("Arquivar worktree"));
    setError(null);
    try {
      await api.archiveWorktree(repoId, worktree.id);
      if (wasFocused) {
        setFocusedWorktreePaths(nextFocusMap);
      }
      await refreshDashboard(repoId, repoIds, nextFocusMap);
      notify({ tone: "success", title: t("Worktree arquivada"), detail: basename(worktree.path) });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: t("Arquivo falhou"), detail: message });
      await recordUiError("archive_worktree_failed", message, { repoId, worktree: worktree.path });
    } finally {
      setActionLoading(null);
    }
  }

  async function restoreWorktree(worktree: ArchivedWorktreeRecord) {
    if (!selectedRepoId) return;

    const repoId = selectedRepoId;
    const repoIds = workspaceRepoIds;
    setActionLoading(t("Restaurar worktree"));
    setError(null);
    try {
      await api.restoreWorktree(repoId, worktree.worktreeId);
      await refreshDashboard(repoId, repoIds, focusedWorktreePaths);
      notify({ tone: "success", title: t("Worktree restaurada"), detail: basename(worktree.path) });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: t("Restauro falhou"), detail: message });
      await recordUiError("restore_worktree_failed", message, { repoId, worktree: worktree.path });
    } finally {
      setActionLoading(null);
    }
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
      notify({ tone: "success", title: t("Handoff concluído"), detail: result.branch });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: t("Handoff falhou"), detail: message });
      await recordUiError("handoff_worktree_to_local_failed", message, { repoId, worktree: worktree.path });
    } finally {
      setActionLoading(null);
    }
  }

  async function moveLocalBranchToWorktree() {
    if (!selectedRepoId || !selectedRepo) return;

    const repoId = selectedRepoId;
    const repoIds = workspaceRepoIds;
    setActionLoading(t("Mover para worktree"));
    setError(null);
    try {
      const result = await api.moveLocalBranchToWorktree(repoId);
      const nextFocusMap = { ...focusedWorktreePaths, [repoId]: result.localPath };
      setFocusedWorktreePaths(nextFocusMap);
      await refreshDashboard(repoId, repoIds, nextFocusMap);
      notify({ tone: "success", title: t("Branch movida para worktree"), detail: result.branch });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: t("Handoff falhou"), detail: message });
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
      notify({ tone: "error", title: t("Detalhe falhou"), detail: message });
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
      notify({ tone: "success", title: t("Operações atualizadas") });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: t("Atualização falhou"), detail: message });
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
      notify({ tone: "success", title: t("Diagnóstico atualizado") });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: t("Diagnóstico falhou"), detail: message });
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
      await writeClipboard(JSON.stringify(snapshot, null, 2), locale);
      setDiagnosticsCopied(true);
      window.setTimeout(() => setDiagnosticsCopied(false), 1800);
      notify({ tone: "success", title: t("Diagnóstico copiado") });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: t("Cópia falhou"), detail: message });
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
      await writeClipboard(JSON.stringify(report, null, 2), locale);
      setPrivacyReportCopied(true);
      window.setTimeout(() => setPrivacyReportCopied(false), 1800);
      notify({ tone: "success", title: t("Relatório copiado") });
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      notify({ tone: "error", title: t("Cópia falhou"), detail: message });
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
  const navItems: Array<{ page: Exclude<AppPage, "settings" | "integrations" | "review">; label: string; icon: ReactNode }> = [
    { page: "dashboard", label: pageCopy.dashboard.nav, icon: <Home size={18} /> },
    { page: "detail", label: pageCopy.detail.nav, icon: <FolderGit2 size={18} /> },
    { page: "workflows", label: pageCopy.workflows.nav, icon: <CheckCircle2 size={18} /> },
    { page: "worktrees", label: pageCopy.worktrees.nav, icon: <GitFork size={18} /> },
    { page: "branches", label: pageCopy.branches.nav, icon: <GitBranch size={18} /> },
    { page: "operations", label: pageCopy.operations.nav, icon: <TerminalSquare size={18} /> },
    { page: "privacy", label: pageCopy.privacy.nav, icon: <Shield size={18} /> },
    { page: "help", label: pageCopy.help.nav, icon: <HelpCircle size={18} /> }
  ];
  const pageMeta = pageCopy[activePage];
  const guidedWorkflows = buildGuidedWorkflows();
  const commandActions = buildCommandActions();

  function navigateToPage(page: AppPage) {
    if (page === "settings") {
      setDialog({ kind: "settings" });
      setSidebarOpen(false);
      return;
    }

    setActivePage(page);
    setSidebarOpen(false);
    if (window.location.hash !== `#${page}`) {
      window.location.hash = page;
    }
  }

  function closeSettingsDialog() {
    setDialog(null);
    const hash = window.location.hash.replace(/^#/, "");
    if (hash === "settings" || hash === "integrations") {
      window.history.replaceState(null, "", `#${activePage}`);
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
        setError(t("Não existe uma worktree elegível para handoff."));
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

    openReviewForWorktreePath(focusedPath);
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
    const focusedStatus =
      focusedWorktree?.status ??
      (detail && focusedPath && sameWorktreePath(detail.worktree.path, focusedPath) ? detail.status : null);
    const changedFiles = focusedStatus?.total ?? 0;
    const hasFocusedChanges = changedFiles > 0;
    const blockedWithoutRepo = !selectedRepo;
    const eligibleHandoffWorktrees = selectedRepo
      ? worktrees.filter((worktree) => !sameWorktreePath(worktree.path, selectedRepo.path) && Boolean(worktree.branch))
      : [];
    const localWorktree = selectedRepo ? findKnownWorktree(selectedRepo.path) : null;
    const localBranch = localWorktree?.branch ?? selectedSummary?.currentBranch ?? t("branch atual");
    const syncState = syncWorkflowStatus(selectedSummary, locale);

    return [
      {
        id: "parallel-worktree",
        title: t("Começar trabalho paralelo"),
        description: t("Criar uma worktree para uma branch existente ou nova."),
        section: "Worktrees",
        icon: <GitFork size={20} />,
        status: blockedWithoutRepo ? "blocked" : "ready",
        statusLabel: blockedWithoutRepo ? t("Sem repositório") : t("Pronto"),
        steps: [
          t("Escolher branch existente ou criar uma nova branch."),
          t("Confirmar nome ou caminho da pasta da worktree."),
          t("Criar a worktree e passar o foco para ela.")
        ],
        requirements: selectedRepo
          ? [`${t("Repositório")}: ${selectedRepo.name}`, `${t("Em foco")}: ${basename(focusedPath)}`]
          : [t("Seleciona um repositório para começar.")],
        primaryLabel: t("Criar worktree"),
        disabled: blockedWithoutRepo
      },
      {
        id: "handoff-local",
        title: t("Handoff de worktree para local"),
        description: t("Trazer a branch de uma worktree para o workspace local."),
        section: "Handoff",
        icon: <ArrowRight size={20} />,
        status: blockedWithoutRepo || !eligibleHandoffWorktrees.length ? "blocked" : "attention",
        statusLabel: blockedWithoutRepo
          ? t("Sem repositório")
          : eligibleHandoffWorktrees.length
            ? locale === "en"
              ? `${eligibleHandoffWorktrees.length} available`
              : `${eligibleHandoffWorktrees.length} disponível${eligibleHandoffWorktrees.length === 1 ? "" : "is"}`
            : t("Sem worktree elegível"),
        steps: [
          t("Guardar alterações não commitadas na worktree de origem."),
          t("Fazer detach da branch na worktree de origem."),
          t("Fazer checkout da branch no workspace local."),
          t("Reaplicar alterações não commitadas no workspace local.")
        ],
        requirements: selectedRepo
          ? [
              `${t("Destino local")}: ${selectedRepo.path}`,
              eligibleHandoffWorktrees.length
                ? t("Existe pelo menos uma worktree com branch associada.")
                : t("Não existe worktree com branch pronta para handoff.")
            ]
          : [t("Seleciona um repositório para começar.")],
        primaryLabel: t("Preparar handoff"),
        disabled: blockedWithoutRepo || !eligibleHandoffWorktrees.length
      },
      {
        id: "local-to-worktree",
        title: t("Handoff de local para worktree"),
        description: t("Mover a branch local para uma worktree e libertar o workspace local."),
        section: "Handoff",
        icon: <GitFork size={20} />,
        status: blockedWithoutRepo ? "blocked" : changedFiles ? "attention" : "ready",
        statusLabel: blockedWithoutRepo
          ? t("Sem repositório")
          : changedFiles
            ? formatChangeCount(changedFiles, locale)
            : t("Pronto"),
        steps: [
          t("Reutilizar uma worktree detached existente quando possível."),
          t("Guardar alterações não commitadas locais."),
          t("Fazer checkout de main ou master no workspace local."),
          t("Fazer checkout da branch na worktree."),
          t("Reaplicar alterações não commitadas na worktree.")
        ],
        requirements: selectedRepo
          ? [`${t("Branch")} ${t("Local").toLocaleLowerCase()}: ${localBranch}`, `${t("Workspace local")}: ${selectedRepo.path}`]
          : [t("Seleciona um repositório para começar.")],
        primaryLabel: t("Preparar mover"),
        disabled: blockedWithoutRepo
      },
      {
        id: "sync-focused",
        title: t("Sincronizar worktree em foco"),
        description: t("Executar fetch ou pull na worktree selecionada."),
        section: t("Sincronização"),
        icon: <RefreshCcw size={20} />,
        status: blockedWithoutRepo ? "blocked" : syncState.status,
        statusLabel: blockedWithoutRepo ? t("Sem repositório") : syncState.label,
        steps: [
          t("Confirmar a worktree em foco."),
          t("Executar fetch para atualizar referências remotas."),
          t("Executar pull --ff-only quando for seguro avançar.")
        ],
        requirements: selectedRepo
          ? [
              `${t("Em foco")}: ${focusedPath}`,
              settings.safeMode ? t("Modo seguro ativo.") : t("Modo seguro desligado.")
            ]
          : [t("Seleciona um repositório para começar.")],
        primaryLabel: t("Preparar pull"),
        secondaryLabel: t("Executar fetch"),
        disabled: blockedWithoutRepo
      },
      {
        id: "review-changes",
        title: t("Rever alterações locais"),
        description: t("Abrir o visualizador de revisão da worktree em foco."),
        section: t("Revisão"),
        icon: <Search size={20} />,
        status: blockedWithoutRepo || !hasFocusedChanges ? "blocked" : "attention",
        statusLabel: blockedWithoutRepo
          ? t("Sem repositório")
          : hasFocusedChanges
            ? formatChangeCount(changedFiles, locale)
            : t("Sem alterações"),
        steps: [
          t("Abrir a revisão da worktree em foco."),
          t("Rever ficheiros staged, unstaged e por seguir."),
          t("Decidir entre commit, stash, handoff ou limpeza manual.")
        ],
        requirements: selectedRepo
          ? [
              `${t("Em foco")}: ${focusedPath}`,
              locale === "en"
                ? `${formatChangeCount(changedFiles, locale)} detected.`
                : `${formatChangeCount(changedFiles, locale)} detetadas.`
            ]
          : [t("Seleciona um repositório para começar.")],
        primaryLabel: t("Abrir revisão"),
        disabled: blockedWithoutRepo || !hasFocusedChanges
      }
    ];
  }

  function buildCommandActions(): CommandPaletteAction[] {
    const actions: CommandPaletteAction[] = navItems.map((item) => ({
      id: `page:${item.page}`,
      title: locale === "en" ? `Go to ${item.label}` : `Ir para ${item.label}`,
      subtitle: getPageMeta(item.page, locale).subtitle,
      section: t("Navegação"),
      keywords: [item.page, item.label],
      shortcut: item.page === activePage ? t("Atual") : undefined,
      icon: item.icon,
      run: () => navigateToPage(item.page)
    }));

    actions.push({
      id: "settings:open",
      title: locale === "en" ? "Open Settings" : "Abrir Configurações",
      subtitle: pageCopy.settings.subtitle,
      section: t("Navegação"),
      keywords: ["settings", "config", "configuracoes", "preferencias"],
      icon: <Settings size={18} />,
      run: () => setDialog({ kind: "settings" })
    });

    actions.push({
      id: "settings:integrations",
      title: locale === "en" ? "Open Integrations" : "Abrir Integrações",
      subtitle: t("Ferramentas externas para abrir worktrees"),
      section: pageCopy.settings.nav,
      keywords: ["integracoes", "integrations", "editor", "terminal"],
      icon: <Plug size={18} />,
      run: () => setDialog({ kind: "settings", section: "integrations" })
    });

    actions.push({
      id: "repo:add",
      title: repos.length ? shellCopy.addRepositoryLower : shellCopy.selectRepository,
      subtitle: locale === "en" ? "Open the local folder browser" : "Abrir o navegador de pastas local",
      section: t("Repositório"),
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
        shortcut: workflow.disabled ? (locale === "en" ? "Blocked" : "Bloqueado") : undefined,
        icon: workflow.icon,
        run: () => openGuidedWorkflow(workflow.id)
      });
    });

    workspaceRepos.forEach((repo) => {
      actions.push({
        id: `repo:select:${repo.id}`,
        title: locale === "en" ? `Activate repository: ${repo.name}` : `Ativar repositório: ${repo.name}`,
        subtitle: repo.path,
        section: "Workspace",
        keywords: ["repo", "workspace", repo.name, repo.path],
        shortcut: repo.id === selectedRepoId ? t("Ativo") : undefined,
        icon: <FolderGit2 size={18} />,
        run: () => setSelectedRepoId(repo.id)
      });
      actions.push({
        id: `repo:detail:${repo.id}`,
        title: locale === "en" ? `Open detail: ${repo.name}` : `Abrir detalhe: ${repo.name}`,
        subtitle: repo.path,
        section: "Workspace",
        keywords: ["detalhe", "repo", repo.name, repo.path],
        icon: <ArrowRight size={18} />,
        run: () => openRepoDetail(repo.id)
      });
    });

    if (!selectedRepo) return actions;

    const focusedPath = selectedFocusedWorktreePath ?? selectedRepo.path;
    const focusedWorktree = findKnownWorktree(focusedPath);
    const focusedStatus =
      focusedWorktree?.status ??
      (detail && sameWorktreePath(detail.worktree.path, focusedPath) ? detail.status : null);
    const focusedHasChanges = hasReviewableChanges(focusedStatus);
    actions.push(
      {
        id: "repo:refresh",
        title: locale === "en" ? "Refresh dashboard" : "Atualizar dashboard",
        subtitle: selectedRepo.name,
        section: t("Ações"),
        keywords: ["refresh", "recarregar", "atualizar"],
        icon: <RefreshCcw size={18} />,
        run: () => void refreshDashboard(selectedRepoId, workspaceRepoIds, focusedWorktreePaths)
      },
      {
        id: "repo:fetch",
        title: t("Executar fetch"),
        subtitle: locale === "en" ? `git fetch --prune in ${basename(focusedPath)}` : `git fetch --prune em ${basename(focusedPath)}`,
        section: "Git",
        keywords: ["fetch", "prune", "remoto"],
        icon: <RefreshCcw size={18} />,
        run: () => void runAction("Fetch", () => api.fetchRepo(selectedRepo.id, focusedPath))
      },
      {
        id: "repo:pull",
        title: t("Executar pull"),
        subtitle: locale === "en" ? `git pull --ff-only in ${basename(focusedPath)}` : `git pull --ff-only em ${basename(focusedPath)}`,
        section: "Git",
        keywords: ["pull", "ff", "atualizar"],
        icon: <GitBranch size={18} />,
        run: () => confirmPull(focusedPath, "focused")
      },
      {
        id: "worktree:create",
        title: t("Criar worktree"),
        subtitle: selectedRepo.name,
        section: "Worktrees",
        keywords: ["nova", "criar", "worktree"],
        icon: <GitFork size={18} />,
        run: () => setDialog({ kind: "create-worktree" })
      },
      {
        id: "branch:create",
        title: locale === "en" ? "Create branch" : "Criar branch",
        subtitle: basename(focusedPath),
        section: "Branches",
        keywords: ["nova", "criar", "branch"],
        icon: <GitBranch size={18} />,
        run: () => setDialog({ kind: "create-branch" })
      },
      {
        id: "local:move-to-worktree",
        title: locale === "en" ? "Move local branch to worktree" : "Mover branch local para worktree",
        subtitle: locale === "en" ? "Handoff from the local workspace to a worktree" : "Handoff do workspace local para uma worktree",
        section: "Worktrees",
        keywords: ["handoff", "mover", "local", "worktree"],
        icon: <GitFork size={18} />,
        run: confirmMoveLocalBranchToWorktree
      },
      {
        id: "open:folder",
        title: locale === "en" ? "Open focused folder" : "Abrir pasta em foco",
        subtitle: focusedPath,
        section: t("Abrir"),
        keywords: ["abrir", "finder", "folder", "pasta"],
        icon: <Folder size={18} />,
        run: () => openExternalPath(focusedPath, "folder")
      },
      {
        id: "open:editor",
        title: locale === "en" ? "Open in editor" : "Abrir em editor",
        subtitle: focusedPath,
        section: t("Abrir"),
        keywords: ["abrir", "editor", "code"],
        icon: <Code2 size={18} />,
        run: () => openExternalPath(focusedPath, "editor")
      },
      {
        id: "open:terminal",
        title: t("Abrir no terminal"),
        subtitle: focusedPath,
        section: t("Abrir"),
        keywords: ["abrir", "terminal", "shell"],
        icon: <TerminalSquare size={18} />,
        run: () => openExternalPath(focusedPath, "terminal")
      }
    );

    if (focusedHasChanges) {
      actions.push({
        id: "review:focused",
        title: t("Rever alterações locais"),
        subtitle: focusedPath,
        section: t("Revisão"),
        keywords: ["review", "diff", "alterações", "staged", "unstaged", "untracked"],
        icon: <Search size={18} />,
        run: () => openReviewForWorktreePath(focusedPath)
      });
    }

    worktrees.forEach((worktree) => {
      const title = worktree.branch
        ? locale === "en" ? `Focus worktree: ${worktree.branch}` : `Focar worktree: ${worktree.branch}`
        : locale === "en" ? `Focus worktree: ${basename(worktree.path)}` : `Focar worktree: ${basename(worktree.path)}`;
      actions.push({
        id: `worktree:focus:${worktree.id}`,
        title,
        subtitle: worktree.path,
        section: "Worktrees",
        keywords: ["focar", "worktree", worktree.branch ?? "", worktree.path],
        shortcut: worktree.isCurrent ? t("Em foco") : undefined,
        icon: <GitFork size={18} />,
        run: () => {
          setFocusedWorktreePaths((focusMap) => ({ ...focusMap, [selectedRepo.id]: worktree.path }));
          openWorktreeDetail(worktree);
        }
      });

      if (!sameWorktreePath(worktree.path, selectedRepo.path) && worktree.branch) {
        actions.push({
          id: `worktree:handoff:${worktree.id}`,
          title: locale === "en" ? `Handoff to local: ${worktree.branch}` : `Handoff para local: ${worktree.branch}`,
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
          title: locale === "en" ? `Checkout branch: ${branch.name}` : `Checkout branch: ${branch.name}`,
          subtitle: branch.upstream ?? (locale === "en" ? "Local branch" : "Branch local"),
          section: "Branches",
          keywords: ["checkout", "switch", "branch", branch.name, branch.upstream ?? ""],
          icon: <GitBranch size={18} />,
          run: () => confirmBranchCheckout(branch)
        });
      });

    actions.push(
      {
        id: "settings:safe-mode",
        title: settings.safeMode
          ? locale === "en" ? "Turn safe mode off" : "Desligar modo seguro"
          : locale === "en" ? "Turn safe mode on" : "Ativar modo seguro",
        subtitle: locale === "en" ? "Preflight checks for sensitive Git operations" : "Pré-validação para operações Git sensíveis",
        section: pageCopy.settings.nav,
        keywords: ["safe", "seguro", "modo"],
        icon: settings.safeMode ? <ShieldOff size={18} /> : <ShieldCheck size={18} />,
        run: () => void updateSafeMode(!settings.safeMode)
      },
      {
        id: "settings:theme:dark",
        title: locale === "en" ? "Dark theme" : "Tema escuro",
        subtitle: locale === "en" ? "Apply dark theme" : "Aplicar tema escuro",
        section: pageCopy.settings.nav,
        keywords: ["tema", "escuro", "dark"],
        shortcut: themePreference === "dark" ? t("Atual") : undefined,
        icon: <Moon size={18} />,
        run: () => setThemePreference("dark")
      },
      {
        id: "settings:theme:light",
        title: locale === "en" ? "Light theme" : "Tema claro",
        subtitle: locale === "en" ? "Apply light theme" : "Aplicar tema claro",
        section: pageCopy.settings.nav,
        keywords: ["tema", "claro", "light"],
        shortcut: themePreference === "light" ? t("Atual") : undefined,
        icon: <Sun size={18} />,
        run: () => setThemePreference("light")
      },
      {
        id: "settings:theme:system",
        title: locale === "en" ? "System theme" : "Tema do sistema",
        subtitle: locale === "en" ? "Follow system preference" : "Seguir preferência do sistema",
        section: pageCopy.settings.nav,
        keywords: ["tema", "sistema", "system"],
        shortcut: themePreference === "system" ? t("Atual") : undefined,
        icon: <Monitor size={18} />,
        run: () => setThemePreference("system")
      }
    );

    return actions;
  }

  function renderRepoHero() {
    if (!selectedSummary) return null;

    return (
      <section className="repo-hero" aria-label={t("Repositório em foco")}>
        <div className="hero-left">
          <div className="hero-icon">
            <Folder size={34} />
          </div>
          <div>
            <span>{t("Repositório em foco")}</span>
            <h2>{selectedSummary.repo.name}</h2>
            <p title={selectedSummary.focusedWorktreePath}>{selectedSummary.focusedWorktreePath}</p>
          </div>
        </div>
        <div className="hero-meta">
          <span className="valid-badge">{t("Válido")}</span>
          {selectedSummary.changedFileCount ? (
            <span className="badge amber">{formatChangeCount(selectedSummary.changedFileCount, locale)}</span>
          ) : (
            <span className="badge green">{t("Sem alterações")}</span>
          )}
          {selectedSummary.stashCount ? (
            <span className="badge purple">{formatStashCount(selectedSummary.stashCount, locale)}</span>
          ) : null}
          {renderSyncBadges(selectedSummary, false, locale)}
          <span>{selectedSummary.gitVersion}</span>
        </div>
      </section>
    );
  }

  function renderRepoStats() {
    if (!selectedSummary) return null;

    return (
      <section className="stats-grid" aria-label={t("Métricas")}>
        <StatCard
          tone="purple"
          icon={<GitFork />}
          label="Worktrees"
          value={selectedSummary.worktreeCount}
          detail={
            selectedSummary.dirtyWorktreeCount
              ? locale === "en"
                ? `${selectedSummary.dirtyWorktreeCount} changed`
                : `${selectedSummary.dirtyWorktreeCount} com alterações`
              : t("Todas limpas")
          }
        />
        <StatCard tone="blue" icon={<GitBranch />} label="Branches" value={selectedSummary.branchCount} detail="Total" />
        <StatCard tone="green" icon={<CheckCircle2 />} label={t("Atual")} value={selectedSummary.currentBranch} detail={t("Branch atual")} />
        <StatCard
          tone="purple"
          icon={<RefreshCcw />}
          label={t("Sincronização")}
          value={syncLabel(selectedSummary.ahead ?? 0, selectedSummary.behind ?? 0)}
          detail={`${selectedSummary.branchAheadCount ?? 0} ahead / ${selectedSummary.branchBehindCount ?? 0} behind`}
        />
        <StatCard
          tone="amber"
          icon={<AlertTriangle />}
          label={t("Alterações")}
          value={selectedSummary.changedFileCount ?? 0}
          detail={selectedSummary.stashCount ? formatStashCount(selectedSummary.stashCount, locale) : t("Sem stash")}
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
        onCopy={(path) => void copyPath(path, setError, locale)}
        onFetch={(path) => void runDetailAction("Fetch", () => api.fetchRepo(selectedRepo.id, path))}
        onPull={(path) => confirmPull(path, "detail")}
        onHandoffLocal={confirmHandoffWorktreeToLocal}
        onMoveLocalToWorktree={confirmMoveLocalBranchToWorktree}
        onReview={openReviewForWorktreePath}
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
          title={t("Workflows guiados")}
          subtitle={t("Fluxos orientados para operações frequentes e sensíveis")}
          actions={
            <button className="secondary-button" onClick={() => void refreshDashboard()}>
              {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
              {t("Atualizar")}
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
          subtitle={t("Gerir worktrees do repositório")}
          actions={
            <>
              <button className="secondary-button" onClick={() => void refreshDashboard()}>
                {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
                {t("Atualizar")}
              </button>
              <button className="primary-button" onClick={() => setDialog({ kind: "create-worktree" })}>
                <Plus size={18} />
                {t("Nova Worktree")}
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
            onCopy={(path) => void copyPath(path, setError, locale)}
            onReview={openWorktreeReview}
            onArchive={(worktree) => void archiveWorktree(worktree)}
            onDelete={(worktree) => setDialog({ kind: "delete-worktree", worktree })}
          />
        </DashboardSection>
        <ArchivedWorktreesPanel
          archivedWorktrees={archivedWorktrees}
          onOpen={openExternalPath}
          onCopy={(path) => void copyPath(path, setError, locale)}
          onRestore={(worktree) => void restoreWorktree(worktree)}
        />
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
          subtitle={t("Gerir branches do repositório")}
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
                {t("Nova Branch")}
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
        title={t("Operações recentes")}
        subtitle={t("Histórico local dos comandos Git")}
        actions={
          <button className="secondary-button" onClick={() => void refreshOperations()}>
            {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            {t("Atualizar")}
          </button>
        }
      >
        <OperationsTable operations={operations} onRefresh={() => void refreshOperations()} />
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
    <I18N_CONTEXT.Provider value={i18n}>
    <div className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      {loading || actionLoading || detailLoading || reviewLoading ? (
        <div className="app-progress" role="progressbar" aria-label={a11yCopy.progress} />
      ) : null}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />

      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""} ${sidebarCollapsed ? "is-collapsed" : ""}`}>
        <div className="brand">
          <GitFork aria-hidden="true" />
          <span className="brand-name">Worktree Manager</span>
        </div>

        <nav className="nav-stack" aria-label={shellCopy.navigation}>
          <span className="nav-label">{shellCopy.navigation}</span>
          {navItems.map((item) => (
            <button
              key={item.page}
              aria-current={activePage === item.page ? "page" : undefined}
              aria-label={item.label}
              className={activePage === item.page ? "nav-item active" : "nav-item"}
              type="button"
              onClick={() => navigateToPage(item.page)}
              title={item.label}
            >
              {item.icon}
              <span className="nav-item-label">{item.label}</span>
            </button>
          ))}
          <button
            aria-label={pageCopy.settings.nav}
            className="nav-item"
            type="button"
            onClick={() => {
              setDialog({ kind: "settings" });
              setSidebarOpen(false);
            }}
            title={pageCopy.settings.nav}
          >
            <Settings size={18} />
            <span className="nav-item-label">{pageCopy.settings.nav}</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <span className="version-label">v1.0.0</span>
          <button
            className="icon-button sidebar-collapse-button"
            type="button"
            aria-label={sidebarCollapsed ? a11yCopy.expandSidebar : a11yCopy.collapseSidebar}
            title={sidebarCollapsed ? a11yCopy.expandSidebar : a11yCopy.collapseSidebar}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
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
            <ThemeToggleButton value={themePreference} onChange={setThemePreference} />
            <RepositoryFocusSelect
              repos={workspaceRepos}
              selectedRepoId={selectedRepoId}
              onChange={setSelectedRepoId}
            />
            <button className="primary-button" onClick={() => setDialog({ kind: "repo-picker" })}>
              <Folder size={18} />
              {t("Adicionar")}
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
          branchPrefix={settings.branchPrefix}
          defaultWorktreeDirectory={settings.worktreeDirectory}
          busy={actionLoading !== null}
          onClose={() => setDialog(null)}
          onCreate={(body) =>
            void runAction(t("Nova Worktree"), async () => {
              const created = await api.createWorktree(selectedRepo.id, body);
              setFocusedWorktreePaths((focusMap) => ({ ...focusMap, [selectedRepo.id]: created.path }));
              setDialog(null);
            })
          }
        />
      ) : null}

      {dialog?.kind === "settings" ? (
        <SettingsDialog
          title={pageCopy.settings.title}
          subtitle={pageCopy.settings.subtitle}
          settings={settings}
          settingsCopy={settingsCopy}
          locale={locale}
          themePreference={themePreference}
          diagnostics={diagnostics}
          diagnosticsCopied={diagnosticsCopied}
          initialSection={dialog.section}
          integrationCatalog={integrationCatalog}
          focusedPath={selectedFocusedWorktreePath ?? selectedRepo?.path ?? null}
          busy={actionLoading}
          onClose={closeSettingsDialog}
          onThemeChange={setThemePreference}
          onLocaleChange={(nextLocale) => void updateLocale(nextLocale)}
          onSafeModeChange={(safeMode) => void updateSafeMode(safeMode)}
          onPickWorktreeDirectory={pickDefaultWorktreeDirectory}
          onSaveWorkDefaults={(defaults) => void updateWorkDefaults(defaults)}
          onRefreshDiagnostics={() => void refreshDiagnostics()}
          onCopyDiagnostics={() => void copyDiagnostics()}
          onRefreshIntegrations={() => void refreshIntegrations()}
          onIntegrationChange={updateIntegrations}
          onOpen={openExternalPath}
        />
      ) : null}

      {dialog?.kind === "review" && selectedRepo ? (
        <Modal title={t("Revisão")} size="wide" onClose={() => setDialog(null)}>
          <div className="review-modal-content">
            <RepoReviewView
              review={
                review?.repo.id === selectedRepo.id &&
                sameWorktreePath(review.worktree.path, dialog.worktreePath)
                  ? review
                  : null
              }
              error={reviewError}
              loading={reviewLoading}
              selectedFileId={selectedReviewFileId}
              onSelectFile={setSelectedReviewFileId}
              onRefresh={() => void refreshReview(selectedRepo.id, dialog.worktreePath)}
              onOpen={openExternalPath}
              onCopy={(path) => void copyPath(path, setError, locale)}
            />
          </div>
        </Modal>
      ) : null}

      {dialog?.kind === "create-branch" && selectedRepo ? (
        <CreateBranchDialog
          branches={localBranches}
          branchPrefix={settings.branchPrefix}
          busy={actionLoading !== null}
          onClose={() => setDialog(null)}
          onCreate={(body) =>
            void runAction(t("Nova Branch"), async () => {
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
          title={t("Remover worktree")}
          expected={basename(dialog.worktree.path)}
          label={dialog.worktree.path}
          busy={actionLoading !== null}
          onClose={() => setDialog(null)}
          onConfirm={(confirm) =>
            void runAction(t("Remover worktree"), async () => {
              await api.removeWorktree(selectedRepo.id, dialog.worktree.id, confirm);
              setDialog(null);
            })
          }
        />
      ) : null}

      {dialog?.kind === "delete-branch" && selectedRepo ? (
        <ConfirmDeleteDialog
          title={t("Apagar branch")}
          expected={dialog.branch.name}
          label={dialog.branch.name}
          busy={actionLoading !== null}
          onClose={() => setDialog(null)}
          onConfirm={(confirm) =>
            void runAction(t("Apagar branch"), async () => {
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
    </I18N_CONTEXT.Provider>
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
  const { locale } = useI18n();

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

function RepositoryFocusSelect({
  repos,
  selectedRepoId,
  onChange
}: {
  repos: RepoRecord[];
  selectedRepoId: string | null;
  onChange: (repoId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <label className="repo-focus-select">
      <span className="sr-only">{t("Repositório em foco")}</span>
      <span className="repo-focus-control">
        <span className={repos.length ? "repo-focus-status active" : "repo-focus-status"} aria-hidden="true" />
        <select
          aria-label={t("Escolher repositório em foco")}
          disabled={!repos.length}
          value={selectedRepoId ?? ""}
          onChange={(event) => {
            if (event.target.value) onChange(event.target.value);
          }}
        >
          {!repos.length ? <option value="">{t("Sem repositórios")}</option> : null}
          {repos.map((repo) => (
            <option key={repo.id} value={repo.id}>
              {repo.name}
            </option>
          ))}
        </select>
        <ChevronDown size={15} aria-hidden="true" />
      </span>
    </label>
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
  const { t } = useI18n();

  return (
    <main className="crash-shell">
      <section className="crash-panel">
        <div className="hero-icon">
          <AlertTriangle size={34} />
        </div>
        <div>
          <h1>{t("Erro de interface")}</h1>
          <p>{message || t("A aplicação encontrou um erro inesperado.")}</p>
        </div>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onRetry}>
            {t("Tentar novamente")}
          </button>
          <button className="primary-button" type="button" onClick={() => window.location.reload()}>
            {t("Recarregar")}
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
  const { t } = useI18n();

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
        {t("Abrir workflow")}
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
  const { t } = useI18n();
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
            {t("Worktree de origem")}
            <select value={worktreeId} onChange={(event) => setWorktreeId(event.target.value)} disabled={!handoffOptions.length}>
              {handoffOptions.length ? (
                handoffOptions.map((worktree) => (
                  <option key={worktree.id} value={worktree.id}>
                    {worktree.branch ?? basename(worktree.path)} - {worktree.path}
                  </option>
                ))
              ) : (
                <option value="">{t("Sem worktree elegível")}</option>
              )}
            </select>
          </label>
        ) : null}

        <div className="workflow-dialog-grid">
          <section className="workflow-dialog-block">
            <h3>{t("Passos")}</h3>
            <ol>
              {workflow.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
          <section className="workflow-dialog-block">
            <h3>{t("Pré-condições")}</h3>
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
            {t("Cancelar")}
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

function hasReviewableChanges(status?: GitStatusSummary | null): boolean {
  return (status?.total ?? 0) > 0;
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

function matchesReviewFile(file: ReviewDiffFile, filter: ReviewFilter, query: string): boolean {
  if (filter !== "all" && file.mode !== filter) return false;
  return matchesSearch([file.path, file.originalPath, file.statusLabel, file.mode], query);
}

function renderReviewDiff(
  file: ReviewDiffFile,
  viewMode: DiffViewMode,
  t: (value: string) => string
) {
  const warning = reviewFileWarning(file, t);
  if (warning) {
    return (
      <div className="review-warning">
        <AlertTriangle size={18} />
        <div>
          <strong>{t("Não pré-visualizável")}</strong>
          <p>{warning}</p>
        </div>
      </div>
    );
  }

  if (!file.hunks.length) {
    return (
      <div className="review-empty review-empty-main">
        <EyeOff size={28} />
        <strong>{t("Sem diff para mostrar")}</strong>
        <span>{t("Este estado não tem conteúdo textual renderizável.")}</span>
      </div>
    );
  }

  return viewMode === "split" ? <SplitDiffView file={file} /> : <UnifiedDiffView file={file} />;
}

function UnifiedDiffView({ file }: { file: ReviewDiffFile }) {
  return (
    <div className="diff-view unified-diff" role="region" aria-label={`Diff ${file.path}`}>
      {file.truncated ? <ReviewTruncatedNotice /> : null}
      {file.hunks.map((hunk) => (
        <div className="diff-hunk" key={hunk.header}>
          <div className="diff-hunk-header">{hunk.header}</div>
          <table className="diff-table">
            <tbody>
              {hunk.lines.map((line, index) => (
                <tr className={`diff-row ${line.type}`} key={`${hunk.header}-${index}`}>
                  <td className="diff-line-number">{line.oldLineNumber ?? ""}</td>
                  <td className="diff-line-number">{line.newLineNumber ?? ""}</td>
                  <td className="diff-line-code">
                    <code>{line.type === "meta" ? line.content : `${diffLineMarker(line.type)}${line.content}`}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function SplitDiffView({ file }: { file: ReviewDiffFile }) {
  return (
    <div className="diff-view split-diff" role="region" aria-label={`Split diff ${file.path}`}>
      {file.truncated ? <ReviewTruncatedNotice /> : null}
      {file.hunks.map((hunk) => (
        <div className="diff-hunk" key={hunk.header}>
          <div className="diff-hunk-header">{hunk.header}</div>
          <table className="diff-table split">
            <tbody>
              {hunk.lines.map((line, index) =>
                line.type === "meta" ? (
                  <tr className="diff-row meta" key={`${hunk.header}-${index}`}>
                    <td className="diff-line-code" colSpan={4}>
                      <code>{line.content}</code>
                    </td>
                  </tr>
                ) : (
                  <tr className={`diff-row ${line.type}`} key={`${hunk.header}-${index}`}>
                    <td className="diff-line-number">{line.oldLineNumber ?? ""}</td>
                    <td className="diff-line-code old">
                      <code>{line.type === "add" ? "" : `${diffLineMarker(line.type)}${line.content}`}</code>
                    </td>
                    <td className="diff-line-number">{line.newLineNumber ?? ""}</td>
                    <td className="diff-line-code new">
                      <code>{line.type === "delete" ? "" : `${diffLineMarker(line.type)}${line.content}`}</code>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function ReviewTruncatedNotice() {
  const { t } = useI18n();
  return (
    <div className="review-warning compact">
      <AlertTriangle size={16} />
      <span>{t("Truncado")}</span>
    </div>
  );
}

function reviewFileWarning(file: ReviewDiffFile, t: (value: string) => string): string | null {
  if (file.binary) return t("Ficheiro binário");
  if (file.tooLarge) return t("Demasiado grande");
  if (file.error) return file.error;
  return null;
}

function diffLineMarker(type: ReviewDiffFile["hunks"][number]["lines"][number]["type"]) {
  if (type === "add") return "+";
  if (type === "delete") return "-";
  if (type === "context") return " ";
  return "";
}

function reviewModeLabel(mode: DiffMode, t: (value: string) => string) {
  if (mode === "staged") return t("Staged");
  if (mode === "unstaged") return t("Unstaged");
  return t("Untracked");
}

function reviewModeBadgeTone(mode: DiffMode) {
  if (mode === "staged") return "green";
  if (mode === "unstaged") return "blue";
  return "purple";
}

function formatReviewChangeSummary(file: ReviewDiffFile, t: (value: string) => string) {
  if (file.binary || file.tooLarge || file.error) return t("Não pré-visualizável");
  return `+${file.additions} ${t("adicionadas")} / -${file.deletions} ${t("removidas")}`;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase("pt-PT");
}

function renderWorktreeStatusBadges(worktree: WorktreeRecord, showClean = false, locale: Locale = "pt") {
  const status = getWorktreeStatus(worktree);

  if (status.clean) {
    return showClean ? <span className="badge green">{translate(locale, "Limpa")}</span> : null;
  }

  return (
    <>
      {status.conflicted ? (
        <span className="badge danger">{formatConflictCount(status.conflicted, locale)}</span>
      ) : null}
      <span className="badge amber">{formatChangeCount(status.total, locale)}</span>
      {status.untracked ? (
        <span className="badge purple">{formatUntrackedCount(status.untracked, locale)}</span>
      ) : null}
    </>
  );
}

function renderSyncBadges(
  sync: { ahead?: number; behind?: number; upstream?: string | null },
  showSynced = false,
  locale: Locale = "pt"
) {
  const ahead = sync.ahead ?? 0;
  const behind = sync.behind ?? 0;

  if (!ahead && !behind) {
    if (!showSynced) return null;
    return (
      <span className={`badge ${sync.upstream ? "green" : "neutral"}`}>
        {sync.upstream ? "Sync" : translate(locale, "Sem upstream")}
      </span>
    );
  }

  return (
    <span className="badges sync-badges">
      {ahead ? <span className="badge amber">Ahead {ahead}</span> : null}
      {behind ? <span className="badge purple">Behind {behind}</span> : null}
    </span>
  );
}

function formatChangeCount(value: number, locale: Locale = "pt"): string {
  if (locale === "en") return `${value} ${value === 1 ? "change" : "changes"}`;
  return `${value} ${value === 1 ? "alteração" : "alterações"}`;
}

function formatConflictCount(value: number, locale: Locale = "pt"): string {
  if (locale === "en") return `${value} ${value === 1 ? "conflict" : "conflicts"}`;
  return `${value} ${value === 1 ? "conflito" : "conflitos"}`;
}

function formatUntrackedCount(value: number, locale: Locale = "pt"): string {
  if (locale === "en") return `${value} ${value === 1 ? "new" : "new"}`;
  return `${value} ${value === 1 ? "nova" : "novas"}`;
}

function formatStashCount(value: number, locale: Locale = "pt"): string {
  if (locale === "en") return `${value} ${value === 1 ? "stash" : "stashes"}`;
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
  const { locale, t } = useI18n();

  return (
    <section className="panel workspace-panel" aria-label={t("Repos ativos")}>
      <div className="section-header">
        <div>
          <h2>{t("Área de trabalho")}</h2>
          <p>{t("Gerir vários repositórios em paralelo e escolher o foco das operações.")}</p>
        </div>
        <div className="section-actions">
          <button className="secondary-button" onClick={onRefresh}>
            {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            {t("Atualizar todos")}
          </button>
          <button className="primary-button" onClick={onAdd}>
            <Plus size={18} />
            {t("Adicionar")}
          </button>
        </div>
      </div>

      <div className="workspace-totals" aria-label={locale === "en" ? "Workspace totals" : "Totais da área de trabalho"}>
        <div>
          <FolderGit2 size={18} />
          <strong>{repos.length}</strong>
          <span>{t("Repos ativos")}</span>
        </div>
        <div>
          <GitFork size={18} />
          <strong>{totals.worktreeCount}</strong>
          <span>Worktrees</span>
        </div>
        <div>
          <AlertTriangle size={18} />
          <strong>{totals.changedFileCount}</strong>
          <span>{t("Alterações")}</span>
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
                  <span className="badge danger">{t("Erro")}</span>
                ) : summary ? (
                  <>
                    <span className="badge blue">{summary.currentBranch}</span>
                    {summary.changedFileCount ? (
                      <span className="badge amber">{formatChangeCount(summary.changedFileCount, locale)}</span>
                    ) : (
                      <span className="badge green">{t("Limpo")}</span>
                    )}
                    {summary.stashCount ? (
                      <span className="badge purple">{formatStashCount(summary.stashCount, locale)}</span>
                    ) : null}
                    {renderSyncBadges(summary, false, locale)}
                    <span>{summary.worktreeCount} WT</span>
                    <span>{summary.branchCount} BR</span>
                  </>
                ) : (
                  <>
                    <Clock3 size={14} />
                    <span>{t("A carregar")}</span>
                  </>
                )}
              </div>
              {error ? <p className="workspace-card-error">{error}</p> : null}
              <button className="icon-button compact workspace-remove" title={t("Remover da área de trabalho")} onClick={() => onRemove(repo.id)}>
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
  onMoveLocalToWorktree,
  onReview
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
  onReview: (path: string) => void;
}) {
  const { locale, t } = useI18n();

  if (!detail) {
    return (
      <section className="panel focus-placeholder">
        {loading ? <Loader2 className="spin" size={22} /> : <AlertTriangle size={22} />}
        <div>
          <h2>{error ? t("Detalhe indisponível") : t("A carregar detalhe")}</h2>
          <p>{error ?? t("A recolher estado Git da worktree selecionada.")}</p>
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

      <section className="repo-hero detail-hero" aria-label={t("Detalhe da worktree")}>
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
            {t("Atualizar")}
          </button>
          <button className="secondary-button" onClick={() => onOpen(detail.worktree.path, "folder")}>
            <Folder size={16} />
            {t("Pasta")}
          </button>
          <button className="secondary-button" onClick={() => onOpen(detail.worktree.path, "editor")}>
            <Code2 size={16} />
            {t("Editor")}
          </button>
          <button className="secondary-button" onClick={() => onOpen(detail.worktree.path, "terminal")}>
            <TerminalSquare size={16} />
            {t("Terminal")}
          </button>
          <button className="secondary-button" onClick={() => onCopy(detail.worktree.path)}>
            <Copy size={16} />
            {t("Copiar")}
          </button>
          <button className="secondary-button" disabled={!hasReviewableChanges(detail.status)} onClick={() => onReview(detail.worktree.path)}>
            <Search size={16} />
            {t("Revisão")}
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
              {t("Mover para worktree")}
            </button>
          ) : (
            <button className="primary-button" disabled={checkoutLocalDisabled} onClick={() => onHandoffLocal(detail.worktree)}>
              <Home size={16} />
              {t("Checkout local")}
            </button>
          )}
        </div>
      </section>

      <section className="stats-grid detail-stats" aria-label={t("Estado Git")}>
        <StatCard tone="green" icon={<GitBranch />} label="Branch" value={detail.branch ?? "detached"} detail={detail.worktree.detached ? t("HEAD destacado") : t("Branch associada")} />
        <StatCard tone="blue" icon={<GitFork />} label="Upstream" value={detail.upstream ?? "-"} detail={t("Ramo remoto")} />
        <StatCard tone="purple" icon={<RefreshCcw />} label={t("Sincronização")} value={syncLabel(detail.ahead, detail.behind)} detail={t("Ahead / behind")} />
        <StatCard tone="amber" icon={<Clock3 />} label={t("Último fetch")} value={relativeDate(detail.lastFetchAt, locale)} detail="FETCH_HEAD" />
      </section>

      <DashboardSection id="detail-status" title={t("Estado local")} subtitle={t("Alterações nesta worktree")}>
        <div className="detail-status-grid">
          <StatusPill label="Total" value={detail.status.total} tone="amber" />
          <StatusPill label="Staged" value={detail.status.staged} tone="green" />
          <StatusPill label="Unstaged" value={detail.status.unstaged} tone="blue" />
          <StatusPill label="Untracked" value={detail.status.untracked} tone="purple" />
          <StatusPill label={t("Conflitos")} value={detail.status.conflicted} tone="danger" />
          <StatusPill label="Stashes" value={detail.stashCount} tone="purple" />
        </div>
        <ChangedFilesTable files={detail.files} />
      </DashboardSection>

      <DashboardSection id="detail-worktrees" title="Worktrees" subtitle={t("Worktrees deste repositório")}>
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
                  {active ? <span className="badge green">{t("Selecionada")}</span> : null}
                  {local ? <span className="badge blue">{t("Local")}</span> : null}
                  {renderWorktreeStatusBadges(worktree, true, locale)}
                  {renderSyncBadges(worktree, false, locale)}
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
  const { t } = useI18n();

  if (!files.length) {
    return <p className="empty-copy">{t("Sem alterações locais.")}</p>;
  }

  return (
    <div className="table-wrap detail-files-table">
      <table>
        <thead>
          <tr>
            <th>{t("Ficheiro")}</th>
            <th>{t("Estado")}</th>
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
                  {t(file.label)}
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

function RepoReviewView({
  review,
  error,
  loading,
  selectedFileId,
  onSelectFile,
  onRefresh,
  onOpen,
  onCopy
}: {
  review: ReviewDiffResponse | null;
  error: string | null;
  loading: boolean;
  selectedFileId: string | null;
  onSelectFile: (fileId: string | null) => void;
  onRefresh: () => void;
  onOpen: (path: string, target: OpenTarget) => void;
  onCopy: (path: string) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [viewMode, setViewMode] = useState<DiffViewMode>("unified");
  const reviewResetKey = review ? `${review.repo.id}:${review.worktree.path}:${review.generatedAt}` : "";

  useEffect(() => {
    if (!reviewResetKey) return;
    setQuery("");
    setFilter("all");
  }, [reviewResetKey]);

  if (!review) {
    return (
      <section className="panel focus-placeholder">
        {loading ? <Loader2 className="spin" size={22} /> : <AlertTriangle size={22} />}
        <div>
          <h2>{error ? t("Revisão indisponível") : t("A carregar revisão")}</h2>
          <p>{error ?? t("A gerar diffs da worktree em foco.")}</p>
        </div>
      </section>
    );
  }

  const counts = {
    staged: review.files.filter((file) => file.mode === "staged").length,
    unstaged: review.files.filter((file) => file.mode === "unstaged").length,
    untracked: review.files.filter((file) => file.mode === "untracked").length
  };
  const filteredFiles = review.files.filter((file) => matchesReviewFile(file, filter, query));
  const selectedFile =
    filteredFiles.find((file) => file.id === selectedFileId) ??
    filteredFiles[0] ??
    null;
  const selectedPath = selectedFile ? joinFsPath(review.worktree.path, selectedFile.path) : null;
  const filterOptions: Array<{ value: ReviewFilter; label: string; count: number }> = [
    { value: "all", label: t("Todos"), count: review.files.length },
    { value: "staged", label: "Staged", count: counts.staged },
    { value: "unstaged", label: "Unstaged", count: counts.unstaged },
    { value: "untracked", label: "Untracked", count: counts.untracked }
  ];

  return (
    <>
      {error ? (
        <div className="inline-warning">
          <AlertTriangle size={17} />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="repo-hero detail-hero review-hero" aria-label={t("Visualizador de revisão")}>
        <div className="hero-left">
          <div className="hero-icon">
            <Search size={34} />
          </div>
          <div>
            <span>{review.repo.name}</span>
            <h2>{review.branch ?? "Detached HEAD"}</h2>
            <p title={review.worktree.path}>{review.worktree.path}</p>
          </div>
        </div>
        <div className="detail-hero-actions">
          <button className="secondary-button" onClick={onRefresh}>
            {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            {t("Atualizar")}
          </button>
          <button
            className="secondary-button"
            disabled={!selectedPath}
            onClick={() => selectedPath && onOpen(selectedPath, "editor")}
          >
            <Code2 size={16} />
            {t("Editor")}
          </button>
          <button
            className="secondary-button"
            disabled={!selectedPath}
            onClick={() => selectedPath && onCopy(selectedPath)}
          >
            <Copy size={16} />
            {t("Copiar caminho")}
          </button>
        </div>
      </section>

      <section className="stats-grid detail-stats" aria-label={t("Ficheiros alterados")}>
        <StatCard tone="amber" icon={<AlertTriangle />} label={t("Alterações")} value={review.status.total} detail={review.status.clean ? t("Sem alterações") : t("Total")} />
        <StatCard tone="green" icon={<CheckCircle2 />} label="Staged" value={review.status.staged} detail={t("Prontas para commit")} />
        <StatCard tone="blue" icon={<Code2 />} label="Unstaged" value={review.status.unstaged} detail={t("Alterações locais")} />
        <StatCard tone="purple" icon={<Folder />} label="Untracked" value={review.status.untracked} detail={t("Por seguir")} />
      </section>

      <section className="panel review-panel">
        <div className="section-header">
          <div>
            <h2>{t("Ficheiros alterados")}</h2>
            <p>{t("Revisão read-only de staged, unstaged e untracked.")}</p>
          </div>
          <div className="review-view-toggle" role="group" aria-label={t("Modo de visualização")}>
            {(["unified", "split"] as DiffViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={viewMode === mode}
                onClick={() => setViewMode(mode)}
              >
                {mode === "unified" ? t("Unified") : t("Split")}
              </button>
            ))}
          </div>
        </div>

        <div className="review-layout">
          <aside className="review-files" aria-label={t("Ficheiros alterados")}>
            <label className="search-field review-search">
              <Search size={16} />
              <input
                aria-label={t("Pesquisar ficheiros")}
                value={query}
                placeholder={t("Pesquisar ficheiros")}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="filter-chips review-filters" role="group" aria-label={t("Filtros")}>
              {filterOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filter === option.value}
                  onClick={() => setFilter(option.value)}
                >
                  {option.label}
                  <span>{option.count}</span>
                </button>
              ))}
            </div>

            <div className="review-file-list">
              {!review.files.length ? (
                <div className="review-empty">
                  <CheckCircle2 size={22} />
                  <strong>{t("Sem alterações para revisão")}</strong>
                  <span>{t("A worktree em foco está limpa.")}</span>
                </div>
              ) : null}
              {review.files.length && !filteredFiles.length ? (
                <div className="review-empty">
                  <Search size={22} />
                  <strong>{t("Sem ficheiros para os filtros atuais")}</strong>
                </div>
              ) : null}
              {filteredFiles.map((file) => (
                <button
                  key={file.id}
                  className={selectedFile?.id === file.id ? "review-file-item active" : "review-file-item"}
                  type="button"
                  aria-pressed={selectedFile?.id === file.id}
                  onClick={() => onSelectFile(file.id)}
                >
                  <span className="review-file-main">
                    <strong title={file.path}>{file.path}</strong>
                    {file.originalPath ? <small title={file.originalPath}>{file.originalPath}</small> : null}
                  </span>
                  <span className="review-file-meta">
                    <span className={`badge ${reviewModeBadgeTone(file.mode)}`}>{reviewModeLabel(file.mode, t)}</span>
                    <span className="review-change-count">{formatReviewChangeSummary(file, t)}</span>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <main className="review-diff-panel" aria-live="polite">
            {selectedFile ? (
              <>
                <div className="review-diff-header">
                  <div>
                    <span className={`badge ${reviewModeBadgeTone(selectedFile.mode)}`}>{reviewModeLabel(selectedFile.mode, t)}</span>
                    <h3 title={selectedFile.path}>{selectedFile.path}</h3>
                    {selectedFile.originalPath ? <p title={selectedFile.originalPath}>{selectedFile.originalPath}</p> : null}
                  </div>
                  <div className="review-diff-actions">
                    <span>{formatReviewChangeSummary(selectedFile, t)}</span>
                    <button className="icon-button" type="button" title={t("Abrir no editor")} onClick={() => onOpen(joinFsPath(review.worktree.path, selectedFile.path), "editor")}>
                      <Code2 size={16} />
                    </button>
                    <button className="icon-button" type="button" title={t("Copiar caminho")} onClick={() => onCopy(joinFsPath(review.worktree.path, selectedFile.path))}>
                      <Copy size={16} />
                    </button>
                  </div>
                </div>
                {renderReviewDiff(selectedFile, viewMode, t)}
              </>
            ) : (
              <div className="review-empty review-empty-main">
                <Search size={28} />
                <strong>{review.files.length ? t("Sem ficheiro selecionado") : t("Sem alterações para revisão")}</strong>
                <span>{review.files.length ? t("Seleciona um ficheiro para rever o diff.") : t("A worktree em foco está limpa.")}</span>
              </div>
            )}
          </main>
        </div>
      </section>
    </>
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
  const { t } = useI18n();

  return (
    <section className="panel focus-placeholder">
      {loading ? <Loader2 className="spin" size={22} /> : <AlertTriangle size={22} />}
      <div>
        <h2>{repo ? repo.name : t("Sem repositório em foco")}</h2>
        <p>{error ?? t("A carregar os dados do repositório selecionado.")}</p>
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
  const { t } = useI18n();

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
      <div className="filter-chips" aria-label={t("Filtros")}>
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
  onReview,
  onArchive,
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
  onReview: (worktree: WorktreeRecord) => void;
  onArchive: (worktree: WorktreeRecord) => void;
  onDelete: (worktree: WorktreeRecord) => void;
}) {
  const { locale, t } = useI18n();
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
        placeholder={t("Pesquisar worktrees")}
        activeFilter={filter}
        onFilterChange={(value) => setFilter(value as WorktreeFilter)}
        filters={[
          { value: "all", label: t("Todas") },
          { value: "current", label: t("Em foco") },
          { value: "dirty", label: t("Com alterações") },
          { value: "clean", label: t("Limpas") },
          { value: "ahead", label: "Ahead" },
          { value: "behind", label: "Behind" },
          { value: "detached", label: t("Detached") }
        ]}
      />
      {filteredWorktrees.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("Caminho")}</th>
                <th>Branch</th>
                <th>Sync</th>
                <th>HEAD</th>
                <th>{t("Último Commit")}</th>
                <th>{t("Data")}</th>
                <th>{t("Ações")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredWorktrees.map((worktree) => {
                const isLocalWorkspace = sameWorktreePath(worktree.path, localWorkspacePath);
                const checkoutLocalDisabled = isLocalWorkspace || !worktree.branch || worktree.detached || worktree.bare;
                const moveLocalDisabled =
                  !isLocalWorkspace || !worktree.branch || worktree.detached || worktree.bare || isBaseBranch(worktree.branch);

                return (
                  <tr key={worktree.id} className={worktree.isCurrent ? "worktree-row-focused" : undefined}>
                    <td>
                      <button className="path-cell path-button" title={worktree.path} onClick={() => onInspect(worktree)}>
                        {worktree.isCurrent ? <Home size={16} /> : <GitFork size={16} />}
                        <span>{worktree.path}</span>
                      </button>
                    </td>
                    <td>
                      <div className="badges">
                        {worktree.isCurrent ? <span className="badge green">{t("Em foco")}</span> : null}
                        <span className={worktree.branch && !worktree.detached ? "badge blue" : "badge detached"}>
                          {worktree.branch && !worktree.detached ? worktree.branch : t("Detached")}
                        </span>
                        {renderWorktreeStatusBadges(worktree, true, locale)}
                      </div>
                    </td>
                    <td>{renderSyncBadges(worktree, Boolean(worktree.branch && !worktree.detached), locale)}</td>
                    <td>{worktree.head ? worktree.head.slice(0, 7) : "-"}</td>
                    <td>{worktree.lastCommit?.subject ?? "-"}</td>
                    <td>{relativeDate(worktree.lastCommit?.date, locale)}</td>
                    <td>
                      <div className="inline-actions">
                        <RowActions
                          items={[
                            { label: t("Abrir pasta"), icon: <Folder size={15} />, onClick: () => onOpen(worktree.path, "folder") },
                            { label: t("Abrir no editor"), icon: <Code2 size={15} />, onClick: () => onOpen(worktree.path, "editor") },
                            { label: t("Abrir no terminal"), icon: <TerminalSquare size={15} />, onClick: () => onOpen(worktree.path, "terminal") },
                            { label: t("Copiar caminho"), icon: <Copy size={15} />, onClick: () => onCopy(worktree.path) },
                            {
                              label: t("Rever alterações"),
                              icon: <Search size={15} />,
                              disabled: !hasReviewableChanges(worktree.status),
                              onClick: () => onReview(worktree)
                            },
                            isLocalWorkspace
                              ? {
                                  label: t("Mover para worktree"),
                                  icon: <GitFork size={15} />,
                                  disabled: moveLocalDisabled,
                                  onClick: onMoveLocalToWorktree
                                }
                              : {
                                  label: t("Checkout local"),
                                  icon: <Home size={15} />,
                                  disabled: checkoutLocalDisabled,
                                  onClick: () => onHandoffLocal(worktree)
                                },
                            {
                              label: t("Arquivar"),
                              icon: <Archive size={15} />,
                              disabled: isLocalWorkspace,
                              onClick: () => onArchive(worktree)
                            },
                            {
                              label: t("Remover"),
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
          title={worktrees.length ? t("Sem worktrees para os filtros atuais") : t("Ainda não existem worktrees")}
          description={
            worktrees.length
              ? t("Ajusta a pesquisa ou limpa os filtros para voltar à lista completa.")
              : t("Cria uma worktree para trabalhar numa branch em paralelo sem mexer no workspace local.")
          }
          primaryLabel={t("Nova Worktree")}
          onPrimary={onCreate}
          secondaryLabel={worktrees.length ? t("Limpar filtros") : undefined}
          onSecondary={() => {
            setQuery("");
            setFilter("all");
          }}
        />
      )}
      <p className="table-foot">
        {locale === "en"
          ? `Showing ${filteredWorktrees.length} of ${worktrees.length} worktrees`
          : `Mostrando ${filteredWorktrees.length} de ${worktrees.length} worktrees`}
      </p>
    </>
  );
}

function ArchivedWorktreesPanel({
  archivedWorktrees,
  onOpen,
  onCopy,
  onRestore
}: {
  archivedWorktrees: ArchivedWorktreeRecord[];
  onOpen: (path: string, target: OpenTarget) => void;
  onCopy: (path: string) => void;
  onRestore: (worktree: ArchivedWorktreeRecord) => void;
}) {
  const { locale, t } = useI18n();

  return (
    <DashboardSection
      id="worktree-archive"
      title={t("Arquivo")}
      subtitle={t("Worktrees escondidas na app; continuam no disco.")}
    >
      {archivedWorktrees.length ? (
        <div className="table-wrap archive-table">
          <table>
            <thead>
              <tr>
                <th>{t("Caminho")}</th>
                <th>Branch</th>
                <th>HEAD</th>
                <th>{t("Arquivada em")}</th>
                <th>{t("Ações")}</th>
              </tr>
            </thead>
            <tbody>
              {archivedWorktrees.map((worktree) => (
                <tr key={`${worktree.repoId}-${worktree.worktreeId}`}>
                  <td>
                    <div className="path-cell archive-path-cell" title={worktree.path}>
                      <Archive size={16} />
                      <span>{worktree.path}</span>
                    </div>
                  </td>
                  <td>
                    <span className={worktree.branch ? "badge blue" : "badge detached"}>
                      {worktree.branch ?? t("Detached")}
                    </span>
                  </td>
                  <td>{worktree.head ? worktree.head.slice(0, 7) : "-"}</td>
                  <td>{relativeDate(worktree.archivedAt, locale)}</td>
                  <td>
                    <div className="inline-actions">
                      <button
                        className="secondary-button compact-button"
                        type="button"
                        onClick={() => onRestore(worktree)}
                      >
                        <ArchiveRestore size={15} />
                        {t("Restaurar")}
                      </button>
                      <RowActions
                        items={[
                          { label: t("Abrir pasta"), icon: <Folder size={15} />, onClick: () => onOpen(worktree.path, "folder") },
                          { label: t("Abrir no editor"), icon: <Code2 size={15} />, onClick: () => onOpen(worktree.path, "editor") },
                          { label: t("Abrir no terminal"), icon: <TerminalSquare size={15} />, onClick: () => onOpen(worktree.path, "terminal") },
                          { label: t("Copiar caminho"), icon: <Copy size={15} />, onClick: () => onCopy(worktree.path) }
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
        <div className="action-empty-state archive-empty-state">
          <div className="action-empty-icon">
            <Archive size={20} />
          </div>
          <div className="action-empty-copy">
            <h3>{t("Sem worktrees arquivadas")}</h3>
            <p>{t("Arquiva uma worktree para a esconder sem remover do disco.")}</p>
          </div>
        </div>
      )}
    </DashboardSection>
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
  const { locale, t } = useI18n();
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
        placeholder={t("Pesquisar branches")}
        activeFilter={filter}
        onFilterChange={(value) => setFilter(value as BranchFilter)}
        filters={[
          { value: "all", label: t("Todas") },
          { value: "local", label: t("Locais") },
          { value: "remote", label: t("Remotas") },
          { value: "current", label: t("Atual") },
          { value: "ahead", label: "Ahead" },
          { value: "behind", label: "Behind" },
          { value: "no-upstream", label: t("Sem upstream") }
        ]}
      />
      {filteredBranches.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("Nome")}</th>
                <th>{t("Atual")}</th>
                <th>Upstream</th>
                <th>Sync</th>
                <th>{t("Último Commit")}</th>
                <th>{t("Data")}</th>
                <th>{t("Ações")}</th>
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
                      <span className="badge blue">{t("Atual")}</span>
                    ) : branch.isRemote ? (
                      <span className="badge neutral">{t("Remota")}</span>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>{branch.upstream ? <span className="badge purple">{branch.upstream}</span> : "-"}</td>
                  <td>{branch.isRemote ? "-" : renderSyncBadges(branch, true, locale)}</td>
                  <td>{branch.lastCommit?.subject ?? "-"}</td>
                  <td>{relativeDate(branch.lastCommit?.date, locale)}</td>
                  <td>
                    <div className="inline-actions">
                      <RowActions
                        items={[
                          {
                            label: t("Checkout nesta worktree"),
                            icon: <GitBranch size={15} />,
                            disabled: branch.current || branch.isRemote,
                            onClick: () => onCheckout(branch)
                          },
                          {
                            label: t("Apagar"),
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
          title={branches.length ? t("Sem branches para os filtros atuais") : t("Ainda não existem branches locais")}
          description={
            branches.length
              ? t("A pesquisa ou filtro atual não encontrou branches.")
              : t("Cria uma branch local para iniciar trabalho isolado ou preparar uma nova worktree.")
          }
          primaryLabel={t("Nova Branch")}
          onPrimary={onCreate}
          secondaryLabel={branches.length ? t("Limpar filtros") : undefined}
          onSecondary={() => {
            setQuery("");
            setFilter("all");
          }}
        />
      )}
      <p className="table-foot">
        {locale === "en"
          ? `Showing ${filteredBranches.length} of ${branches.length} branches`
          : `Mostrando ${filteredBranches.length} de ${branches.length} branches`}
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
  const { locale, t } = useI18n();
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
        title={t("Ainda não há operações registadas")}
        description={t("Executa uma ação Git ou atualiza o dashboard para popular o histórico local.")}
        primaryLabel={t("Atualizar")}
        onPrimary={onRefresh}
      />
    );
  }

  return (
    <>
      <TableFilters
        query={query}
        onQueryChange={setQuery}
        placeholder={t("Pesquisar operações")}
        activeFilter={filter}
        onFilterChange={(value) => setFilter(value as OperationFilter)}
        filters={[
          { value: "all", label: t("Todas") },
          { value: "success", label: "OK" },
          { value: "error", label: t("Erro") },
          { value: "timeout", label: "Timeout" }
        ]}
      />
      {filteredOperations.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("Estado")}</th>
                <th>{t("Comando")}</th>
                <th>{t("Resumo")}</th>
                <th>{t("Duração")}</th>
                <th>{t("Data")}</th>
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
                          {operation.status === "success" ? "OK" : t("Erro")}
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
                      <td>{relativeDate(operation.finishedAt, locale)}</td>
                      <td>
                        <button
                          aria-expanded={expanded}
                          aria-label={`${expanded ? t("Ocultar") : t("Ver")} logs ${locale === "en" ? "for" : "de"} ${command}`}
                          className="icon-button compact operation-toggle"
                          title={expanded ? t("Ocultar logs") : t("Ver logs")}
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
          title={t("Sem operações para os filtros atuais")}
          description={t("Ajusta a pesquisa ou limpa os filtros para consultar o histórico completo.")}
          primaryLabel={t("Limpar filtros")}
          onPrimary={() => {
            setQuery("");
            setFilter("all");
          }}
          secondaryLabel={t("Atualizar")}
          onSecondary={onRefresh}
        />
      )}
      <p className="table-foot">
        {locale === "en"
          ? `Showing ${Math.min(filteredOperations.length, 24)} of ${operations.length} operations`
          : `Mostrando ${Math.min(filteredOperations.length, 24)} de ${operations.length} operações`}
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
  const { t } = useI18n();

  return (
    <div className="operation-detail">
      <div className="operation-meta-grid">
        <div>
          <span>{t("Comando")}</span>
          <code>{command}</code>
        </div>
        <div>
          <span>{t("Diretório")}</span>
          <code title={operation.cwd}>{operation.cwd}</code>
        </div>
        <div>
          <span>Exit code</span>
          <strong>{operation.exitCode ?? "-"}</strong>
        </div>
        <div>
          <span>{t("Duração")}</span>
          <strong>{formatDuration(operation.durationMs)}</strong>
        </div>
        <div>
          <span>Timeout</span>
          <strong>{operation.timeoutMs ? formatDuration(operation.timeoutMs) : "-"}</strong>
        </div>
        <div>
          <span>{t("Sinal")}</span>
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
  const { t } = useI18n();
  const output = value.trim();

  return (
    <section className="log-panel">
      <header>
        <h3>{title}</h3>
        {truncated ? <span className="badge amber">{t("Truncado")}</span> : null}
      </header>
      {output ? <pre>{output}</pre> : <p className="log-empty">{t("Sem output.")}</p>}
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
  const { t } = useI18n();
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
        aria-label={t("Abrir menu de ações")}
        className="icon-button compact"
        title={t("Ações")}
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

function SettingsDialog({
  title,
  subtitle,
  settings,
  settingsCopy,
  locale,
  themePreference,
  diagnostics,
  diagnosticsCopied,
  initialSection = "general",
  integrationCatalog,
  focusedPath,
  busy,
  onClose,
  onThemeChange,
  onLocaleChange,
  onSafeModeChange,
  onPickWorktreeDirectory,
  onSaveWorkDefaults,
  onRefreshDiagnostics,
  onCopyDiagnostics,
  onRefreshIntegrations,
  onIntegrationChange,
  onOpen
}: {
  title: string;
  subtitle: string;
  settings: AppSettings;
  settingsCopy: (typeof SETTINGS_COPY)[Locale];
  locale: Locale;
  themePreference: ThemePreference;
  diagnostics: DiagnosticsSnapshot | null;
  diagnosticsCopied: boolean;
  initialSection?: SettingsSectionId;
  integrationCatalog: IntegrationCatalog | null;
  focusedPath: string | null;
  busy: string | null;
  onClose: () => void;
  onThemeChange: (value: ThemePreference) => void;
  onLocaleChange: (value: Locale) => void;
  onSafeModeChange: (value: boolean) => void;
  onPickWorktreeDirectory: () => Promise<string | null>;
  onSaveWorkDefaults: (defaults: Pick<AppSettings, "branchPrefix" | "worktreeDirectory">) => void;
  onRefreshDiagnostics: () => void;
  onCopyDiagnostics: () => void;
  onRefreshIntegrations: () => void;
  onIntegrationChange: (integrations: AppSettings["integrations"]) => void;
  onOpen: (path: string, target: OpenTarget) => void;
}) {
  const { t } = useI18n();
  const [section, setSection] = useState<SettingsSectionId>(initialSection);
  const sections: Array<{
    id: SettingsSectionId;
    title: string;
    description: string;
    icon: ReactNode;
  }> = [
    {
      id: "general",
      title: t("Geral"),
      description: t("Tema, idioma, segurança e versão da aplicação."),
      icon: <Settings size={17} />
    },
    {
      id: "git",
      title: "Git",
      description: t("Defaults usados ao criar branches e worktrees."),
      icon: <GitBranch size={17} />
    },
    {
      id: "integrations",
      title: t("Integrações"),
      description: t("Ferramentas externas para abrir worktrees"),
      icon: <Plug size={17} />
    },
    {
      id: "observability",
      title: t("Observabilidade"),
      description: t("Estado local, métricas e exportação de diagnóstico."),
      icon: <Database size={17} />
    }
  ];
  const activeSection = sections.find((item) => item.id === section) ?? sections[0];

  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  return (
    <Modal title={title} onClose={onClose}>
      <div className="settings-modal-layout">
        <div className="settings-modal-intro">
          <span className="settings-label">{t("Configurações da aplicação")}</span>
          <p>{subtitle}</p>
        </div>

        <div className="settings-modal-body">
          <div className="settings-section-tabs" role="tablist" aria-label={t("Secções de configuração")}>
            {sections.map((item) => (
              <button
                key={item.id}
                id={`settings-tab-${item.id}`}
                aria-controls={`settings-panel-${item.id}`}
                aria-selected={section === item.id}
                className={section === item.id ? "settings-section-tab active" : "settings-section-tab"}
                role="tab"
                type="button"
                onClick={() => setSection(item.id)}
              >
                <span className="settings-section-icon">{item.icon}</span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
              </button>
            ))}
          </div>

          <section
            id={`settings-panel-${activeSection.id}`}
            className="settings-modal-content"
            role="tabpanel"
            aria-labelledby={`settings-tab-${activeSection.id}`}
          >
            <div className="settings-section-heading">
              <h3>{activeSection.title}</h3>
              <p>{activeSection.description}</p>
            </div>

            {section === "general" ? (
              <div className="settings-grid">
                <div className="settings-item">
                  <ThemeToggleButton value={themePreference} onChange={onThemeChange} showLabel />
                </div>
                <div className="settings-item">
                  <LanguageControl
                    value={locale}
                    busy={busy === "settings"}
                    copy={settingsCopy}
                    onChange={onLocaleChange}
                  />
                </div>
                <div className="settings-item">
                  <SafeModeControl
                    value={settings.safeMode}
                    busy={busy === "settings"}
                    onChange={onSafeModeChange}
                  />
                </div>
                <div className="settings-item">
                  <span className="settings-label">{settingsCopy.version}</span>
                  <strong>v1.0.0</strong>
                </div>
              </div>
            ) : null}

            {section === "git" ? (
              <div className="settings-grid">
                <div className="settings-item settings-item-wide">
                  <WorkDefaultsControl
                    settings={settings}
                    busy={busy === "settings" || busy === "settings-folder"}
                    onPickFolder={onPickWorktreeDirectory}
                    onSave={onSaveWorkDefaults}
                  />
                </div>
              </div>
            ) : null}

            {section === "integrations" ? (
              <>
                <div className="settings-section-actions">
                  <button className="secondary-button" onClick={onRefreshIntegrations}>
                    {busy === "integrations" ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
                    {t("Detetar")}
                  </button>
                  {focusedPath ? (
                    <>
                      <button className="secondary-button" onClick={() => onOpen(focusedPath, "editor")}>
                        <Code2 size={16} />
                        {t("Testar editor")}
                      </button>
                      <button className="secondary-button" onClick={() => onOpen(focusedPath, "terminal")}>
                        <TerminalSquare size={16} />
                        {t("Testar terminal")}
                      </button>
                    </>
                  ) : null}
                </div>
                <IntegrationsPanel
                  catalog={integrationCatalog}
                  settings={settings}
                  busy={busy === "integrations"}
                  onChange={onIntegrationChange}
                />
              </>
            ) : null}

            {section === "observability" ? (
              <DiagnosticsPanel
                diagnostics={diagnostics}
                busy={busy === "diagnostics" || busy === "diagnostics-copy"}
                copied={diagnosticsCopied}
                onRefresh={onRefreshDiagnostics}
                onCopy={onCopyDiagnostics}
              />
            ) : null}
          </section>
        </div>
      </div>
    </Modal>
  );
}

function ThemeToggleButton({
  value,
  onChange,
  showLabel = false
}: {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
  showLabel?: boolean;
}) {
  const { t } = useI18n();
  const current = themeOption(value, t);
  const nextValue = nextThemePreference(value);
  const next = themeOption(nextValue, t);
  const label = `${t("Tema atual")}: ${current.label}. ${t("Mudar para")} ${next.label}.`;

  return (
    <div className={showLabel ? "theme-toggle-control labelled" : "theme-toggle-control"}>
      {showLabel ? <span>{t("Tema")}</span> : null}
      <button
        className={showLabel ? "theme-toggle-button labelled" : "theme-toggle-button"}
        type="button"
        aria-label={label}
        title={label}
        onClick={() => onChange(nextValue)}
      >
        {current.icon}
        {showLabel ? <span>{current.label}</span> : null}
      </button>
    </div>
  );
}

function themeOption(value: ThemePreference, t: (value: string) => string): { label: string; icon: ReactNode } {
  if (value === "dark") return { label: t("Escuro"), icon: <Moon size={16} /> };
  if (value === "light") return { label: t("Claro"), icon: <Sun size={16} /> };
  return { label: t("Sistema"), icon: <Monitor size={16} /> };
}

function nextThemePreference(value: ThemePreference): ThemePreference {
  if (value === "system") return "light";
  if (value === "light") return "dark";
  return "system";
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
  const { t } = useI18n();
  const options: Array<{ value: boolean; label: string; icon: ReactNode }> = [
    { value: true, label: t("Ativo"), icon: <ShieldCheck size={15} /> },
    { value: false, label: t("Desligado"), icon: <ShieldOff size={15} /> }
  ];

  return (
    <div className="settings-control" aria-label={t("Modo seguro")}>
      <span>{t("Modo seguro")}</span>
      <div className="settings-segmented two" role="group" aria-label={t("Escolher modo seguro")}>
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

function WorkDefaultsControl({
  settings,
  busy,
  onPickFolder,
  onSave
}: {
  settings: AppSettings;
  busy: boolean;
  onPickFolder: () => Promise<string | null>;
  onSave: (defaults: Pick<AppSettings, "branchPrefix" | "worktreeDirectory">) => void;
}) {
  const { t } = useI18n();
  const [branchPrefix, setBranchPrefix] = useState(settings.branchPrefix ?? "");
  const [worktreeDirectory, setWorktreeDirectory] = useState(settings.worktreeDirectory ?? "");

  useEffect(() => {
    setBranchPrefix(settings.branchPrefix ?? "");
    setWorktreeDirectory(settings.worktreeDirectory ?? "");
  }, [settings.branchPrefix, settings.worktreeDirectory]);

  const dirty =
    branchPrefix.trim() !== (settings.branchPrefix ?? "") ||
    worktreeDirectory.trim() !== (settings.worktreeDirectory ?? "");

  async function chooseFolder() {
    const folder = await onPickFolder();
    if (folder) setWorktreeDirectory(folder);
  }

  return (
    <form
      className="settings-defaults-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          branchPrefix: branchPrefix.trim(),
          worktreeDirectory: worktreeDirectory.trim()
        });
      }}
    >
      <span className="settings-label">{t("Defaults de trabalho")}</span>
      <label>
        {t("Prefixo de branch")}
        <input
          aria-label={t("Prefixo de branch")}
          value={branchPrefix}
          onChange={(event) => setBranchPrefix(event.target.value)}
          placeholder="feature/"
        />
      </label>
      <label>
        {t("Local default das worktrees")}
        <div className="settings-path-row">
          <input
            aria-label={t("Local default das worktrees")}
            value={worktreeDirectory}
            onChange={(event) => setWorktreeDirectory(event.target.value)}
            placeholder={t("Usar pasta irmã do repositório")}
          />
          <button
            className="secondary-button compact-button"
            type="button"
            disabled={busy}
            aria-label={t("Escolher local default das worktrees")}
            onClick={() => void chooseFolder()}
          >
            {busy ? <Loader2 className="spin" size={15} /> : <Folder size={15} />}
            {t("Escolher pasta")}
          </button>
          <button
            className="ghost-button compact-button"
            type="button"
            disabled={busy || !worktreeDirectory}
            onClick={() => setWorktreeDirectory("")}
          >
            {t("Limpar")}
          </button>
        </div>
      </label>
      <div className="settings-defaults-actions">
        <button className="primary-button compact-button" type="submit" disabled={busy || !dirty}>
          {busy ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />}
          {t("Guardar defaults")}
        </button>
      </div>
    </form>
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
  const { locale, t } = useI18n();
  const stats = diagnostics?.operationStats;
  const latestFailure = diagnostics?.recentFailures[0] ?? null;

  return (
    <section className="diagnostics-panel" aria-label={t("Observabilidade")}>
      <div className="diagnostics-header">
        <div>
          <span className="settings-label">{t("Observabilidade")}</span>
          <h3>{t("Diagnóstico local")}</h3>
        </div>
        <div className="diagnostics-actions">
          <button className="secondary-button" disabled={busy} type="button" onClick={onRefresh}>
            {busy ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            {t("Atualizar")}
          </button>
          <button className="primary-button" disabled={busy || !diagnostics} type="button" onClick={onCopy}>
            <Copy size={16} />
            {copied ? t("Copiado") : t("Copiar JSON")}
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
              <span>{t("Repositórios")}</span>
              <strong>{diagnostics.repositoryCount}</strong>
              <small>v{diagnostics.appVersion}</small>
            </div>
            <div className="diagnostic-card">
              <span>{t("Operações")}</span>
              <strong>{diagnostics.operationCount}</strong>
              <small>{stats ? `${stats.success} ok / ${stats.error} ${t("falhas")}` : "-"}</small>
            </div>
            <div className="diagnostic-card">
              <span>P95</span>
              <strong>{formatDuration(stats?.p95DurationMs)}</strong>
              <small>{t("média")} {formatDuration(stats?.averageDurationMs)}</small>
            </div>
            <div className="diagnostic-card">
              <span>Timeouts</span>
              <strong>{stats?.timedOut ?? 0}</strong>
              <small>{t("pior")} {formatDuration(stats?.slowestDurationMs)}</small>
            </div>
            <div className="diagnostic-card">
              <span>{t("Última falha")}</span>
              <strong>{relativeDate(stats?.lastFailureAt, locale)}</strong>
              <small>{latestFailure?.summary || t("Sem falhas recentes")}</small>
            </div>
          </div>

          <div className="diagnostics-detail">
            <div>
              <span className="settings-label">State file</span>
              <code>{diagnostics.statePath ?? "-"}</code>
            </div>
            <div>
              <span className="settings-label">{t("Gerado")}</span>
              <strong>{relativeDate(diagnostics.generatedAt, locale)}</strong>
            </div>
          </div>

          {diagnostics.recentFailures.length ? (
            <div className="diagnostics-failures">
              {diagnostics.recentFailures.map((operation) => (
                <div key={operation.id} className="diagnostic-failure">
                  <AlertTriangle size={15} />
                  <span>{operation.summary || formatCommand(operation)}</span>
                  <small>{relativeDate(operation.finishedAt, locale)}</small>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="empty-inline">{t("Sem diagnóstico disponível.")}</div>
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
  const { t } = useI18n();
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
  const { t } = useI18n();

  return (
    <section className="integration-group">
      <div className="integration-group-header">
        <div className="workflow-icon">{icon}</div>
        <div>
          <span className="settings-label">{t("Integração")}</span>
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
              {option.id === selectedId ? <span className="badge green">{t("Selecionado")}</span> : null}
            </button>
          ))
        ) : (
          <div className="empty-inline">{t("A carregar integrações.")}</div>
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
  const { locale } = useI18n();

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
          <span className="badge green">{locale === "en" ? "Local-only" : "Apenas local"}</span>
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
              <strong>{settings.safeMode ? (locale === "en" ? "Safe" : "Seguro") : "Manual"}</strong>
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
  const { t } = useI18n();
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
            aria-label={t("Pesquisar comandos")}
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
            value={query}
            placeholder={t("Pesquisar comandos, repositórios, worktrees ou branches")}
            onChange={(event) => setQuery(event.target.value)}
          />
          {busy ? <Loader2 className="spin" size={16} /> : null}
          <button className="icon-button compact" type="button" aria-label={t("Fechar comandos")} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <h2 id={titleId} className="sr-only">
          {t("Paleta de comandos")}
        </h2>

        <div id={listboxId} className="command-results" role="listbox" aria-label={t("Comandos")}>
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
            <div className="command-empty">{t("Nenhum comando encontrado.")}</div>
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
  const { t } = useI18n();
  const [browser, setBrowser] = useState<FsListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    void loadPath();
  }, []);

  async function loadPath(path?: string): Promise<FsListResponse | null> {
    setLoading(true);
    setLocalError(null);
    try {
      const next = await api.listFs(path);
      setBrowser(next);
      return next;
    } catch (caught) {
      setLocalError(errorMessage(caught));
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function chooseFolder() {
    setPickingFolder(true);
    setLocalError(null);
    try {
      const selected = await api.pickFolder();
      if (!selected) return;

      const next = await loadPath(selected.path);
      if (!next) return;
      if (next.isGitRepo) {
        await onSelect(next.path);
        return;
      }

      setLocalError(t("A pasta escolhida não é um repositório Git. Escolhe uma pasta com .git ou abre uma subpasta listada."));
    } catch (caught) {
      setLocalError(errorMessage(caught));
    } finally {
      setPickingFolder(false);
    }
  }

  return (
    <Modal title={t("Selecionar Repositório")} onClose={onClose}>
      <div className="picker-grid">
        <div className="picker-main">
          <div className="folder-picker-panel">
            <div>
              <span className="settings-label">{t("Pasta selecionada")}</span>
              <code title={browser?.path}>{browser?.path ?? "-"}</code>
            </div>
            <button className="primary-button" type="button" disabled={busy || pickingFolder} onClick={() => void chooseFolder()}>
              {pickingFolder ? <Loader2 className="spin" size={16} /> : <Folder size={16} />}
              {browser ? t("Escolher outra pasta") : t("Escolher pasta")}
            </button>
          </div>

          {localError ? <div className="inline-error">{localError}</div> : null}

          {browser?.isGitRepo ? (
            <div className="current-folder">
              <FolderGit2 size={18} />
              <span title={browser.path}>{browser.path}</span>
              <button className="primary-button compact-button" disabled={busy} onClick={() => void onSelect(browser.path)}>
                {t("Selecionar pasta atual")}
              </button>
            </div>
          ) : null}

          <div className="folder-list">
            {loading ? (
              <div className="loading-row">
                <Loader2 className="spin" size={18} />
                {t("A carregar")}
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
          <h3>{t("Recentes")}</h3>
          {repos.length ? (
            repos.map((repo) => (
              <button key={repo.id} onClick={() => void onSelect(repo.path)}>
                <FolderGit2 size={16} />
                <span>{repo.name}</span>
              </button>
            ))
          ) : (
            <p>{t("Nenhum repositório recente.")}</p>
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
  const { t } = useI18n();

  return (
    <div className="folder-row">
      <button onClick={onOpen}>
        {entry.isGitRepo ? <FolderGit2 size={18} /> : <Folder size={18} />}
        <span>{entry.name}</span>
      </button>
      {onSelect ? (
        <button className="primary-button compact-button" disabled={busy} onClick={onSelect}>
          {t("Selecionar")}
        </button>
      ) : null}
    </div>
  );
}

function CreateWorktreeDialog({
  branches,
  branchPrefix,
  defaultWorktreeDirectory,
  busy,
  onClose,
  onCreate
}: {
  branches: BranchRecord[];
  branchPrefix: string;
  defaultWorktreeDirectory: string;
  busy: boolean;
  onClose: () => void;
  onCreate: (body: { branch: string; newBranch: boolean; name?: string; path?: string; from?: string }) => void;
}) {
  const { t } = useI18n();
  const baseBranchOptions = useMemo(
    () => branches.filter((item) => !item.name.endsWith("/HEAD")),
    [branches]
  );
  const preferredBaseBranch =
    baseBranchOptions.find((item) => item.current)?.name ??
    baseBranchOptions.find((item) => !item.isRemote && isBaseBranch(item.name))?.name ??
    baseBranchOptions.find((item) => !item.isRemote)?.name ??
    baseBranchOptions[0]?.name ??
    "";
  const [branch, setBranch] = useState("");
  const [baseBranch, setBaseBranch] = useState(preferredBaseBranch);
  const [name, setName] = useState("");
  const [targetPath, setTargetPath] = useState("");
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const branchListId = useId();
  const cleanBranchPrefix = branchPrefix.trim();

  useEffect(() => {
    if (!baseBranch && preferredBaseBranch) {
      setBaseBranch(preferredBaseBranch);
    }
  }, [baseBranch, preferredBaseBranch]);

  function changeMode(nextMode: "existing" | "new") {
    setMode(nextMode);
    if (nextMode === "new" && !branch.trim() && cleanBranchPrefix) {
      setBranch(cleanBranchPrefix);
    }
    if (nextMode === "new" && !baseBranch && preferredBaseBranch) {
      setBaseBranch(preferredBaseBranch);
    }
    if (nextMode === "existing" && branch === cleanBranchPrefix) {
      setBranch("");
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const body: { branch: string; newBranch: boolean; name?: string; path?: string; from?: string } = {
      branch,
      newBranch: mode === "new",
      name: name || undefined,
      path: targetPath || undefined
    };
    if (mode === "new" && baseBranch) {
      body.from = baseBranch;
    }
    onCreate(body);
  }

  return (
    <Modal title={t("Nova Worktree")} onClose={onClose}>
      <form className="dialog-form" onSubmit={submit}>
        <fieldset className="choice-field">
          <legend>{t("Tipo")}</legend>
          <div className="choice-grid">
            <button
              type="button"
              aria-pressed={mode === "existing"}
              className={mode === "existing" ? "active" : ""}
              onClick={() => changeMode("existing")}
            >
              <GitBranch size={16} />
              {t("Branch existente")}
            </button>
            <button
              type="button"
              aria-pressed={mode === "new"}
              className={mode === "new" ? "active" : ""}
              onClick={() => changeMode("new")}
            >
              <Plus size={16} />
              {t("Nova branch")}
            </button>
          </div>
        </fieldset>
        <label>
          {mode === "new" ? t("Nova branch") : t("Branch existente")}
          <input
            list={mode === "existing" ? branchListId : undefined}
            required
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            placeholder={mode === "new" ? prefixedPlaceholder(cleanBranchPrefix, "nova-area") : "feature/auth"}
          />
        </label>
        <datalist id={branchListId}>
          {branches.map((item) => (
            <option key={item.name} value={item.name} />
          ))}
        </datalist>
        {mode === "new" ? (
          <label>
            {t("Branch base")}
            <select value={baseBranch} onChange={(event) => setBaseBranch(event.target.value)}>
              {!preferredBaseBranch ? <option value="">{t("HEAD atual")}</option> : null}
              {baseBranchOptions.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          {t("Nome da pasta")}
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("opcional")} />
        </label>
        <label>
          {t("Local completo")}
          <input
            value={targetPath}
            onChange={(event) => setTargetPath(event.target.value)}
            placeholder={defaultWorktreeDirectory || "/Users/joseteixeira/Projects/repo-feature"}
          />
        </label>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            {t("Cancelar")}
          </button>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
            {t("Criar")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CreateBranchDialog({
  branches,
  branchPrefix,
  busy,
  onClose,
  onCreate
}: {
  branches: BranchRecord[];
  branchPrefix: string;
  busy: boolean;
  onClose: () => void;
  onCreate: (body: { name: string; from?: string }) => void;
}) {
  const { t } = useI18n();
  const cleanBranchPrefix = branchPrefix.trim();
  const [name, setName] = useState(cleanBranchPrefix);
  const [from, setFrom] = useState("");

  return (
    <Modal title={t("Nova Branch")} onClose={onClose}>
      <form
        className="dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate({ name, from: from || undefined });
        }}
      >
        <label>
          {t("Nome")}
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={prefixedPlaceholder(cleanBranchPrefix, "dashboard")}
          />
        </label>
        <label>
          {t("A partir de")}
          <select value={from} onChange={(event) => setFrom(event.target.value)}>
            <option value="">{t("HEAD atual")}</option>
            {branches.map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            {t("Cancelar")}
          </button>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
            {t("Criar")}
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
  const { t } = useI18n();

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
            <h3>{t("Passos previstos")}</h3>
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
            {t("Cancelar")}
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
  const { t } = useI18n();
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
          {t("Escreve")} {expected}
          <input required value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            {t("Cancelar")}
          </button>
          <button className="danger-button" type="submit" disabled={busy || value !== expected}>
            {busy ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
            {t("Apagar")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({
  title,
  size = "default",
  onClose,
  children
}: {
  title: string;
  size?: "default" | "wide";
  onClose: () => void;
  children: ReactNode;
}) {
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
      <div
        ref={modalRef}
        className={size === "wide" ? "modal modal-wide" : "modal"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
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

function relativeDate(value?: string | null, locale: Locale = "pt") {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const diff = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  const week = day * 7;

  if (diff < minute) return locale === "en" ? "now" : "agora";
  if (diff < hour) {
    const count = Math.max(1, Math.floor(diff / minute));
    return locale === "en" ? `${count} min ago` : `há ${count} min`;
  }
  if (diff < day) {
    const count = Math.floor(diff / hour);
    return locale === "en" ? `${count} ${count === 1 ? "hour" : "hours"} ago` : `há ${count} horas`;
  }
  if (diff < week) {
    const count = Math.floor(diff / day);
    return locale === "en" ? `${count} ${count === 1 ? "day" : "days"} ago` : `há ${count} dias`;
  }
  const count = Math.floor(diff / week);
  return locale === "en" ? `${count} ${count === 1 ? "week" : "weeks"} ago` : `há ${count} semanas`;
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

function openTargetActionLabel(target: OpenTarget, locale: Locale = "pt") {
  if (target === "editor") return translate(locale, "Abrir no editor");
  if (target === "terminal") return translate(locale, "Abrir no terminal");
  return translate(locale, "Abrir pasta");
}

async function writeClipboard(value: string, locale: Locale = "pt") {
  if (!navigator.clipboard?.writeText) {
    throw new Error(translate(locale, "Área de transferência indisponível."));
  }

  await navigator.clipboard.writeText(value);
}

function basename(value: string) {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value;
}

function joinFsPath(root: string, relativePath: string) {
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${relativePath.replace(/^[\\/]+/, "")}`;
}

function prefixedPlaceholder(prefix: string, suffix: string) {
  const cleanPrefix = prefix.trim();
  if (!cleanPrefix) return `feature/${suffix}`;
  if (cleanPrefix.endsWith("/") || cleanPrefix.endsWith("-") || cleanPrefix.endsWith("_")) {
    return `${cleanPrefix}${suffix}`;
  }
  return `${cleanPrefix}/${suffix}`;
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

function readInitialDialog(): DialogState {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash === "settings") return { kind: "settings" };
  if (hash === "integrations") return { kind: "settings", section: "integrations" };
  return null;
}

function isAppPage(value: unknown): value is AppPage {
  return (
    value === "dashboard" ||
    value === "detail" ||
    value === "workflows" ||
    value === "worktrees" ||
    value === "branches" ||
    value === "operations" ||
    value === "privacy" ||
    value === "help"
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

function syncWorkflowStatus(summary: RepoSummary | null, locale: Locale = "pt"): { status: WorkflowStatusTone; label: string } {
  if (!summary) return { status: "blocked", label: translate(locale, "Sem dados") };
  const ahead = summary.ahead ?? 0;
  const behind = summary.behind ?? 0;
  if (ahead && behind) return { status: "attention", label: `${translate(locale, "Divergente")}: A${ahead} / B${behind}` };
  if (behind) return { status: "attention", label: `Behind ${behind}` };
  if (ahead) return { status: "attention", label: `Ahead ${ahead}` };
  return { status: "ready", label: translate(locale, "Sincronizado") };
}

async function copyPath(path: string, setError: (value: string | null) => void, locale: Locale = "pt") {
  try {
    await navigator.clipboard.writeText(path);
  } catch {
    setError(translate(locale, "Não foi possível copiar o caminho."));
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
