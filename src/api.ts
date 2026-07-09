import type {
  BranchRecord,
  DiagnosticEventInput,
  DiagnosticsSnapshot,
  FsListResponse,
  IntegrationCatalog,
  RepoDetail,
  LocalBranchWorktreeResult,
  OpenTarget,
  AppSettings,
  OperationRecord,
  PickFolderResponse,
  RepoRecord,
  ReviewDiffResponse,
  RepoSummary,
  WorktreeHandoffResult,
  WorktreeRecord
} from "./types";
import { isTauriRuntime, tauriApi } from "./tauriApi";
import { visualApi } from "./visualApi";

const API_BASE_URL = readApiBaseUrl();
const DESKTOP_REQUIRES_TAURI = import.meta.env.VITE_DESKTOP_REQUIRE_TAURI === "true";
const DESKTOP_RUNTIME_ERROR =
  "Este build desktop foi gerado para correr dentro do Tauri. A API HTTP local está desativada em produção.";

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = payload.detail
      ? `${payload.error}: ${payload.detail}`
      : payload.error || "Pedido falhou.";
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

const httpApi = {
  listFs(path?: string) {
    const query = path ? `?path=${encodeURIComponent(path)}` : "";
    return request<FsListResponse>(`/api/fs${query}`);
  },
  pickFolder() {
    return request<PickFolderResponse | null>("/api/fs/pick-folder", {
      method: "POST"
    });
  },
  listRepos() {
    return request<RepoRecord[]>("/api/repos");
  },
  addRepo(path: string) {
    return request<RepoRecord>("/api/repos", {
      method: "POST",
      body: JSON.stringify({ path })
    });
  },
  getSettings() {
    return request<AppSettings>("/api/settings");
  },
  updateSettings(settings: Partial<AppSettings>) {
    return request<AppSettings>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(settings)
    });
  },
  integrations() {
    return request<IntegrationCatalog>("/api/integrations");
  },
  diagnostics() {
    return request<DiagnosticsSnapshot>("/api/diagnostics");
  },
  recordDiagnosticEvent(event: DiagnosticEventInput) {
    return request<OperationRecord>("/api/diagnostics/events", {
      method: "POST",
      body: JSON.stringify(event)
    });
  },
  summary(repoId: string, worktreePath?: string) {
    return request<RepoSummary>(withWorktreeQuery(`/api/repos/${repoId}/summary`, worktreePath));
  },
  worktrees(repoId: string, worktreePath?: string) {
    return request<WorktreeRecord[]>(withWorktreeQuery(`/api/repos/${repoId}/worktrees`, worktreePath));
  },
  detail(repoId: string, worktreePath?: string) {
    return request<RepoDetail>(withWorktreeQuery(`/api/repos/${repoId}/detail`, worktreePath));
  },
  review(repoId: string, worktreePath?: string) {
    return request<ReviewDiffResponse>(withWorktreeQuery(`/api/repos/${repoId}/review`, worktreePath));
  },
  createWorktree(repoId: string, body: { branch: string; newBranch: boolean; name?: string; path?: string; from?: string }) {
    return request<{ path: string }>(`/api/repos/${repoId}/worktrees`, {
      method: "POST",
      body: JSON.stringify(body)
    });
  },
  removeWorktree(repoId: string, worktreeId: string, confirm: string) {
    return request<void>(`/api/repos/${repoId}/worktrees/${encodeURIComponent(worktreeId)}`, {
      method: "DELETE",
      body: JSON.stringify({ confirm })
    });
  },
  handoffWorktreeToLocal(repoId: string, worktreeId: string) {
    return request<WorktreeHandoffResult>(
      `/api/repos/${repoId}/worktrees/${encodeURIComponent(worktreeId)}/handoff-local`,
      {
        method: "POST"
      }
    );
  },
  moveLocalBranchToWorktree(repoId: string, body: { name?: string; path?: string } = {}) {
    return request<LocalBranchWorktreeResult>(`/api/repos/${repoId}/worktrees/move-local`, {
      method: "POST",
      body: JSON.stringify(body)
    });
  },
  branches(repoId: string, worktreePath?: string) {
    return request<BranchRecord[]>(withWorktreeQuery(`/api/repos/${repoId}/branches`, worktreePath));
  },
  createBranch(repoId: string, body: { name: string; from?: string; worktreePath?: string }) {
    return request<{ name: string }>(`/api/repos/${repoId}/branches`, {
      method: "POST",
      body: JSON.stringify(body)
    });
  },
  checkoutBranch(repoId: string, branchName: string, worktreePath?: string) {
    return request<{ branch: string }>(
      `/api/repos/${repoId}/branches/${encodeURIComponent(branchName)}/checkout`,
      {
        method: "POST",
        body: JSON.stringify({ worktreePath })
      }
    );
  },
  deleteBranch(repoId: string, branchName: string, confirm: string, force = false, worktreePath?: string) {
    return request<void>(`/api/repos/${repoId}/branches/${encodeURIComponent(branchName)}`, {
      method: "DELETE",
      body: JSON.stringify({ confirm, force, worktreePath })
    });
  },
  fetchRepo(repoId: string, worktreePath?: string) {
    return request<{ ok: boolean }>(`/api/repos/${repoId}/fetch`, {
      method: "POST",
      body: JSON.stringify({ worktreePath })
    });
  },
  pullRepo(repoId: string, worktreePath?: string) {
    return request<{ ok: boolean }>(`/api/repos/${repoId}/pull`, {
      method: "POST",
      body: JSON.stringify({ worktreePath })
    });
  },
  openPath(path: string, target: OpenTarget = "folder") {
    return request<{ ok: boolean }>("/api/open", {
      method: "POST",
      body: JSON.stringify({ path, target })
    });
  },
  operations() {
    return request<OperationRecord[]>("/api/operations");
  },
  operation(operationId: string) {
    return request<OperationRecord>(`/api/operations/${encodeURIComponent(operationId)}`);
  }
};

const unavailableDesktopApi = new Proxy(
  {},
  {
    get() {
      return () => Promise.reject(new Error(DESKTOP_RUNTIME_ERROR));
    }
  }
) as typeof httpApi;

export const api = isVisualMode()
  ? visualApi
  : isTauriRuntime()
    ? tauriApi
    : DESKTOP_REQUIRES_TAURI
      ? unavailableDesktopApi
      : httpApi;

function withWorktreeQuery(url: string, worktreePath?: string) {
  if (!worktreePath) return url;
  return `${url}?worktreePath=${encodeURIComponent(worktreePath)}`;
}

function isVisualMode() {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).has("visual");
}

function readApiBaseUrl() {
  const configuredUrl = import.meta.env.VITE_API_BASE_URL;
  return typeof configuredUrl === "string" ? configuredUrl.replace(/\/+$/, "") : "";
}
