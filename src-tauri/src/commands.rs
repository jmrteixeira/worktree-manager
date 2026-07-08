use crate::{
    git,
    models::{
        AppSettings, AppSettingsPatch, BranchRecord, CheckoutBranchBody, CreateBranchBody,
        CreateWorktreeBody, DeleteBranchBody, DiagnosticEventInput, DiagnosticsSnapshot,
        EditorIntegrationId, FsEntry, FsListResponse, IntegrationCatalog, IntegrationRecord,
        LocalBranchWorktreeResult, MoveLocalBranchBody, OkResponse, OpenTarget, OperationRecord,
        OperationStats, RepoDetail, RepoRecord, RepoSummary, TerminalIntegrationId,
        WorktreeHandoffResult, WorktreeRecord,
    },
    store::{absolute_path, now_iso, path_string, AppState},
};
use serde::Serialize;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::State;

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const DIAGNOSTIC_SUMMARY_LIMIT: usize = 240;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathResponse {
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NameResponse {
    name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchResponse {
    branch: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResponse {
    ok: bool,
    target: OpenTarget,
}

#[tauri::command]
pub fn list_fs(path: Option<String>) -> Result<FsListResponse, String> {
    let requested_path = path
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(home_dir);
    let directory_path = absolute_path(&requested_path);
    if !directory_path.is_dir() {
        return Err("O caminho nao e uma pasta.".to_string());
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(&directory_path).map_err(|error| error.to_string())? {
        let Ok(entry) = entry else {
            continue;
        };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }

        let entry_path = entry.path();
        entries.push(FsEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: path_string(&entry_path),
            is_directory: true,
            is_git_repo: entry_path.join(".git").exists(),
        });
    }

    entries.sort_by(|a, b| {
        if a.is_git_repo != b.is_git_repo {
            return b.is_git_repo.cmp(&a.is_git_repo);
        }
        a.name.cmp(&b.name)
    });

    Ok(FsListResponse {
        parent: directory_path
            .parent()
            .filter(|parent| *parent != directory_path)
            .map(path_string),
        is_git_repo: directory_path.join(".git").exists(),
        path: path_string(&directory_path),
        entries,
    })
}

#[tauri::command]
pub fn list_repos(state: State<'_, AppState>) -> Vec<RepoRecord> {
    state.inner().list_repos()
}

#[tauri::command]
pub fn add_repo(path: String, state: State<'_, AppState>) -> Result<RepoRecord, String> {
    let app_state = state.inner();
    let top_level_path = git::validate_repository(&path, Some(app_state))?;
    app_state.upsert_repo(&top_level_path)
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppSettings {
    state.inner().get_settings()
}

#[tauri::command]
pub fn update_settings(
    settings: AppSettingsPatch,
    state: State<'_, AppState>,
) -> Result<AppSettings, String> {
    state.inner().update_settings(settings)
}

#[tauri::command]
pub fn integrations(state: State<'_, AppState>) -> IntegrationCatalog {
    integration_catalog(&state.inner().get_settings())
}

#[tauri::command]
pub fn diagnostics(state: State<'_, AppState>) -> DiagnosticsSnapshot {
    diagnostics_snapshot(state.inner())
}

#[tauri::command]
pub fn record_diagnostic_event(
    event: DiagnosticEventInput,
    state: State<'_, AppState>,
) -> Result<OperationRecord, String> {
    let event = normalize_diagnostic_event(event)?;
    let is_error = event.level == "error";
    let context = event
        .context
        .as_ref()
        .and_then(|value| serde_json::to_string_pretty(value).ok());

    Ok(state.inner().record_operation(OperationRecord {
        id: String::new(),
        command: "app".to_string(),
        args: vec![
            "diagnostic".to_string(),
            event.level.clone(),
            event.name.clone(),
        ],
        cwd: "worktree-manager".to_string(),
        started_at: now_iso(),
        finished_at: String::new(),
        status: if is_error { "error" } else { "success" }.to_string(),
        exit_code: Some(if is_error { 1 } else { 0 }),
        summary: truncate_chars(&event.message, DIAGNOSTIC_SUMMARY_LIMIT),
        stdout: context,
        stderr: if is_error {
            event.detail.unwrap_or(event.message)
        } else {
            event.detail.unwrap_or_default()
        },
        stdout_truncated: Some(false),
        stderr_truncated: Some(false),
        duration_ms: Some(0),
        timeout_ms: Some(0),
        timed_out: Some(false),
        signal: None,
    }))
}

#[tauri::command]
pub fn repo_summary(
    repo_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<RepoSummary, String> {
    let app_state = state.inner();
    let repo = repo_or_error(app_state, &repo_id)?;
    let focused_path = git::resolve_repo_worktree_path(
        Path::new(&repo.path),
        worktree_path.as_deref(),
        Some(app_state),
    )?;
    git::get_repo_summary(&repo, &focused_path, Some(app_state))
}

#[tauri::command]
pub fn repo_worktrees(
    repo_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<WorktreeRecord>, String> {
    let app_state = state.inner();
    let repo = repo_or_error(app_state, &repo_id)?;
    let focused_path = git::resolve_repo_worktree_path(
        Path::new(&repo.path),
        worktree_path.as_deref(),
        Some(app_state),
    )?;
    git::get_worktrees(Path::new(&repo.path), &focused_path, Some(app_state))
}

#[tauri::command]
pub fn repo_detail(
    repo_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<RepoDetail, String> {
    let app_state = state.inner();
    let repo = repo_or_error(app_state, &repo_id)?;
    let focused_path = git::resolve_repo_worktree_path(
        Path::new(&repo.path),
        worktree_path.as_deref(),
        Some(app_state),
    )?;
    git::get_repo_detail(&repo, &focused_path, Some(app_state))
}

#[tauri::command]
pub fn create_worktree(
    repo_id: String,
    body: CreateWorktreeBody,
    state: State<'_, AppState>,
) -> Result<PathResponse, String> {
    let app_state = state.inner();
    let _guard = app_state
        .git_lock
        .lock()
        .map_err(|_| "Operacao Git bloqueada.".to_string())?;
    let repo = repo_or_error(app_state, &repo_id)?;
    let path = git::create_worktree(
        &repo,
        &body.branch,
        body.new_branch,
        body.name.as_deref(),
        body.path.as_deref(),
        app_state,
    )?;
    Ok(PathResponse {
        path: path_string(&path),
    })
}

#[tauri::command]
pub fn remove_worktree(
    repo_id: String,
    worktree_id: String,
    confirm: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let app_state = state.inner();
    let _guard = app_state
        .git_lock
        .lock()
        .map_err(|_| "Operacao Git bloqueada.".to_string())?;
    let repo = repo_or_error(app_state, &repo_id)?;
    let worktree_path = git::decode_path_id(&worktree_id)?;
    let focused_path = git::resolve_repo_worktree_path(
        Path::new(&repo.path),
        Some(worktree_path.as_str()),
        Some(app_state),
    )?;
    if app_state.get_settings().safe_mode {
        git::assert_clean_worktree_for_safe_operation(
            &focused_path,
            "remover worktree",
            Some(app_state),
        )?;
    }
    git::remove_worktree(
        &repo,
        &git::encode_path_id(&path_string(&focused_path)),
        &confirm,
        app_state,
    )
}

#[tauri::command]
pub fn handoff_worktree_to_local(
    repo_id: String,
    worktree_id: String,
    state: State<'_, AppState>,
) -> Result<WorktreeHandoffResult, String> {
    let app_state = state.inner();
    let _guard = app_state
        .git_lock
        .lock()
        .map_err(|_| "Operacao Git bloqueada.".to_string())?;
    let repo = repo_or_error(app_state, &repo_id)?;
    let worktree_path = git::decode_path_id(&worktree_id)?;
    let focused_path = git::resolve_repo_worktree_path(
        Path::new(&repo.path),
        Some(worktree_path.as_str()),
        Some(app_state),
    )?;
    if app_state.get_settings().safe_mode {
        git::assert_no_conflicts_for_safe_operation(
            &focused_path,
            "handoff para local",
            Some(app_state),
        )?;
        git::assert_no_conflicts_for_safe_operation(
            Path::new(&repo.path),
            "handoff para local",
            Some(app_state),
        )?;
    }
    git::handoff_worktree_branch_to_local(Path::new(&repo.path), &focused_path, app_state)
}

#[tauri::command]
pub fn move_local_branch_to_worktree(
    repo_id: String,
    body: Option<MoveLocalBranchBody>,
    state: State<'_, AppState>,
) -> Result<LocalBranchWorktreeResult, String> {
    let app_state = state.inner();
    let _guard = app_state
        .git_lock
        .lock()
        .map_err(|_| "Operacao Git bloqueada.".to_string())?;
    let repo = repo_or_error(app_state, &repo_id)?;
    let body = body.unwrap_or(MoveLocalBranchBody {
        name: None,
        path: None,
    });
    let settings = app_state.get_settings();
    if settings.safe_mode {
        git::assert_no_conflicts_for_safe_operation(
            Path::new(&repo.path),
            "mover para worktree",
            Some(app_state),
        )?;
    }
    git::move_local_branch_to_worktree(
        &repo,
        body.name.as_deref(),
        body.path.as_deref(),
        app_state,
        settings.safe_mode,
    )
}

#[tauri::command]
pub fn repo_branches(
    repo_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<Vec<BranchRecord>, String> {
    let app_state = state.inner();
    let repo = repo_or_error(app_state, &repo_id)?;
    let focused_path = git::resolve_repo_worktree_path(
        Path::new(&repo.path),
        worktree_path.as_deref(),
        Some(app_state),
    )?;
    git::get_branches(&focused_path, Some(app_state))
}

#[tauri::command]
pub fn create_branch(
    repo_id: String,
    body: CreateBranchBody,
    state: State<'_, AppState>,
) -> Result<NameResponse, String> {
    let app_state = state.inner();
    let _guard = app_state
        .git_lock
        .lock()
        .map_err(|_| "Operacao Git bloqueada.".to_string())?;
    let repo = repo_or_error(app_state, &repo_id)?;
    let name = git::create_branch(
        &repo,
        &body.name,
        body.from.as_deref(),
        body.worktree_path.as_deref(),
        app_state,
    )?;
    Ok(NameResponse { name })
}

#[tauri::command]
pub fn checkout_branch(
    repo_id: String,
    branch_name: String,
    body: Option<CheckoutBranchBody>,
    state: State<'_, AppState>,
) -> Result<BranchResponse, String> {
    let app_state = state.inner();
    let _guard = app_state
        .git_lock
        .lock()
        .map_err(|_| "Operacao Git bloqueada.".to_string())?;
    let repo = repo_or_error(app_state, &repo_id)?;
    if app_state.get_settings().safe_mode {
        let focused_path = git::resolve_repo_worktree_path(
            Path::new(&repo.path),
            body.as_ref()
                .and_then(|value| value.worktree_path.as_deref()),
            Some(app_state),
        )?;
        git::assert_clean_worktree_for_safe_operation(
            &focused_path,
            "checkout de branch",
            Some(app_state),
        )?;
    }
    let branch = git::checkout_branch(
        &repo,
        &branch_name,
        body.and_then(|value| value.worktree_path).as_deref(),
        app_state,
    )?;
    Ok(BranchResponse { branch })
}

#[tauri::command]
pub fn delete_branch(
    repo_id: String,
    branch_name: String,
    body: DeleteBranchBody,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let app_state = state.inner();
    let _guard = app_state
        .git_lock
        .lock()
        .map_err(|_| "Operacao Git bloqueada.".to_string())?;
    let repo = repo_or_error(app_state, &repo_id)?;
    if app_state.get_settings().safe_mode {
        git::assert_safe_branch_deletion(Path::new(&repo.path), &branch_name, Some(app_state))?;
    }
    git::delete_branch(
        &repo,
        &branch_name,
        &body.confirm,
        body.force.unwrap_or(false),
        body.worktree_path.as_deref(),
        app_state,
    )
}

#[tauri::command]
pub fn fetch_repo(
    repo_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<OkResponse, String> {
    let app_state = state.inner();
    let _guard = app_state
        .git_lock
        .lock()
        .map_err(|_| "Operacao Git bloqueada.".to_string())?;
    let repo = repo_or_error(app_state, &repo_id)?;
    git::fetch_repo(&repo, worktree_path.as_deref(), app_state)?;
    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn pull_repo(
    repo_id: String,
    worktree_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<OkResponse, String> {
    let app_state = state.inner();
    let _guard = app_state
        .git_lock
        .lock()
        .map_err(|_| "Operacao Git bloqueada.".to_string())?;
    let repo = repo_or_error(app_state, &repo_id)?;
    if app_state.get_settings().safe_mode {
        let focused_path = git::resolve_repo_worktree_path(
            Path::new(&repo.path),
            worktree_path.as_deref(),
            Some(app_state),
        )?;
        git::assert_clean_worktree_for_safe_operation(&focused_path, "pull", Some(app_state))?;
    }
    git::pull_repo(&repo, worktree_path.as_deref(), app_state)?;
    Ok(OkResponse { ok: true })
}

#[tauri::command]
pub fn open_path(
    path: String,
    target: Option<OpenTarget>,
    state: State<'_, AppState>,
) -> Result<OpenResponse, String> {
    let app_state = state.inner();
    let target_path = validate_open_target(app_state, &path)?;
    let target = target.unwrap_or(OpenTarget::Folder);
    open_external_path(&target_path, &target, &app_state.get_settings())?;
    Ok(OpenResponse { ok: true, target })
}

#[tauri::command]
pub fn operations(state: State<'_, AppState>) -> Vec<OperationRecord> {
    state.inner().list_operations()
}

#[tauri::command]
pub fn operation(
    operation_id: String,
    state: State<'_, AppState>,
) -> Result<OperationRecord, String> {
    state
        .inner()
        .get_operation(&operation_id)
        .ok_or_else(|| "Operacao nao encontrada.".to_string())
}

fn integration_catalog(settings: &AppSettings) -> IntegrationCatalog {
    let editors = editor_integration_definitions()
        .into_iter()
        .map(|item| IntegrationRecord {
            available: item.id == "auto" || integration_available(&item.id, "editor"),
            selected: item.id == editor_integration_id(&settings.integrations.editor),
            command: integration_command_label(&item.id, "editor"),
            ..item
        })
        .collect();
    let terminals = terminal_integration_definitions()
        .into_iter()
        .map(|item| IntegrationRecord {
            available: item.id == "auto"
                || item.id == "system"
                || integration_available(&item.id, "terminal"),
            selected: item.id == terminal_integration_id(&settings.integrations.terminal),
            command: integration_command_label(&item.id, "terminal"),
            ..item
        })
        .collect();

    IntegrationCatalog {
        editors,
        terminals,
        settings: settings.integrations.clone(),
    }
}

fn editor_integration_definitions() -> Vec<IntegrationRecord> {
    vec![
        integration_record("auto", "editor", "Auto", "Usa o comportamento padrao da aplicacao."),
        integration_record(
            "vscode",
            "editor",
            "Visual Studio Code",
            "Abre worktrees com o comando code.",
        ),
        integration_record("cursor", "editor", "Cursor", "Abre worktrees com o comando cursor."),
        integration_record(
            "windsurf",
            "editor",
            "Windsurf",
            "Abre worktrees com o comando windsurf.",
        ),
        integration_record("zed", "editor", "Zed", "Abre worktrees com o comando zed."),
        integration_record(
            "sublime",
            "editor",
            "Sublime Text",
            "Abre worktrees com o comando subl.",
        ),
    ]
}

fn terminal_integration_definitions() -> Vec<IntegrationRecord> {
    vec![
        integration_record("auto", "terminal", "Auto", "Usa o comportamento padrao da aplicacao."),
        integration_record(
            "system",
            "terminal",
            "Terminal do sistema",
            "Usa Terminal, cmd.exe ou x-terminal-emulator.",
        ),
        integration_record("iterm", "terminal", "iTerm", "Abre worktrees no iTerm em macOS."),
        integration_record("warp", "terminal", "Warp", "Abre worktrees no Warp."),
        integration_record(
            "windows-terminal",
            "terminal",
            "Windows Terminal",
            "Abre worktrees com wt.exe.",
        ),
        integration_record(
            "x-terminal-emulator",
            "terminal",
            "x-terminal-emulator",
            "Abre worktrees no terminal padrao Linux.",
        ),
        integration_record(
            "gnome-terminal",
            "terminal",
            "GNOME Terminal",
            "Abre worktrees no GNOME Terminal.",
        ),
        integration_record("konsole", "terminal", "Konsole", "Abre worktrees no Konsole."),
    ]
}

fn integration_record(id: &str, kind: &str, label: &str, description: &str) -> IntegrationRecord {
    IntegrationRecord {
        id: id.to_string(),
        kind: kind.to_string(),
        label: label.to_string(),
        description: description.to_string(),
        available: false,
        selected: false,
        command: None,
    }
}

fn integration_available(id: &str, kind: &str) -> bool {
    if let Some(command) = integration_command_name(id, kind) {
        if command_exists(&command) {
            return true;
        }
    }

    if !cfg!(target_os = "macos") {
        return false;
    }

    mac_integration_app_name(id)
        .map(|name| Path::new("/Applications").join(format!("{name}.app")).exists())
        .unwrap_or(false)
}

fn integration_command_name(id: &str, kind: &str) -> Option<String> {
    if kind == "editor" {
        return match id {
            "vscode" => Some(if cfg!(target_os = "windows") { "code.cmd" } else { "code" }.to_string()),
            "cursor" => Some(if cfg!(target_os = "windows") { "cursor.cmd" } else { "cursor" }.to_string()),
            "windsurf" => Some(if cfg!(target_os = "windows") { "windsurf.cmd" } else { "windsurf" }.to_string()),
            "zed" => Some(if cfg!(target_os = "windows") { "zed.exe" } else { "zed" }.to_string()),
            "sublime" => Some(if cfg!(target_os = "windows") { "sublime_text.exe" } else { "subl" }.to_string()),
            _ => None,
        };
    }

    match id {
        "warp" if !cfg!(target_os = "macos") => Some("warp-terminal".to_string()),
        "windows-terminal" => Some("wt.exe".to_string()),
        "x-terminal-emulator" | "gnome-terminal" | "konsole" => Some(id.to_string()),
        _ => None,
    }
}

fn integration_command_label(id: &str, kind: &str) -> Option<String> {
    if let Some(command) = integration_command_name(id, kind) {
        return Some(command);
    }

    match id {
        "iterm" => Some("open -a iTerm".to_string()),
        "warp" if cfg!(target_os = "macos") => Some("open -a Warp".to_string()),
        _ => None,
    }
}

fn mac_integration_app_name(id: &str) -> Option<&'static str> {
    match id {
        "vscode" => Some("Visual Studio Code"),
        "cursor" => Some("Cursor"),
        "windsurf" => Some("Windsurf"),
        "zed" => Some("Zed"),
        "sublime" => Some("Sublime Text"),
        "iterm" => Some("iTerm"),
        "warp" => Some("Warp"),
        _ => None,
    }
}

fn command_exists(command: &str) -> bool {
    let Some(paths) = env::var_os("PATH") else {
        return false;
    };

    env::split_paths(&paths).any(|directory| {
        let candidate = directory.join(command);
        if candidate.is_file() {
            return true;
        }

        if !cfg!(target_os = "windows") {
            return false;
        }

        ["exe", "cmd", "bat", "com"]
            .iter()
            .any(|extension| candidate.with_extension(extension).is_file())
    })
}

fn editor_integration_id(value: &EditorIntegrationId) -> &'static str {
    match value {
        EditorIntegrationId::Auto => "auto",
        EditorIntegrationId::Vscode => "vscode",
        EditorIntegrationId::Cursor => "cursor",
        EditorIntegrationId::Windsurf => "windsurf",
        EditorIntegrationId::Zed => "zed",
        EditorIntegrationId::Sublime => "sublime",
    }
}

fn terminal_integration_id(value: &TerminalIntegrationId) -> &'static str {
    match value {
        TerminalIntegrationId::Auto => "auto",
        TerminalIntegrationId::System => "system",
        TerminalIntegrationId::Iterm => "iterm",
        TerminalIntegrationId::Warp => "warp",
        TerminalIntegrationId::WindowsTerminal => "windows-terminal",
        TerminalIntegrationId::XTerminalEmulator => "x-terminal-emulator",
        TerminalIntegrationId::GnomeTerminal => "gnome-terminal",
        TerminalIntegrationId::Konsole => "konsole",
    }
}

fn diagnostics_snapshot(state: &AppState) -> DiagnosticsSnapshot {
    let repos = state.list_repos();
    let operations = state.list_operations();
    let settings = state.get_settings();

    DiagnosticsSnapshot {
        generated_at: now_iso(),
        app_version: APP_VERSION.to_string(),
        runtime: "tauri".to_string(),
        platform: env::consts::OS.to_string(),
        state_path: Some(state.state_file_path()),
        repository_count: repos.len(),
        operation_count: operations.len(),
        operation_stats: summarize_operation_stats(&operations),
        recent_failures: operations
            .iter()
            .filter(|operation| operation.status == "error")
            .take(5)
            .cloned()
            .collect(),
        settings,
    }
}

fn summarize_operation_stats(operations: &[OperationRecord]) -> OperationStats {
    let mut durations = operations
        .iter()
        .filter_map(|operation| operation.duration_ms)
        .collect::<Vec<_>>();
    durations.sort_unstable();

    let errors = operations
        .iter()
        .filter(|operation| operation.status == "error")
        .collect::<Vec<_>>();
    let duration_total = durations.iter().sum::<u64>();

    OperationStats {
        success: operations
            .iter()
            .filter(|operation| operation.status == "success")
            .count(),
        error: errors.len(),
        timed_out: operations
            .iter()
            .filter(|operation| operation.timed_out.unwrap_or(false))
            .count(),
        average_duration_ms: if durations.is_empty() {
            0
        } else {
            duration_total / durations.len() as u64
        },
        p95_duration_ms: percentile(&durations, 95),
        slowest_duration_ms: durations.last().copied().unwrap_or(0),
        last_failure_at: errors.first().map(|operation| operation.finished_at.clone()),
    }
}

fn normalize_diagnostic_event(mut event: DiagnosticEventInput) -> Result<DiagnosticEventInput, String> {
    if event.level != "info" && event.level != "warning" && event.level != "error" {
        return Err("Nivel de diagnostico invalido.".to_string());
    }

    event.name = event.name.trim().to_string();
    event.message = event.message.trim().to_string();
    event.detail = event.detail.and_then(|detail| {
        let detail = detail.trim().to_string();
        if detail.is_empty() {
            None
        } else {
            Some(truncate_chars(&detail, 4_000))
        }
    });

    if event.name.is_empty() {
        return Err("Nome de diagnostico obrigatorio.".to_string());
    }

    if event.message.is_empty() {
        return Err("Mensagem de diagnostico obrigatoria.".to_string());
    }

    event.name = truncate_chars(&event.name, 80);
    event.message = truncate_chars(&event.message, 2_000);
    Ok(event)
}

fn percentile(values: &[u64], percentile_value: usize) -> u64 {
    if values.is_empty() {
        return 0;
    }

    let index = (((percentile_value as f64 / 100.0) * values.len() as f64).ceil() as usize)
        .saturating_sub(1)
        .min(values.len() - 1);
    values[index]
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn repo_or_error(state: &AppState, repo_id: &str) -> Result<RepoRecord, String> {
    state
        .get_repo(repo_id)
        .ok_or_else(|| "Repositorio nao encontrado.".to_string())
}

fn validate_open_target(state: &AppState, target_path: &str) -> Result<PathBuf, String> {
    let resolved_target = absolute_path(Path::new(target_path));
    let target = resolved_target
        .canonicalize()
        .map_err(|_| "O caminho indicado nao existe.".to_string())?;
    let repos = state.list_repos();

    for repo in repos {
        let mut roots = vec![PathBuf::from(&repo.path)];
        if let Ok(worktrees) =
            git::get_worktrees(Path::new(&repo.path), Path::new(&repo.path), Some(state))
        {
            roots.extend(worktrees.into_iter().filter_map(|worktree| {
                if worktree.path.is_empty() {
                    None
                } else {
                    Some(PathBuf::from(worktree.path))
                }
            }));
        }

        for root in roots {
            let comparable_root = root.canonicalize().unwrap_or_else(|_| absolute_path(&root));
            if target == comparable_root || target.starts_with(&comparable_root) {
                return Ok(target);
            }
        }
    }

    Err("So e possivel abrir caminhos dentro de repositorios ou worktrees conhecidos.".to_string())
}

fn open_external_path(
    target_path: &Path,
    target: &OpenTarget,
    settings: &AppSettings,
) -> Result<(), String> {
    let opener = build_open_command(target_path, target, settings)?;
    Command::new(opener.command)
        .args(opener.args)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

struct OpenCommand {
    command: String,
    args: Vec<String>,
}

fn build_open_command(
    target_path: &Path,
    target: &OpenTarget,
    settings: &AppSettings,
) -> Result<OpenCommand, String> {
    let target_path = path_string(target_path);
    match target {
        OpenTarget::Folder => Ok(folder_open_command(&target_path)),
        OpenTarget::Editor => {
            if !matches!(settings.integrations.editor, EditorIntegrationId::Auto) {
                return Ok(editor_open_command(
                    &settings.integrations.editor,
                    &target_path,
                ));
            }

            if let Ok(configured) = env::var("WORKTREE_MANAGER_EDITOR") {
                if !configured.trim().is_empty() {
                    return configured_open_command(&configured, &target_path);
                }
            }

            if cfg!(target_os = "macos") {
                Ok(OpenCommand {
                    command: "open".to_string(),
                    args: vec![
                        "-a".to_string(),
                        env::var("WORKTREE_MANAGER_EDITOR_APP")
                            .ok()
                            .filter(|value| !value.trim().is_empty())
                            .unwrap_or_else(|| "Visual Studio Code".to_string()),
                        target_path,
                    ],
                })
            } else if cfg!(target_os = "windows") {
                Ok(OpenCommand {
                    command: "code.cmd".to_string(),
                    args: vec![target_path],
                })
            } else {
                Ok(OpenCommand {
                    command: "code".to_string(),
                    args: vec![target_path],
                })
            }
        }
        OpenTarget::Terminal => {
            if !matches!(
                settings.integrations.terminal,
                TerminalIntegrationId::Auto | TerminalIntegrationId::System
            ) {
                return Ok(terminal_open_command(
                    &settings.integrations.terminal,
                    &target_path,
                ));
            }

            if let Ok(configured) = env::var("WORKTREE_MANAGER_TERMINAL") {
                if !configured.trim().is_empty() {
                    return configured_open_command(&configured, &target_path);
                }
            }

            if cfg!(target_os = "macos") {
                Ok(OpenCommand {
                    command: "open".to_string(),
                    args: vec![
                        "-a".to_string(),
                        env::var("WORKTREE_MANAGER_TERMINAL_APP")
                            .ok()
                            .filter(|value| !value.trim().is_empty())
                            .unwrap_or_else(|| "Terminal".to_string()),
                        target_path,
                    ],
                })
            } else if cfg!(target_os = "windows") {
                Ok(OpenCommand {
                    command: "cmd.exe".to_string(),
                    args: vec![
                        "/K".to_string(),
                        "cd".to_string(),
                        "/d".to_string(),
                        target_path,
                    ],
                })
            } else {
                Ok(OpenCommand {
                    command: "x-terminal-emulator".to_string(),
                    args: vec!["--working-directory".to_string(), target_path],
                })
            }
        }
    }
}

fn editor_open_command(editor: &EditorIntegrationId, target_path: &str) -> OpenCommand {
    let command = match editor {
        EditorIntegrationId::Vscode => {
            if cfg!(target_os = "windows") {
                "code.cmd"
            } else {
                "code"
            }
        }
        EditorIntegrationId::Cursor => {
            if cfg!(target_os = "windows") {
                "cursor.cmd"
            } else {
                "cursor"
            }
        }
        EditorIntegrationId::Windsurf => {
            if cfg!(target_os = "windows") {
                "windsurf.cmd"
            } else {
                "windsurf"
            }
        }
        EditorIntegrationId::Zed => {
            if cfg!(target_os = "windows") {
                "zed.exe"
            } else {
                "zed"
            }
        }
        EditorIntegrationId::Sublime => {
            if cfg!(target_os = "windows") {
                "sublime_text.exe"
            } else {
                "subl"
            }
        }
        EditorIntegrationId::Auto => "code",
    };

    OpenCommand {
        command: command.to_string(),
        args: vec![target_path.to_string()],
    }
}

fn terminal_open_command(terminal: &TerminalIntegrationId, target_path: &str) -> OpenCommand {
    match terminal {
        TerminalIntegrationId::Iterm => OpenCommand {
            command: "open".to_string(),
            args: vec!["-a".to_string(), "iTerm".to_string(), target_path.to_string()],
        },
        TerminalIntegrationId::Warp => {
            if cfg!(target_os = "macos") {
                OpenCommand {
                    command: "open".to_string(),
                    args: vec!["-a".to_string(), "Warp".to_string(), target_path.to_string()],
                }
            } else {
                OpenCommand {
                    command: "warp-terminal".to_string(),
                    args: vec!["--working-directory".to_string(), target_path.to_string()],
                }
            }
        }
        TerminalIntegrationId::WindowsTerminal => OpenCommand {
            command: "wt.exe".to_string(),
            args: vec!["-d".to_string(), target_path.to_string()],
        },
        TerminalIntegrationId::GnomeTerminal => OpenCommand {
            command: "gnome-terminal".to_string(),
            args: vec!["--working-directory".to_string(), target_path.to_string()],
        },
        TerminalIntegrationId::Konsole => OpenCommand {
            command: "konsole".to_string(),
            args: vec!["--workdir".to_string(), target_path.to_string()],
        },
        TerminalIntegrationId::XTerminalEmulator
        | TerminalIntegrationId::Auto
        | TerminalIntegrationId::System => OpenCommand {
            command: "x-terminal-emulator".to_string(),
            args: vec!["--working-directory".to_string(), target_path.to_string()],
        },
    }
}

fn folder_open_command(target_path: &str) -> OpenCommand {
    if cfg!(target_os = "macos") {
        OpenCommand {
            command: "open".to_string(),
            args: vec![target_path.to_string()],
        }
    } else if cfg!(target_os = "windows") {
        OpenCommand {
            command: "explorer.exe".to_string(),
            args: vec![target_path.to_string()],
        }
    } else {
        OpenCommand {
            command: "xdg-open".to_string(),
            args: vec![target_path.to_string()],
        }
    }
}

fn configured_open_command(configured: &str, target_path: &str) -> Result<OpenCommand, String> {
    let parts = split_command(configured);
    if parts.is_empty() {
        return Err("Comando de abertura invalido.".to_string());
    }

    let contains_path_placeholder = parts.iter().any(|part| part.contains("{path}"));
    let mut replaced = parts
        .into_iter()
        .map(|part| part.replace("{path}", target_path))
        .collect::<Vec<_>>();
    if !contains_path_placeholder {
        replaced.push(target_path.to_string());
    }

    Ok(OpenCommand {
        command: replaced[0].clone(),
        args: replaced[1..].to_vec(),
    })
}

fn split_command(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;

    for character in value.chars() {
        if let Some(active_quote) = quote {
            if character == active_quote {
                quote = None;
            } else {
                current.push(character);
            }
            continue;
        }

        if character == '"' || character == '\'' {
            quote = Some(character);
            continue;
        }

        if character.is_whitespace() {
            if !current.is_empty() {
                parts.push(current.clone());
                current.clear();
            }
            continue;
        }

        current.push(character);
    }

    if !current.is_empty() {
        parts.push(current);
    }

    parts
}

fn home_dir() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
}
