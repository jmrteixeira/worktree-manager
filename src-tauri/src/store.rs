use crate::models::{AppSettings, AppSettingsPatch, OperationRecord, RepoRecord};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use uuid::Uuid;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreData {
    repos: Vec<RepoRecord>,
    operations: Vec<OperationRecord>,
    #[serde(default)]
    settings: AppSettings,
}

pub struct AppState {
    state_file: PathBuf,
    data: Mutex<StoreData>,
    pub git_lock: Mutex<()>,
}

impl AppState {
    pub fn load() -> Self {
        let state_file = default_state_file();
        let data = read_state(&state_file)
            .or_else(|| {
                let legacy = legacy_state_file();
                let state = read_state(&legacy)?;
                let _ = write_state(&state_file, &state);
                Some(state)
            })
            .unwrap_or_default();

        Self {
            state_file,
            data: Mutex::new(data),
            git_lock: Mutex::new(()),
        }
    }

    pub fn state_file_path(&self) -> String {
        path_string(&self.state_file)
    }

    pub fn list_repos(&self) -> Vec<RepoRecord> {
        self.data
            .lock()
            .expect("store mutex poisoned")
            .repos
            .clone()
    }

    pub fn get_repo(&self, repo_id: &str) -> Option<RepoRecord> {
        self.data
            .lock()
            .expect("store mutex poisoned")
            .repos
            .iter()
            .find(|repo| repo.id == repo_id)
            .cloned()
    }

    pub fn upsert_repo(&self, repo_path: &Path) -> Result<RepoRecord, String> {
        let resolved = absolute_path(repo_path);
        let repo = RepoRecord {
            id: repo_id(&resolved),
            name: resolved
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| "Repositorio".to_string()),
            path: path_string(&resolved),
            last_opened_at: now_iso(),
        };

        let mut data = self.data.lock().expect("store mutex poisoned");
        data.repos.retain(|item| item.id != repo.id);
        data.repos.insert(0, repo.clone());
        data.repos.truncate(12);
        write_state(&self.state_file, &data)?;
        Ok(repo)
    }

    pub fn get_settings(&self) -> AppSettings {
        self.data
            .lock()
            .expect("store mutex poisoned")
            .settings
            .clone()
    }

    pub fn update_settings(&self, patch: AppSettingsPatch) -> Result<AppSettings, String> {
        let mut data = self.data.lock().expect("store mutex poisoned");
        if let Some(safe_mode) = patch.safe_mode {
            data.settings.safe_mode = safe_mode;
        }
        if let Some(locale) = patch.locale {
            data.settings.locale = locale;
        }
        if let Some(integrations) = patch.integrations {
            data.settings.integrations = integrations;
        }
        let settings = data.settings.clone();
        write_state(&self.state_file, &data)?;
        Ok(settings)
    }

    pub fn record_operation(&self, mut operation: OperationRecord) -> OperationRecord {
        operation.id = Uuid::new_v4().to_string();
        operation.finished_at = now_iso();

        let mut data = self.data.lock().expect("store mutex poisoned");
        data.operations.insert(0, operation);
        data.operations.truncate(60);
        let record = data.operations[0].clone();
        let _ = write_state(&self.state_file, &data);
        record
    }

    pub fn list_operations(&self) -> Vec<OperationRecord> {
        self.data
            .lock()
            .expect("store mutex poisoned")
            .operations
            .clone()
    }

    pub fn get_operation(&self, operation_id: &str) -> Option<OperationRecord> {
        self.data
            .lock()
            .expect("store mutex poisoned")
            .operations
            .iter()
            .find(|operation| operation.id == operation_id)
            .cloned()
    }
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn absolute_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}

pub fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn repo_id(path: &Path) -> String {
    let mut hasher = Sha1::new();
    hasher.update(path_string(path).as_bytes());
    let digest = hasher.finalize();
    digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn read_state(path: &Path) -> Option<StoreData> {
    let contents = fs::read_to_string(path).ok()?;
    let parsed = serde_json::from_str::<StoreData>(&contents).ok()?;
    Some(parsed)
}

fn write_state(path: &Path, state: &StoreData) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let temp_file = path.with_extension(format!(
        "json.{}.{}.tmp",
        std::process::id(),
        Utc::now().timestamp_millis()
    ));
    let contents = serde_json::to_string_pretty(state).map_err(|error| error.to_string())?;
    fs::write(&temp_file, contents).map_err(|error| error.to_string())?;
    fs::rename(&temp_file, path).map_err(|error| error.to_string())?;
    Ok(())
}

fn default_state_file() -> PathBuf {
    if let Ok(configured_dir) = env::var("WORKTREE_MANAGER_STATE_DIR") {
        if !configured_dir.trim().is_empty() {
            return PathBuf::from(configured_dir).join("state.json");
        }
    }

    if cfg!(target_os = "macos") {
        return home_dir()
            .join("Library")
            .join("Application Support")
            .join("Worktree Manager")
            .join("state.json");
    }

    if cfg!(target_os = "windows") {
        return PathBuf::from(
            env::var_os("APPDATA")
                .unwrap_or_else(|| home_dir().join("AppData").join("Roaming").into_os_string()),
        )
        .join("Worktree Manager")
        .join("state.json");
    }

    PathBuf::from(
        env::var_os("XDG_STATE_HOME")
            .unwrap_or_else(|| home_dir().join(".local").join("state").into_os_string()),
    )
    .join("worktree-manager")
    .join("state.json")
}

fn legacy_state_file() -> PathBuf {
    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".worktree-manager")
        .join("state.json")
}

fn home_dir() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
}
