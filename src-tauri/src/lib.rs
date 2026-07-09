mod commands;
mod git;
mod models;
mod store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(store::AppState::load())
        .invoke_handler(tauri::generate_handler![
            commands::list_fs,
            commands::pick_folder,
            commands::list_repos,
            commands::add_repo,
            commands::get_settings,
            commands::update_settings,
            commands::integrations,
            commands::diagnostics,
            commands::record_diagnostic_event,
            commands::repo_summary,
            commands::repo_worktrees,
            commands::repo_detail,
            commands::repo_review,
            commands::create_worktree,
            commands::remove_worktree,
            commands::handoff_worktree_to_local,
            commands::move_local_branch_to_worktree,
            commands::repo_branches,
            commands::create_branch,
            commands::checkout_branch,
            commands::delete_branch,
            commands::fetch_repo,
            commands::pull_repo,
            commands::open_path,
            commands::operations,
            commands::operation
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
