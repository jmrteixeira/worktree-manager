import { invoke } from "@tauri-apps/api/core";
import type {
  BranchRecord,
  DiagnosticEventInput,
  DiagnosticsSnapshot,
  FsListResponse,
  IntegrationCatalog,
  LocalBranchWorktreeResult,
  OpenTarget,
  AppSettings,
  OperationRecord,
  PickFolderResponse,
  RepoDetail,
  RepoRecord,
  RepoSummary,
  WorktreeHandoffResult,
  WorktreeRecord
} from "./types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const tauriApi = {
  listFs(path?: string) {
    return invoke<FsListResponse>("list_fs", { path });
  },
  pickFolder() {
    return invoke<PickFolderResponse | null>("pick_folder");
  },
  listRepos() {
    return invoke<RepoRecord[]>("list_repos");
  },
  addRepo(path: string) {
    return invoke<RepoRecord>("add_repo", { path });
  },
  getSettings() {
    return invoke<AppSettings>("get_settings");
  },
  updateSettings(settings: Partial<AppSettings>) {
    return invoke<AppSettings>("update_settings", { settings });
  },
  integrations() {
    return invoke<IntegrationCatalog>("integrations");
  },
  diagnostics() {
    return invoke<DiagnosticsSnapshot>("diagnostics");
  },
  recordDiagnosticEvent(event: DiagnosticEventInput) {
    return invoke<OperationRecord>("record_diagnostic_event", { event });
  },
  summary(repoId: string, worktreePath?: string) {
    return invoke<RepoSummary>("repo_summary", { repoId, worktreePath });
  },
  worktrees(repoId: string, worktreePath?: string) {
    return invoke<WorktreeRecord[]>("repo_worktrees", { repoId, worktreePath });
  },
  detail(repoId: string, worktreePath?: string) {
    return invoke<RepoDetail>("repo_detail", { repoId, worktreePath });
  },
  createWorktree(repoId: string, body: { branch: string; newBranch: boolean; name?: string; path?: string }) {
    return invoke<{ path: string }>("create_worktree", { repoId, body });
  },
  removeWorktree(repoId: string, worktreeId: string, confirm: string) {
    return invoke<void>("remove_worktree", { repoId, worktreeId, confirm });
  },
  handoffWorktreeToLocal(repoId: string, worktreeId: string) {
    return invoke<WorktreeHandoffResult>("handoff_worktree_to_local", { repoId, worktreeId });
  },
  moveLocalBranchToWorktree(repoId: string, body: { name?: string; path?: string } = {}) {
    return invoke<LocalBranchWorktreeResult>("move_local_branch_to_worktree", { repoId, body });
  },
  branches(repoId: string, worktreePath?: string) {
    return invoke<BranchRecord[]>("repo_branches", { repoId, worktreePath });
  },
  createBranch(repoId: string, body: { name: string; from?: string; worktreePath?: string }) {
    return invoke<{ name: string }>("create_branch", { repoId, body });
  },
  checkoutBranch(repoId: string, branchName: string, worktreePath?: string) {
    return invoke<{ branch: string }>("checkout_branch", {
      repoId,
      branchName,
      body: { worktreePath }
    });
  },
  deleteBranch(repoId: string, branchName: string, confirm: string, force = false, worktreePath?: string) {
    return invoke<void>("delete_branch", {
      repoId,
      branchName,
      body: { confirm, force, worktreePath }
    });
  },
  fetchRepo(repoId: string, worktreePath?: string) {
    return invoke<{ ok: boolean }>("fetch_repo", { repoId, worktreePath });
  },
  pullRepo(repoId: string, worktreePath?: string) {
    return invoke<{ ok: boolean }>("pull_repo", { repoId, worktreePath });
  },
  openPath(path: string, target: OpenTarget = "folder") {
    return invoke<{ ok: boolean; target: OpenTarget }>("open_path", { path, target });
  },
  operations() {
    return invoke<OperationRecord[]>("operations");
  },
  operation(operationId: string) {
    return invoke<OperationRecord>("operation", { operationId });
  }
};
