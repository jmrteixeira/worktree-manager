use crate::{
    models::{
        BranchRecord, CommitInfo, GitFileStatus, GitStatusSummary, LocalBranchWorktreeResult,
        RepoDetail, RepoRecord, RepoSummary, WorktreeHandoffResult, WorktreeRecord,
    },
    store::{absolute_path, now_iso, path_string, AppState},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, SecondsFormat, Utc};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::Instant,
};
use uuid::Uuid;

const MAX_OPERATION_LOG_CHARS: usize = 20_000;

#[derive(Debug, Clone)]
pub struct GitResult {
    pub args: Vec<String>,
    pub cwd: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub started_at: String,
    pub duration_ms: u64,
    pub timed_out: bool,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone)]
pub struct RunGitOptions {
    pub allow_failure: bool,
    pub record: bool,
    pub timeout_ms: u64,
}

impl Default for RunGitOptions {
    fn default() -> Self {
        Self {
            allow_failure: false,
            record: true,
            timeout_ms: 30_000,
        }
    }
}

#[derive(Debug, Clone)]
struct StashHandle {
    message: String,
}

enum BranchSource {
    Local(String),
    Remote {
        branch: String,
        local_branch: String,
    },
}

pub fn encode_path_id(value: &str) -> String {
    URL_SAFE_NO_PAD.encode(value.as_bytes())
}

pub fn decode_path_id(value: &str) -> Result<String, String> {
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| "Identificador de worktree invalido.".to_string())?;
    String::from_utf8(bytes).map_err(|_| "Identificador de worktree invalido.".to_string())
}

pub fn run_git(
    cwd: &Path,
    args: Vec<String>,
    state: Option<&AppState>,
    options: RunGitOptions,
) -> Result<GitResult, String> {
    let started_at = now_iso();
    let started = Instant::now();
    let output = Command::new("git").args(&args).current_dir(cwd).output();

    let mut result = match output {
        Ok(output) => GitResult {
            args: args.clone(),
            cwd: path_string(cwd),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code(),
            started_at,
            duration_ms: started.elapsed().as_millis() as u64,
            timed_out: false,
            timeout_ms: options.timeout_ms,
        },
        Err(error) => GitResult {
            args: args.clone(),
            cwd: path_string(cwd),
            stdout: String::new(),
            stderr: error.to_string(),
            exit_code: Some(1),
            started_at,
            duration_ms: started.elapsed().as_millis() as u64,
            timed_out: false,
            timeout_ms: options.timeout_ms,
        },
    };

    if options.record {
        if let Some(state) = state {
            let stdout_log = limit_operation_log(&result.stdout);
            let stderr_log = limit_operation_log(&result.stderr);
            state.record_operation(crate::models::OperationRecord {
                id: String::new(),
                command: "git".to_string(),
                args: result.args.clone(),
                cwd: result.cwd.clone(),
                started_at: result.started_at.clone(),
                finished_at: String::new(),
                status: if result.exit_code == Some(0) {
                    "success".to_string()
                } else {
                    "error".to_string()
                },
                exit_code: result.exit_code,
                summary: summarize_git_result(&result),
                stdout: Some(stdout_log.0),
                stderr: stderr_log.0,
                stdout_truncated: Some(stdout_log.1),
                stderr_truncated: Some(stderr_log.1),
                duration_ms: Some(result.duration_ms),
                timeout_ms: Some(result.timeout_ms),
                timed_out: Some(result.timed_out),
                signal: None,
            });
        }
    }

    if !options.allow_failure && result.exit_code != Some(0) {
        if result.stderr.trim().is_empty() && !result.stdout.trim().is_empty() {
            result.stderr = result.stdout.clone();
        }
        return Err(first_line(&result.stderr)
            .unwrap_or_else(|| format!("git {} falhou", result.args.join(" "))));
    }

    Ok(result)
}

pub fn validate_repository(repo_path: &str, state: Option<&AppState>) -> Result<PathBuf, String> {
    let resolved_path = absolute_path(Path::new(repo_path));
    if !resolved_path.is_dir() {
        return Err("O caminho selecionado nao e uma pasta.".to_string());
    }

    let result = run_git(
        &resolved_path,
        git_args(&["rev-parse", "--show-toplevel"]),
        state,
        RunGitOptions {
            record: false,
            ..Default::default()
        },
    )?;
    let top_level = PathBuf::from(result.stdout.trim());
    Ok(absolute_path(&top_level))
}

pub fn parse_worktree_porcelain(stdout: &str, current_path: &Path) -> Vec<WorktreeRecord> {
    let normalized = stdout.replace("\r\n", "\n");
    normalized
        .split("\n\n")
        .map(str::trim)
        .filter(|block| !block.is_empty())
        .map(|block| {
            let mut worktree = WorktreeRecord {
                id: String::new(),
                path: String::new(),
                branch: None,
                head: None,
                is_current: false,
                detached: false,
                bare: false,
                last_commit: None,
                status: None,
                upstream: None,
                ahead: None,
                behind: None,
            };

            for line in block.lines() {
                let mut parts = line.splitn(2, ' ');
                let key = parts.next().unwrap_or_default();
                let value = parts.next().unwrap_or_default();
                match key {
                    "worktree" => {
                        worktree.path = value.to_string();
                        worktree.id = encode_path_id(value);
                    }
                    "HEAD" => worktree.head = Some(value.to_string()),
                    "branch" => {
                        worktree.branch = Some(value.trim_start_matches("refs/heads/").to_string());
                    }
                    "detached" => worktree.detached = true,
                    "bare" => worktree.bare = true,
                    _ => {}
                }
            }

            worktree.is_current =
                comparable_path(Path::new(&worktree.path)) == comparable_path(current_path);
            worktree
        })
        .collect()
}

pub fn parse_branch_refs(stdout: &str, current_branch: &str) -> Vec<BranchRecord> {
    let mut branches = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter_map(|line| {
            let parts = line.split('\t').collect::<Vec<_>>();
            let ref_name = parts.first().copied().unwrap_or_default();
            let short_name = parts.get(1).copied().unwrap_or_default();
            let upstream = parts.get(2).copied().unwrap_or_default();
            let head = parts.get(3).copied().unwrap_or_default();
            let date = parts.get(4).copied().unwrap_or_default();
            let subject = parts.get(5..).unwrap_or(&[]).join("\t");
            let is_remote = ref_name.starts_with("refs/remotes/");
            let name = short_name.trim_start_matches("remotes/").to_string();

            if name.ends_with("/HEAD") {
                return None;
            }

            Some(BranchRecord {
                current: !is_remote && name == current_branch,
                name,
                upstream: non_empty(upstream),
                is_remote,
                head: non_empty(head),
                last_commit: non_empty(head).map(|sha| CommitInfo {
                    sha,
                    date: non_empty(date),
                    subject: if subject.is_empty() {
                        "Sem mensagem de commit".to_string()
                    } else {
                        subject
                    },
                }),
                ahead: None,
                behind: None,
            })
        })
        .collect::<Vec<_>>();

    branches.sort_by(|a, b| {
        if a.current != b.current {
            return b.current.cmp(&a.current);
        }
        if a.is_remote != b.is_remote {
            return a.is_remote.cmp(&b.is_remote);
        }
        a.name.cmp(&b.name)
    });
    branches
}

pub fn parse_status_porcelain(stdout: &str) -> Vec<GitFileStatus> {
    stdout
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.is_empty())
        .map(|line| {
            if let Some(path) = line.strip_prefix("?? ") {
                return GitFileStatus {
                    path: decode_git_path(path),
                    original_path: None,
                    index_status: "?".to_string(),
                    worktree_status: "?".to_string(),
                    label: "Por seguir".to_string(),
                };
            }

            let index_status = line.chars().next().unwrap_or(' ');
            let worktree_status = line.chars().nth(1).unwrap_or(' ');
            let raw_path = line.get(3..).unwrap_or_default();
            let rename_parts = raw_path.split(" -> ").collect::<Vec<_>>();
            let (original_path, file_path) = if rename_parts.len() > 1 {
                (
                    Some(decode_git_path(rename_parts[0])),
                    decode_git_path(&rename_parts[1..].join(" -> ")),
                )
            } else {
                (None, decode_git_path(raw_path))
            };

            GitFileStatus {
                path: file_path,
                original_path,
                index_status: index_status.to_string(),
                worktree_status: worktree_status.to_string(),
                label: file_status_label(index_status, worktree_status),
            }
        })
        .collect()
}

fn decode_git_path(value: &str) -> String {
    let trimmed = value.trim();
    if !trimmed.starts_with('"') || !trimmed.ends_with('"') {
        return trimmed.to_string();
    }

    trimmed[1..trimmed.len() - 1]
        .replace("\\\"", "\"")
        .replace("\\\\", "\\")
        .replace("\\t", "\t")
        .replace("\\n", "\n")
}

pub fn resolve_repo_worktree_path(
    repo_path: &Path,
    requested_path: Option<&str>,
    state: Option<&AppState>,
) -> Result<PathBuf, String> {
    let Some(requested_path) = requested_path.filter(|value| !value.trim().is_empty()) else {
        return Ok(repo_path.to_path_buf());
    };

    let requested = PathBuf::from(requested_path);
    let worktree = find_worktree_by_path(repo_path, &requested, repo_path, state)?;
    worktree
        .map(|worktree| PathBuf::from(worktree.path))
        .ok_or_else(|| "A worktree selecionada nao pertence a este repositorio.".to_string())
}

pub fn assert_clean_worktree_for_safe_operation(
    worktree_path: &Path,
    operation_label: &str,
    state: Option<&AppState>,
) -> Result<(), String> {
    let status = get_worktree_status_summary(worktree_path, state)?;
    if status.conflicted > 0 {
        return Err(format!(
            "Modo seguro: {operation_label} bloqueado porque a worktree tem {}.",
            format_safe_conflict_count(status.conflicted)
        ));
    }

    if !status.clean {
        return Err(format!(
            "Modo seguro: {operation_label} bloqueado porque a worktree tem {} nao commitadas.",
            format_safe_change_count(status.total)
        ));
    }

    Ok(())
}

pub fn assert_no_conflicts_for_safe_operation(
    worktree_path: &Path,
    operation_label: &str,
    state: Option<&AppState>,
) -> Result<(), String> {
    let status = get_worktree_status_summary(worktree_path, state)?;
    if status.conflicted > 0 {
        return Err(format!(
            "Modo seguro: {operation_label} bloqueado porque a worktree tem {}.",
            format_safe_conflict_count(status.conflicted)
        ));
    }

    Ok(())
}

pub fn assert_safe_branch_deletion(
    repo_path: &Path,
    branch_name: &str,
    state: Option<&AppState>,
) -> Result<(), String> {
    if is_protected_branch(branch_name) {
        return Err(format!(
            "Modo seguro: nao e possivel apagar a branch protegida \"{}\".",
            branch_name
        ));
    }

    let porcelain = run_git(
        repo_path,
        git_args(&["worktree", "list", "--porcelain"]),
        state,
        RunGitOptions {
            record: false,
            ..Default::default()
        },
    )?;
    if let Some(worktree) = parse_worktree_porcelain(&porcelain.stdout, repo_path)
        .into_iter()
        .find(|worktree| worktree.branch.as_deref() == Some(branch_name))
    {
        return Err(format!(
            "Modo seguro: nao e possivel apagar \"{}\" porque esta checked out em {}.",
            branch_name, worktree.path
        ));
    }

    Ok(())
}

pub fn get_worktrees(
    repo_path: &Path,
    focused_path: &Path,
    state: Option<&AppState>,
) -> Result<Vec<WorktreeRecord>, String> {
    let porcelain = run_git(
        repo_path,
        git_args(&["worktree", "list", "--porcelain"]),
        state,
        RunGitOptions {
            record: false,
            ..Default::default()
        },
    )?;
    let mut worktrees = parse_worktree_porcelain(&porcelain.stdout, focused_path);

    for worktree in &mut worktrees {
        if worktree.bare || worktree.path.is_empty() {
            worktree.last_commit = None;
            worktree.status = Some(summarize_file_statuses(&[]));
            continue;
        }

        let worktree_path = PathBuf::from(&worktree.path);
        let last_commit = run_git(
            &worktree_path,
            git_args(&["log", "-1", "--format=%h%x09%cI%x09%s"]),
            state,
            RunGitOptions {
                allow_failure: true,
                record: false,
                ..Default::default()
            },
        )?;
        let status = run_git(
            &worktree_path,
            git_args(&["status", "--porcelain=v1", "-uall"]),
            state,
            RunGitOptions {
                allow_failure: true,
                record: false,
                ..Default::default()
            },
        )?;
        let upstream = get_upstream_branch(&worktree_path, state)?;
        let files = if status.exit_code == Some(0) {
            parse_status_porcelain(&status.stdout)
        } else {
            Vec::new()
        };
        let sync = if let Some(upstream) = upstream.as_deref() {
            get_ahead_behind(&worktree_path, upstream, state)?
        } else {
            (0, 0)
        };

        worktree.last_commit = parse_commit_line(&last_commit.stdout);
        worktree.status = Some(summarize_file_statuses(&files));
        worktree.upstream = upstream;
        worktree.ahead = Some(sync.0);
        worktree.behind = Some(sync.1);
    }

    Ok(worktrees)
}

pub fn get_branches(
    repo_path: &Path,
    state: Option<&AppState>,
) -> Result<Vec<BranchRecord>, String> {
    let current_branch = get_current_branch(repo_path, state)?;
    let refs = run_git(
    repo_path,
    git_args(&[
      "for-each-ref",
      "--format=%(refname)%09%(refname:short)%09%(upstream:short)%09%(objectname:short)%09%(committerdate:iso-strict)%09%(contents:subject)",
      "refs/heads",
      "refs/remotes",
    ]),
    state,
    RunGitOptions {
      record: false,
      ..Default::default()
    },
  )?;
    let mut branches = parse_branch_refs(&refs.stdout, &current_branch);

    for branch in &mut branches {
        if branch.is_remote || branch.upstream.is_none() {
            branch.ahead = Some(0);
            branch.behind = Some(0);
            continue;
        }

        let upstream = branch.upstream.clone().unwrap_or_default();
        let sync = get_ahead_behind_refs(repo_path, &branch.name, &upstream, state)?;
        branch.ahead = Some(sync.0);
        branch.behind = Some(sync.1);
    }

    Ok(branches)
}

pub fn get_repo_detail(
    repo: &RepoRecord,
    focused_path: &Path,
    state: Option<&AppState>,
) -> Result<RepoDetail, String> {
    let worktrees = get_worktrees(Path::new(&repo.path), focused_path, state)?;
    let status = run_git(
        focused_path,
        git_args(&["status", "--porcelain=v1", "-uall"]),
        state,
        RunGitOptions {
            record: false,
            ..Default::default()
        },
    )?;
    let branch = get_checked_out_branch(focused_path, state)?;
    let upstream = get_upstream_branch(focused_path, state)?;
    let last_fetch_at = get_last_fetch_at(focused_path, state)?;
    let stash_count = get_stash_count(Path::new(&repo.path), state)?;
    let worktree = worktrees
        .iter()
        .find(|item| comparable_path(Path::new(&item.path)) == comparable_path(focused_path))
        .or_else(|| worktrees.iter().find(|item| item.is_current))
        .cloned()
        .ok_or_else(|| "A worktree selecionada nao pertence a este repositorio.".to_string())?;

    let sync = if let Some(upstream) = upstream.as_deref() {
        get_ahead_behind(focused_path, upstream, state)?
    } else {
        (0, 0)
    };
    let files = parse_status_porcelain(&status.stdout);

    Ok(RepoDetail {
        repo: repo.clone(),
        worktree,
        branch,
        upstream,
        ahead: sync.0,
        behind: sync.1,
        last_fetch_at,
        stash_count,
        status: summarize_file_statuses(&files),
        files,
        worktrees,
        last_updated_at: now_iso(),
    })
}

pub fn get_repo_summary(
    repo: &RepoRecord,
    focused_path: &Path,
    state: Option<&AppState>,
) -> Result<RepoSummary, String> {
    let git_version = run_git(
        focused_path,
        git_args(&["--version"]),
        state,
        RunGitOptions {
            record: false,
            ..Default::default()
        },
    )?;
    let current_branch = get_current_branch(focused_path, state)?;
    let worktrees = get_worktrees(Path::new(&repo.path), focused_path, state)?;
    let branches = get_branches(focused_path, state)?;
    let commits = run_git(
        Path::new(&repo.path),
        git_args(&["rev-list", "--count", "--all"]),
        state,
        RunGitOptions {
            allow_failure: true,
            record: false,
            ..Default::default()
        },
    )?;
    let stash_count = get_stash_count(Path::new(&repo.path), state)?;
    let changed_file_count = worktrees
        .iter()
        .map(|worktree| {
            worktree
                .status
                .as_ref()
                .map(|status| status.total)
                .unwrap_or(0)
        })
        .sum::<usize>();
    let dirty_worktree_count = worktrees
        .iter()
        .filter(|worktree| {
            worktree
                .status
                .as_ref()
                .map(|status| !status.clean)
                .unwrap_or(false)
        })
        .count();
    let local_branches = branches
        .iter()
        .filter(|branch| !branch.is_remote)
        .collect::<Vec<_>>();
    let focused_branch = local_branches
        .iter()
        .find(|branch| branch.name == current_branch);
    let branch_ahead_count = local_branches
        .iter()
        .filter(|branch| branch.ahead.unwrap_or(0) > 0)
        .count();
    let branch_behind_count = local_branches
        .iter()
        .filter(|branch| branch.behind.unwrap_or(0) > 0)
        .count();

    Ok(RepoSummary {
        repo: repo.clone(),
        valid: true,
        git_version: git_version.stdout.trim().to_string(),
        focused_worktree_path: path_string(focused_path),
        current_branch,
        commit_count: commits.stdout.trim().parse::<usize>().unwrap_or(0),
        branch_count: local_branches.len(),
        worktree_count: worktrees.len(),
        dirty_worktree_count: Some(dirty_worktree_count),
        changed_file_count: Some(changed_file_count),
        stash_count: Some(stash_count),
        ahead: Some(
            focused_branch
                .map(|branch| branch.ahead.unwrap_or(0))
                .unwrap_or(0),
        ),
        behind: Some(
            focused_branch
                .map(|branch| branch.behind.unwrap_or(0))
                .unwrap_or(0),
        ),
        branch_ahead_count: Some(branch_ahead_count),
        branch_behind_count: Some(branch_behind_count),
        last_updated_at: now_iso(),
    })
}

pub fn create_worktree(
    repo: &RepoRecord,
    branch: &str,
    new_branch: bool,
    name: Option<&str>,
    requested_path: Option<&str>,
    default_directory: Option<&str>,
    state: &AppState,
) -> Result<PathBuf, String> {
    let repo_path = Path::new(&repo.path);
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("Campo obrigatorio em falta: branch.".to_string());
    }

    let target_path = resolve_worktree_target_path(
        repo_path,
        &repo.name,
        branch,
        name,
        requested_path,
        default_directory,
    );

    if target_path.exists() {
        return Err(format!(
            "Ja existe uma pasta com esse nome: {}",
            path_string(&target_path)
        ));
    }
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let args = if new_branch {
        assert_valid_branch_name(repo_path, branch, Some(state))?;
        assert_branch_does_not_exist(repo_path, branch, Some(state))?;
        vec![
            "worktree".to_string(),
            "add".to_string(),
            "-b".to_string(),
            branch.to_string(),
            path_string(&target_path),
        ]
    } else {
        match resolve_branch_source(repo_path, branch, Some(state))? {
            BranchSource::Local(local_branch) => {
                assert_branch_available_for_checkout(repo_path, &local_branch, None, Some(state))?;
                vec![
                    "worktree".to_string(),
                    "add".to_string(),
                    path_string(&target_path),
                    local_branch,
                ]
            }
            BranchSource::Remote {
                branch,
                local_branch,
            } => {
                assert_branch_available_for_checkout(repo_path, &local_branch, None, Some(state))?;
                vec![
                    "worktree".to_string(),
                    "add".to_string(),
                    "-b".to_string(),
                    local_branch,
                    "--track".to_string(),
                    path_string(&target_path),
                    branch,
                ]
            }
        }
    };

    run_git(
        repo_path,
        args,
        Some(state),
        RunGitOptions {
            timeout_ms: 120_000,
            ..Default::default()
        },
    )?;
    Ok(target_path)
}

pub fn remove_worktree(
    repo: &RepoRecord,
    worktree_id: &str,
    confirm: &str,
    state: &AppState,
) -> Result<(), String> {
    let worktree_path = decode_path_id(worktree_id)?;
    let short_name = Path::new(&worktree_path)
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| worktree_path.clone());
    if confirm != short_name && confirm != worktree_path {
        return Err(format!("Escreve \"{}\" para confirmar.", short_name));
    }

    run_git(
        Path::new(&repo.path),
        vec!["worktree".to_string(), "remove".to_string(), worktree_path],
        Some(state),
        RunGitOptions {
            timeout_ms: 120_000,
            ..Default::default()
        },
    )?;
    Ok(())
}

pub fn create_branch(
    repo: &RepoRecord,
    name: &str,
    from: Option<&str>,
    worktree_path: Option<&str>,
    state: &AppState,
) -> Result<String, String> {
    let focused_path =
        resolve_repo_worktree_path(Path::new(&repo.path), worktree_path, Some(state))?;
    let branch_name = name.trim();
    assert_valid_branch_name(&focused_path, branch_name, Some(state))?;
    assert_branch_does_not_exist(&focused_path, branch_name, Some(state))?;

    let start_point = from.filter(|value| !value.trim().is_empty()).map(str::trim);
    let args = if let Some(start_point) = start_point {
        let remote_exists = remote_branch_exists(&focused_path, start_point, Some(state))?;
        assert_ref_exists(&focused_path, start_point, Some(state))?;
        if remote_exists {
            vec![
                "branch".to_string(),
                "--track".to_string(),
                branch_name.to_string(),
                start_point.to_string(),
            ]
        } else {
            vec![
                "branch".to_string(),
                branch_name.to_string(),
                start_point.to_string(),
            ]
        }
    } else {
        vec!["branch".to_string(), branch_name.to_string()]
    };
    run_git(&focused_path, args, Some(state), Default::default())?;
    Ok(branch_name.to_string())
}

pub fn checkout_branch(
    repo: &RepoRecord,
    branch_name: &str,
    worktree_path: Option<&str>,
    state: &AppState,
) -> Result<String, String> {
    let focused_path =
        resolve_repo_worktree_path(Path::new(&repo.path), worktree_path, Some(state))?;
    let branch = branch_name.trim();
    assert_local_branch_exists(Path::new(&repo.path), branch, Some(state))?;
    assert_branch_available_for_checkout(
        Path::new(&repo.path),
        branch,
        Some(&focused_path),
        Some(state),
    )?;
    run_git(
        &focused_path,
        vec!["switch".to_string(), branch.to_string()],
        Some(state),
        Default::default(),
    )?;
    Ok(branch.to_string())
}

pub fn delete_branch(
    repo: &RepoRecord,
    branch_name: &str,
    confirm: &str,
    force: bool,
    worktree_path: Option<&str>,
    state: &AppState,
) -> Result<(), String> {
    if confirm != branch_name {
        return Err(format!("Escreve \"{}\" para confirmar.", branch_name));
    }

    let focused_path =
        resolve_repo_worktree_path(Path::new(&repo.path), worktree_path, Some(state))?;
    run_git(
        &focused_path,
        vec![
            "branch".to_string(),
            if force { "-D" } else { "-d" }.to_string(),
            branch_name.to_string(),
        ],
        Some(state),
        Default::default(),
    )?;
    Ok(())
}

pub fn fetch_repo(
    repo: &RepoRecord,
    worktree_path: Option<&str>,
    state: &AppState,
) -> Result<(), String> {
    let focused_path =
        resolve_repo_worktree_path(Path::new(&repo.path), worktree_path, Some(state))?;
    run_git(
        &focused_path,
        git_args(&["fetch", "--prune"]),
        Some(state),
        RunGitOptions {
            timeout_ms: 120_000,
            ..Default::default()
        },
    )?;
    Ok(())
}

pub fn pull_repo(
    repo: &RepoRecord,
    worktree_path: Option<&str>,
    state: &AppState,
) -> Result<(), String> {
    let focused_path =
        resolve_repo_worktree_path(Path::new(&repo.path), worktree_path, Some(state))?;
    run_git(
        &focused_path,
        git_args(&["pull", "--ff-only"]),
        Some(state),
        RunGitOptions {
            timeout_ms: 120_000,
            ..Default::default()
        },
    )?;
    Ok(())
}

pub fn handoff_worktree_branch_to_local(
    repo_path: &Path,
    source_worktree_path: &Path,
    state: &AppState,
) -> Result<WorktreeHandoffResult, String> {
    let source = find_worktree_by_path(repo_path, source_worktree_path, repo_path, Some(state))?
        .ok_or_else(|| "A worktree selecionada nao pertence a este repositorio.".to_string())?;

    if comparable_path(repo_path) == comparable_path(Path::new(&source.path)) {
        return Err("Esta worktree ja e o workspace local.".to_string());
    }

    if source.branch.is_none() || source.detached || source.bare {
        return Err("A worktree selecionada nao tem uma branch local para handoff.".to_string());
    }

    if has_local_changes(repo_path, Some(state))? {
        return Err("O workspace local tem alteracoes por guardar. Limpa ou guarda essas alteracoes antes do checkout local.".to_string());
    }

    let branch = source.branch.clone().unwrap_or_default();
    let source_path = PathBuf::from(&source.path);
    let source_stash = if has_local_changes(&source_path, Some(state))? {
        Some(stash_local_changes(
            &source_path,
            &format!("worktree-manager worktree-to-local {}", Uuid::new_v4()),
            state,
        )?)
    } else {
        None
    };

    if let Err(error) = run_git(
        &source_path,
        git_args(&["switch", "--detach"]),
        Some(state),
        Default::default(),
    ) {
        if let Some(stash) = source_stash.as_ref() {
            let _ = restore_stash(&source_path, stash, state);
        }
        return Err(error);
    }

    if let Err(error) = run_git(
        repo_path,
        vec!["switch".to_string(), branch.clone()],
        Some(state),
        Default::default(),
    ) {
        let _ = run_git(
            &source_path,
            vec!["switch".to_string(), branch.clone()],
            Some(state),
            RunGitOptions {
                allow_failure: true,
                ..Default::default()
            },
        );
        if let Some(stash) = source_stash.as_ref() {
            let _ = restore_stash(&source_path, stash, state);
        }
        return Err(error);
    }

    if let Some(stash) = source_stash.as_ref() {
        apply_stash_or_throw(repo_path, stash, state)?;
        drop_stash(repo_path, stash, state)?;
    }

    Ok(WorktreeHandoffResult {
        branch,
        local_path: path_string(repo_path),
        detached_worktree_path: source.path,
        moved_changes: source_stash.is_some(),
    })
}

pub fn move_local_branch_to_worktree(
    repo: &RepoRecord,
    name: Option<&str>,
    requested_path: Option<&str>,
    default_directory: Option<&str>,
    state: &AppState,
    safe_mode: bool,
) -> Result<LocalBranchWorktreeResult, String> {
    let repo_path = Path::new(&repo.path);
    let branch = get_checked_out_branch(repo_path, Some(state))?
        .ok_or_else(|| "O workspace local esta em detached HEAD.".to_string())?;

    if is_base_branch(&branch) {
        return Err("A branch local atual ja e main/master.".to_string());
    }

    let base_branch = get_local_base_branch(repo_path, Some(state))?.ok_or_else(|| {
        "Nao encontrei uma branch local main ou master para deixar no workspace local.".to_string()
    })?;

    let preferred_worktree_path = resolve_worktree_target_path(
        repo_path,
        &repo.name,
        &branch,
        name,
        requested_path,
        default_directory,
    );
    let preferred_path_exists = preferred_worktree_path.exists();
    let preferred_worktree = if preferred_path_exists {
        find_worktree_by_path(repo_path, &preferred_worktree_path, repo_path, Some(state))?
    } else {
        None
    };
    let reusable_worktree = if preferred_worktree.is_some() {
        preferred_worktree
    } else if requested_path.is_none() {
        find_reusable_detached_worktree_for_branch(repo_path, &branch, state)?
    } else {
        None
    };

    if requested_path.is_some() && preferred_path_exists && reusable_worktree.is_none() {
        return Err(format!(
            "Ja existe uma pasta com esse nome: {}",
            path_string(&preferred_worktree_path)
        ));
    }

    if requested_path.is_none() && preferred_path_exists && reusable_worktree.is_none() {
        return Err(format!(
            "Ja existe uma pasta com esse nome: {}",
            path_string(&preferred_worktree_path)
        ));
    }

    if let Some(worktree) = reusable_worktree.as_ref() {
        if comparable_path(repo_path) == comparable_path(Path::new(&worktree.path)) {
            return Err("A worktree de destino nao pode ser o workspace local.".to_string());
        }
        if let Some(branch) = worktree.branch.as_ref() {
            return Err(format!(
                "Ja existe uma worktree nesse caminho com a branch {}.",
                branch
            ));
        }
        if worktree.bare {
            return Err("A worktree de destino nao pode ser bare.".to_string());
        }
    }

    let local_stash = if has_local_changes(repo_path, Some(state))? {
        Some(stash_local_changes(
            repo_path,
            &format!("worktree-manager local-to-worktree {}", Uuid::new_v4()),
            state,
        )?)
    } else {
        None
    };
    let final_worktree_path = reusable_worktree
        .as_ref()
        .map(|worktree| PathBuf::from(&worktree.path))
        .unwrap_or_else(|| preferred_worktree_path.clone());
    let mut worktree_stash: Option<StashHandle> = None;

    if safe_mode && reusable_worktree.is_some() {
        assert_no_conflicts_for_safe_operation(
            &final_worktree_path,
            "mover para worktree",
            Some(state),
        )?;
    }

    if let Err(error) = run_git(
        repo_path,
        vec!["switch".to_string(), base_branch.clone()],
        Some(state),
        Default::default(),
    ) {
        if let Some(stash) = local_stash.as_ref() {
            let _ = restore_stash(repo_path, stash, state);
        }
        return Err(error);
    }

    if let Err(error) = if reusable_worktree.is_some() {
        if has_local_changes(&final_worktree_path, Some(state))? {
            worktree_stash = Some(stash_local_changes(
                &final_worktree_path,
                &format!("worktree-manager existing-worktree {}", Uuid::new_v4()),
                state,
            )?);
        }
        run_git(
            &final_worktree_path,
            vec!["switch".to_string(), branch.clone()],
            Some(state),
            Default::default(),
        )
    } else {
        if let Some(parent) = final_worktree_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        run_git(
            repo_path,
            vec![
                "worktree".to_string(),
                "add".to_string(),
                path_string(&final_worktree_path),
                branch.clone(),
            ],
            Some(state),
            Default::default(),
        )
    } {
        if let Some(stash) = worktree_stash.as_ref() {
            let _ = restore_stash(&final_worktree_path, stash, state);
        }
        if let Some(stash) = local_stash.as_ref() {
            let _ = run_git(
                repo_path,
                vec!["switch".to_string(), branch.clone()],
                Some(state),
                RunGitOptions {
                    allow_failure: true,
                    ..Default::default()
                },
            );
            let _ = restore_stash(repo_path, stash, state);
        }
        return Err(error);
    }

    if let Some(stash) = worktree_stash.as_ref() {
        apply_stash_or_throw(&final_worktree_path, stash, state)?;
        drop_stash(&final_worktree_path, stash, state)?;
    }

    if let Some(stash) = local_stash.as_ref() {
        apply_stash_or_throw(&final_worktree_path, stash, state)?;
        drop_stash(&final_worktree_path, stash, state)?;
    }

    Ok(LocalBranchWorktreeResult {
        branch,
        base_branch,
        local_path: repo.path.clone(),
        worktree_path: path_string(&final_worktree_path),
        moved_changes: local_stash.is_some(),
    })
}

pub fn get_current_branch(repo_path: &Path, state: Option<&AppState>) -> Result<String, String> {
    if let Some(branch_name) = get_checked_out_branch(repo_path, state)? {
        return Ok(branch_name);
    }

    let head = run_git(
        repo_path,
        git_args(&["rev-parse", "--short", "HEAD"]),
        state,
        RunGitOptions {
            allow_failure: true,
            record: false,
            ..Default::default()
        },
    )?;
    let value = head.stdout.trim();
    Ok(if value.is_empty() {
        "desconhecida".to_string()
    } else {
        format!("detached {value}")
    })
}

pub fn default_worktree_name(repo_name: &str, branch_name: &str) -> String {
    format!(
        "{}-{}",
        sanitize_file_part(repo_name),
        sanitize_file_part(branch_name)
    )
}

fn resolve_worktree_target_path(
    repo_path: &Path,
    repo_name: &str,
    branch_name: &str,
    name: Option<&str>,
    requested_path: Option<&str>,
    default_directory: Option<&str>,
) -> PathBuf {
    if let Some(requested_path) = requested_path.filter(|value| !value.trim().is_empty()) {
        return absolute_path(Path::new(requested_path));
    }

    let directory = default_directory
        .filter(|value| !value.trim().is_empty())
        .map(|value| absolute_path(Path::new(value)))
        .unwrap_or_else(|| {
            repo_path
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .to_path_buf()
        });
    let folder_name = name
        .map(sanitize_file_part)
        .unwrap_or_else(|| default_worktree_name(repo_name, branch_name));

    directory.join(folder_name)
}

pub fn sanitize_file_part(value: &str) -> String {
    let mut normalized = String::new();
    let mut last_was_dash = false;

    for character in value.trim().chars() {
        let next = if character.is_ascii_alphanumeric()
            || character == '.'
            || character == '_'
            || character == '-'
        {
            character
        } else {
            '-'
        };

        if next == '-' {
            if !last_was_dash {
                normalized.push(next);
            }
            last_was_dash = true;
        } else {
            normalized.push(next);
            last_was_dash = false;
        }
    }

    let trimmed = normalized.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "worktree".to_string()
    } else {
        trimmed
    }
}

fn get_checked_out_branch(
    repo_path: &Path,
    state: Option<&AppState>,
) -> Result<Option<String>, String> {
    let branch = run_git(
        repo_path,
        git_args(&["branch", "--show-current"]),
        state,
        RunGitOptions {
            allow_failure: true,
            record: false,
            ..Default::default()
        },
    )?;
    Ok(non_empty(branch.stdout.trim()))
}

fn assert_valid_branch_name(
    repo_path: &Path,
    branch_name: &str,
    state: Option<&AppState>,
) -> Result<(), String> {
    if branch_name.trim().is_empty() {
        return Err("O nome da branch nao pode estar vazio.".to_string());
    }

    let result = run_git(
        repo_path,
        vec![
            "check-ref-format".to_string(),
            "--branch".to_string(),
            branch_name.to_string(),
        ],
        state,
        RunGitOptions {
            allow_failure: true,
            record: false,
            ..Default::default()
        },
    )?;
    if result.exit_code != Some(0) {
        return Err(format!("Nome de branch invalido: {branch_name}"));
    }
    Ok(())
}

fn assert_branch_does_not_exist(
    repo_path: &Path,
    branch_name: &str,
    state: Option<&AppState>,
) -> Result<(), String> {
    if local_branch_exists(repo_path, branch_name, state)? {
        return Err(format!("A branch local \"{}\" ja existe.", branch_name));
    }
    Ok(())
}

fn assert_local_branch_exists(
    repo_path: &Path,
    branch_name: &str,
    state: Option<&AppState>,
) -> Result<(), String> {
    if !local_branch_exists(repo_path, branch_name, state)? {
        return Err(format!("A branch local \"{}\" nao existe.", branch_name));
    }
    Ok(())
}

fn assert_ref_exists(
    repo_path: &Path,
    ref_name: &str,
    state: Option<&AppState>,
) -> Result<(), String> {
    let result = run_git(
        repo_path,
        vec![
            "rev-parse".to_string(),
            "--verify".to_string(),
            "--quiet".to_string(),
            ref_name.to_string(),
        ],
        state,
        RunGitOptions {
            allow_failure: true,
            record: false,
            ..Default::default()
        },
    )?;
    if result.exit_code != Some(0) {
        return Err(format!("A referencia \"{}\" nao existe.", ref_name));
    }
    Ok(())
}

fn resolve_branch_source(
    repo_path: &Path,
    branch_name: &str,
    state: Option<&AppState>,
) -> Result<BranchSource, String> {
    if local_branch_exists(repo_path, branch_name, state)? {
        return Ok(BranchSource::Local(branch_name.to_string()));
    }

    if remote_branch_exists(repo_path, branch_name, state)? {
        let local_branch = local_branch_name_from_remote(branch_name);
        assert_valid_branch_name(repo_path, &local_branch, state)?;
        if local_branch_exists(repo_path, &local_branch, state)? {
            return Ok(BranchSource::Local(local_branch));
        }
        return Ok(BranchSource::Remote {
            branch: branch_name.to_string(),
            local_branch,
        });
    }

    Err(format!("A branch ou ref \"{}\" nao existe.", branch_name))
}

fn local_branch_exists(
    repo_path: &Path,
    branch_name: &str,
    state: Option<&AppState>,
) -> Result<bool, String> {
    ref_exists(repo_path, &format!("refs/heads/{branch_name}"), state)
}

fn remote_branch_exists(
    repo_path: &Path,
    branch_name: &str,
    state: Option<&AppState>,
) -> Result<bool, String> {
    if branch_name.ends_with("/HEAD") {
        return Ok(false);
    }
    ref_exists(repo_path, &format!("refs/remotes/{branch_name}"), state)
}

fn ref_exists(repo_path: &Path, full_ref: &str, state: Option<&AppState>) -> Result<bool, String> {
    let result = run_git(
        repo_path,
        vec![
            "show-ref".to_string(),
            "--verify".to_string(),
            "--quiet".to_string(),
            full_ref.to_string(),
        ],
        state,
        RunGitOptions {
            allow_failure: true,
            record: false,
            ..Default::default()
        },
    )?;
    Ok(result.exit_code == Some(0))
}

fn assert_branch_available_for_checkout(
    repo_path: &Path,
    branch_name: &str,
    target_path: Option<&Path>,
    state: Option<&AppState>,
) -> Result<(), String> {
    let porcelain = run_git(
        repo_path,
        git_args(&["worktree", "list", "--porcelain"]),
        state,
        RunGitOptions {
            record: false,
            ..Default::default()
        },
    )?;
    let target = target_path.map(absolute_path);
    let worktrees = parse_worktree_porcelain(&porcelain.stdout, target_path.unwrap_or(repo_path));
    let occupied = worktrees.into_iter().find(|worktree| {
        if worktree.branch.as_deref() != Some(branch_name) {
            return false;
        }
        if let Some(target) = target.as_ref() {
            absolute_path(Path::new(&worktree.path)) != *target
        } else {
            true
        }
    });

    if let Some(occupied) = occupied {
        return Err(format!(
            "A branch \"{}\" ja esta checked out em {}.",
            branch_name, occupied.path
        ));
    }

    Ok(())
}

fn local_branch_name_from_remote(remote_branch: &str) -> String {
    remote_branch
        .split_once('/')
        .map(|(_, branch)| branch.to_string())
        .unwrap_or_else(|| remote_branch.to_string())
}

fn get_local_base_branch(
    repo_path: &Path,
    state: Option<&AppState>,
) -> Result<Option<String>, String> {
    let refs = run_git(
        repo_path,
        git_args(&[
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/heads/main",
            "refs/heads/master",
        ]),
        state,
        RunGitOptions {
            record: false,
            ..Default::default()
        },
    )?;
    let names = refs
        .stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    if names.contains(&"main") {
        Ok(Some("main".to_string()))
    } else if names.contains(&"master") {
        Ok(Some("master".to_string()))
    } else {
        Ok(None)
    }
}

fn get_upstream_branch(
    repo_path: &Path,
    state: Option<&AppState>,
) -> Result<Option<String>, String> {
    let upstream = run_git(
        repo_path,
        git_args(&["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
        state,
        RunGitOptions {
            allow_failure: true,
            record: false,
            ..Default::default()
        },
    )?;
    let value = upstream.stdout.trim();
    Ok(if upstream.exit_code == Some(0) && !value.is_empty() {
        Some(value.to_string())
    } else {
        None
    })
}

fn get_ahead_behind(
    repo_path: &Path,
    upstream: &str,
    state: Option<&AppState>,
) -> Result<(i64, i64), String> {
    get_ahead_behind_refs(repo_path, "HEAD", upstream, state)
}

fn get_ahead_behind_refs(
    repo_path: &Path,
    left_ref: &str,
    right_ref: &str,
    state: Option<&AppState>,
) -> Result<(i64, i64), String> {
    let result = run_git(
        repo_path,
        vec![
            "rev-list".to_string(),
            "--left-right".to_string(),
            "--count".to_string(),
            format!("{left_ref}...{right_ref}"),
        ],
        state,
        RunGitOptions {
            allow_failure: true,
            record: false,
            ..Default::default()
        },
    )?;
    let values = result
        .stdout
        .split_whitespace()
        .map(|value| value.parse::<i64>().unwrap_or(0))
        .collect::<Vec<_>>();
    Ok((
        values.first().copied().unwrap_or(0),
        values.get(1).copied().unwrap_or(0),
    ))
}

fn get_last_fetch_at(repo_path: &Path, state: Option<&AppState>) -> Result<Option<String>, String> {
    let git_path = run_git(
        repo_path,
        git_args(&["rev-parse", "--git-path", "FETCH_HEAD"]),
        state,
        RunGitOptions {
            allow_failure: true,
            record: false,
            ..Default::default()
        },
    )?;
    let value = git_path.stdout.trim();
    if value.is_empty() {
        return Ok(None);
    }

    let fetch_head_path = if Path::new(value).is_absolute() {
        PathBuf::from(value)
    } else {
        repo_path.join(value)
    };
    let Ok(metadata) = fs::metadata(fetch_head_path) else {
        return Ok(None);
    };
    let Ok(modified) = metadata.modified() else {
        return Ok(None);
    };
    let date: DateTime<Utc> = modified.into();
    Ok(Some(date.to_rfc3339_opts(SecondsFormat::Millis, true)))
}

fn has_local_changes(repo_path: &Path, state: Option<&AppState>) -> Result<bool, String> {
    let status = run_git(
        repo_path,
        git_args(&["status", "--porcelain=v1", "-uall"]),
        state,
        RunGitOptions {
            record: false,
            ..Default::default()
        },
    )?;
    Ok(!status.stdout.trim().is_empty())
}

fn get_worktree_status_summary(
    repo_path: &Path,
    state: Option<&AppState>,
) -> Result<GitStatusSummary, String> {
    let status = run_git(
        repo_path,
        git_args(&["status", "--porcelain=v1", "-uall"]),
        state,
        RunGitOptions {
            record: false,
            ..Default::default()
        },
    )?;
    Ok(summarize_file_statuses(&parse_status_porcelain(
        &status.stdout,
    )))
}

fn get_stash_count(repo_path: &Path, state: Option<&AppState>) -> Result<usize, String> {
    let stash_list = run_git(
        repo_path,
        git_args(&["stash", "list", "--format=%gd"]),
        state,
        RunGitOptions {
            allow_failure: true,
            record: false,
            ..Default::default()
        },
    )?;

    if stash_list.exit_code != Some(0) {
        return Ok(0);
    }

    Ok(stash_list
        .stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count())
}

fn stash_local_changes(
    repo_path: &Path,
    stash_message: &str,
    state: &AppState,
) -> Result<StashHandle, String> {
    run_git(
        repo_path,
        vec![
            "stash".to_string(),
            "push".to_string(),
            "--include-untracked".to_string(),
            "--message".to_string(),
            stash_message.to_string(),
        ],
        Some(state),
        Default::default(),
    )?;
    let stash_ref = find_stash_ref(repo_path, stash_message, state)?;
    if stash_ref.is_none() {
        return Err(
            "Nao consegui identificar a stash temporaria das alteracoes locais.".to_string(),
        );
    }

    Ok(StashHandle {
        message: stash_message.to_string(),
    })
}

fn find_stash_ref(
    repo_path: &Path,
    stash_message: &str,
    state: &AppState,
) -> Result<Option<String>, String> {
    let list = run_git(
        repo_path,
        git_args(&["stash", "list", "--format=%gd%x09%s"]),
        Some(state),
        RunGitOptions {
            record: false,
            ..Default::default()
        },
    )?;
    Ok(list
        .stdout
        .lines()
        .map(str::trim)
        .find(|line| line.ends_with(stash_message))
        .and_then(|line| line.split('\t').next())
        .map(str::to_string))
}

fn apply_stash_or_throw(
    repo_path: &Path,
    stash: &StashHandle,
    state: &AppState,
) -> Result<(), String> {
    let stash_ref = find_stash_ref(repo_path, &stash.message, state)?
        .ok_or_else(|| "Nao encontrei a stash temporaria para aplicar.".to_string())?;
    let applied = run_git(
        repo_path,
        vec![
            "stash".to_string(),
            "apply".to_string(),
            "--index".to_string(),
            stash_ref.clone(),
        ],
        Some(state),
        RunGitOptions {
            allow_failure: true,
            ..Default::default()
        },
    )?;
    if applied.exit_code != Some(0) {
        return Err(if applied.stderr.trim().is_empty() {
            format!(
        "Nao consegui reaplicar as alteracoes guardadas em {}. A stash temporaria foi mantida.",
        stash_ref
      )
        } else {
            applied.stderr.trim().to_string()
        });
    }
    Ok(())
}

fn drop_stash(repo_path: &Path, stash: &StashHandle, state: &AppState) -> Result<(), String> {
    if let Some(stash_ref) = find_stash_ref(repo_path, &stash.message, state)? {
        run_git(
            repo_path,
            vec!["stash".to_string(), "drop".to_string(), stash_ref],
            Some(state),
            Default::default(),
        )?;
    }
    Ok(())
}

fn restore_stash(repo_path: &Path, stash: &StashHandle, state: &AppState) -> Result<bool, String> {
    let Some(stash_ref) = find_stash_ref(repo_path, &stash.message, state)? else {
        return Ok(false);
    };
    let applied = run_git(
        repo_path,
        vec![
            "stash".to_string(),
            "apply".to_string(),
            "--index".to_string(),
            stash_ref.clone(),
        ],
        Some(state),
        RunGitOptions {
            allow_failure: true,
            ..Default::default()
        },
    )?;
    if applied.exit_code != Some(0) {
        return Ok(false);
    }
    let _ = run_git(
        repo_path,
        vec!["stash".to_string(), "drop".to_string(), stash_ref],
        Some(state),
        RunGitOptions {
            allow_failure: true,
            ..Default::default()
        },
    );
    Ok(true)
}

fn is_base_branch(branch: &str) -> bool {
    branch == "main" || branch == "master"
}

fn is_protected_branch(branch: &str) -> bool {
    branch == "main" || branch == "master"
}

fn summarize_file_statuses(files: &[GitFileStatus]) -> GitStatusSummary {
    let mut summary = GitStatusSummary {
        staged: 0,
        unstaged: 0,
        untracked: 0,
        conflicted: 0,
        total: 0,
        clean: true,
    };

    for file in files {
        let index_status = file.index_status.chars().next().unwrap_or(' ');
        let worktree_status = file.worktree_status.chars().next().unwrap_or(' ');
        let conflicted = is_conflict_status(index_status, worktree_status);
        summary.staged += usize::from(is_staged_status(index_status));
        summary.unstaged += usize::from(is_unstaged_status(worktree_status));
        summary.untracked += usize::from(index_status == '?' && worktree_status == '?');
        summary.conflicted += usize::from(conflicted);
        summary.total += 1;
    }

    summary.clean = summary.total == 0;
    summary
}

fn is_staged_status(status: char) -> bool {
    status != ' ' && status != '?' && status != 'U'
}

fn is_unstaged_status(status: char) -> bool {
    status != ' ' && status != '?' && status != 'U'
}

fn is_conflict_status(index_status: char, worktree_status: char) -> bool {
    index_status == 'U'
        || worktree_status == 'U'
        || (index_status == 'A' && worktree_status == 'A')
        || (index_status == 'D' && worktree_status == 'D')
}

fn file_status_label(index_status: char, worktree_status: char) -> String {
    if index_status == '?' && worktree_status == '?' {
        return "Por seguir".to_string();
    }
    if is_conflict_status(index_status, worktree_status) {
        return "Conflito".to_string();
    }
    if index_status == 'R' {
        return "Renomeado".to_string();
    }
    if index_status == 'A' {
        return "Adicionado".to_string();
    }
    if index_status == 'D' || worktree_status == 'D' {
        return "Removido".to_string();
    }
    if index_status == 'M' || worktree_status == 'M' {
        return "Modificado".to_string();
    }
    "Alterado".to_string()
}

fn format_safe_change_count(count: usize) -> String {
    if count == 1 {
        "1 alteracao".to_string()
    } else {
        format!("{count} alteracoes")
    }
}

fn format_safe_conflict_count(count: usize) -> String {
    if count == 1 {
        "1 conflito".to_string()
    } else {
        format!("{count} conflitos")
    }
}

fn find_worktree_by_path(
    repo_path: &Path,
    requested_path: &Path,
    current_path: &Path,
    state: Option<&AppState>,
) -> Result<Option<WorktreeRecord>, String> {
    let requested = comparable_path(requested_path);
    let porcelain = run_git(
        repo_path,
        git_args(&["worktree", "list", "--porcelain"]),
        state,
        RunGitOptions {
            record: false,
            ..Default::default()
        },
    )?;
    let worktrees = parse_worktree_porcelain(&porcelain.stdout, current_path);

    Ok(worktrees
        .into_iter()
        .find(|worktree| comparable_path(Path::new(&worktree.path)) == requested))
}

fn find_reusable_detached_worktree_for_branch(
    repo_path: &Path,
    branch: &str,
    state: &AppState,
) -> Result<Option<WorktreeRecord>, String> {
    let branch_head = run_git(
        repo_path,
        vec!["rev-parse".to_string(), branch.to_string()],
        Some(state),
        RunGitOptions {
            record: false,
            ..Default::default()
        },
    )?
    .stdout
    .trim()
    .to_string();
    let local_path = comparable_path(repo_path);
    let porcelain = run_git(
        repo_path,
        git_args(&["worktree", "list", "--porcelain"]),
        Some(state),
        RunGitOptions {
            record: false,
            ..Default::default()
        },
    )?;
    let worktrees = parse_worktree_porcelain(&porcelain.stdout, repo_path);

    Ok(worktrees.into_iter().find(|worktree| {
        comparable_path(Path::new(&worktree.path)) != local_path
            && worktree.detached
            && !worktree.bare
            && worktree.branch.is_none()
            && worktree.head.as_deref() == Some(branch_head.as_str())
    }))
}

fn comparable_path(value: &Path) -> PathBuf {
    value
        .canonicalize()
        .unwrap_or_else(|_| absolute_path(value))
}

fn parse_commit_line(stdout: &str) -> Option<CommitInfo> {
    let line = stdout.trim();
    if line.is_empty() {
        return None;
    }

    let parts = line.split('\t').collect::<Vec<_>>();
    Some(CommitInfo {
        sha: parts.first().copied().unwrap_or_default().to_string(),
        date: non_empty(parts.get(1).copied().unwrap_or_default()),
        subject: {
            let subject = parts.get(2..).unwrap_or(&[]).join("\t");
            if subject.is_empty() {
                "Sem mensagem de commit".to_string()
            } else {
                subject
            }
        },
    })
}

fn first_line(value: &str) -> Option<String> {
    value
        .trim()
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.chars().take(240).collect())
}

fn summarize_git_result(result: &GitResult) -> String {
    let command = format!("git {}", result.args.join(" "));
    if result.timed_out {
        return format!("{command} excedeu {}ms", result.timeout_ms);
    }
    if result.exit_code == Some(0) {
        return first_line(&result.stdout).unwrap_or_else(|| format!("{command} concluido"));
    }
    first_line(&result.stderr).unwrap_or_else(|| format!("{command} falhou"))
}

fn limit_operation_log(value: &str) -> (String, bool) {
    let normalized = value.trim_end();
    if normalized.chars().count() <= MAX_OPERATION_LOG_CHARS {
        return (normalized.to_string(), false);
    }

    (
        format!(
            "{}\n\n[log truncado]",
            normalized
                .chars()
                .take(MAX_OPERATION_LOG_CHARS)
                .collect::<String>()
        ),
        true,
    )
}

fn git_args(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

fn non_empty(value: &str) -> Option<String> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value.trim().to_string())
    }
}
