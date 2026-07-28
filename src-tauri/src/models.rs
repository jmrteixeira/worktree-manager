use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoRecord {
    pub id: String,
    pub name: String,
    pub path: String,
    pub last_opened_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub is_git_repo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsListResponse {
    pub path: String,
    pub parent: Option<String>,
    pub is_git_repo: bool,
    pub entries: Vec<FsEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub sha: String,
    pub subject: String,
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeRecord {
    pub id: String,
    pub path: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub is_current: bool,
    pub detached: bool,
    pub bare: bool,
    pub last_commit: Option<CommitInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<GitStatusSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ahead: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub behind: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedWorktreeRecord {
    pub repo_id: String,
    pub worktree_id: String,
    pub path: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    pub archived_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    pub original_path: Option<String>,
    pub index_status: String,
    pub worktree_status: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusSummary {
    pub staged: usize,
    pub unstaged: usize,
    pub untracked: usize,
    pub conflicted: usize,
    pub total: usize,
    pub clean: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoDetail {
    pub repo: RepoRecord,
    pub worktree: WorktreeRecord,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: i64,
    pub behind: i64,
    pub last_fetch_at: Option<String>,
    pub stash_count: usize,
    pub status: GitStatusSummary,
    pub files: Vec<GitFileStatus>,
    pub worktrees: Vec<WorktreeRecord>,
    pub last_updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDiffLine {
    pub r#type: String,
    pub old_line_number: Option<usize>,
    pub new_line_number: Option<usize>,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDiffHunk {
    pub header: String,
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub lines: Vec<ReviewDiffLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDiffFile {
    pub id: String,
    pub path: String,
    pub original_path: Option<String>,
    pub mode: String,
    pub status_label: String,
    pub binary: bool,
    pub too_large: bool,
    pub truncated: bool,
    pub additions: usize,
    pub deletions: usize,
    pub hunks: Vec<ReviewDiffHunk>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewDiffResponse {
    pub repo: RepoRecord,
    pub worktree: WorktreeRecord,
    pub branch: Option<String>,
    pub status: GitStatusSummary,
    pub files: Vec<ReviewDiffFile>,
    pub generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeHandoffResult {
    pub branch: String,
    pub local_path: String,
    pub detached_worktree_path: String,
    pub moved_changes: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalBranchWorktreeResult {
    pub branch: String,
    pub base_branch: String,
    pub local_path: String,
    pub worktree_path: String,
    pub moved_changes: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchRecord {
    pub name: String,
    pub current: bool,
    pub upstream: Option<String>,
    pub is_remote: bool,
    pub head: Option<String>,
    pub last_commit: Option<CommitInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ahead: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub behind: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSummary {
    pub repo: RepoRecord,
    pub valid: bool,
    pub git_version: String,
    pub focused_worktree_path: String,
    pub current_branch: String,
    pub commit_count: usize,
    pub branch_count: usize,
    pub worktree_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dirty_worktree_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed_file_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stash_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ahead: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub behind: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_ahead_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_behind_count: Option<usize>,
    pub last_updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationRecord {
    pub id: String,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub started_at: String,
    pub finished_at: String,
    pub status: String,
    pub exit_code: Option<i32>,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdout: Option<String>,
    pub stderr: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdout_truncated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stderr_truncated: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timed_out: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signal: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationStats {
    pub success: usize,
    pub error: usize,
    pub timed_out: usize,
    pub average_duration_ms: u64,
    pub p95_duration_ms: u64,
    pub slowest_duration_ms: u64,
    pub last_failure_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsSnapshot {
    pub generated_at: String,
    pub app_version: String,
    pub runtime: String,
    pub platform: String,
    pub state_path: Option<String>,
    pub repository_count: usize,
    pub operation_count: usize,
    pub operation_stats: OperationStats,
    pub recent_failures: Vec<OperationRecord>,
    pub settings: AppSettings,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticEventInput {
    pub level: String,
    pub name: String,
    pub message: String,
    pub detail: Option<String>,
    pub context: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpenTarget {
    Folder,
    Editor,
    Terminal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EditorIntegrationId {
    Auto,
    Vscode,
    Cursor,
    Windsurf,
    Zed,
    Sublime,
}

impl Default for EditorIntegrationId {
    fn default() -> Self {
        Self::Auto
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TerminalIntegrationId {
    Auto,
    System,
    Iterm,
    Warp,
    WindowsTerminal,
    XTerminalEmulator,
    GnomeTerminal,
    Konsole,
}

impl Default for TerminalIntegrationId {
    fn default() -> Self {
        Self::Auto
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIntegrations {
    #[serde(default)]
    pub editor: EditorIntegrationId,
    #[serde(default)]
    pub terminal: TerminalIntegrationId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Locale {
    Pt,
    En,
}

impl Default for Locale {
    fn default() -> Self {
        Self::Pt
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationRecord {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub description: String,
    pub available: bool,
    pub selected: bool,
    pub command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationCatalog {
    pub editors: Vec<IntegrationRecord>,
    pub terminals: Vec<IntegrationRecord>,
    pub settings: AppIntegrations,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_safe_mode")]
    pub safe_mode: bool,
    #[serde(default)]
    pub locale: Locale,
    #[serde(default)]
    pub branch_prefix: String,
    #[serde(default)]
    pub worktree_directory: String,
    #[serde(default)]
    pub integrations: AppIntegrations,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            safe_mode: true,
            locale: Locale::Pt,
            branch_prefix: String::new(),
            worktree_directory: String::new(),
            integrations: AppIntegrations::default(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingsPatch {
    pub safe_mode: Option<bool>,
    pub locale: Option<Locale>,
    pub branch_prefix: Option<String>,
    pub worktree_directory: Option<String>,
    pub integrations: Option<AppIntegrations>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateWorktreeBody {
    pub branch: String,
    pub new_branch: bool,
    pub name: Option<String>,
    pub path: Option<String>,
    pub from: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveLocalBranchBody {
    pub name: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBranchBody {
    pub name: String,
    pub from: Option<String>,
    pub worktree_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutBranchBody {
    pub worktree_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteBranchBody {
    pub confirm: String,
    pub force: Option<bool>,
    pub worktree_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OkResponse {
    pub ok: bool,
}

fn default_safe_mode() -> bool {
    true
}
