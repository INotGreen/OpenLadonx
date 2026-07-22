#[cfg(desktop)]
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
#[cfg(desktop)]
use tauri::RunEvent;
#[cfg(target_os = "macos")]
use tauri::WindowEvent;
#[cfg(desktop)]
use tauri::{WebviewUrl, WebviewWindowBuilder};

mod app_update;
mod backend;
mod browser_preview;
mod bundled_cli;
mod claudecode;
mod clipboard;
mod codex;
mod daemon_binary;
mod dictation;
mod event_sink;
mod files;
mod git;
mod git_utils;
mod ladonx_auth;
mod local_usage;
#[cfg(desktop)]
mod menu;
#[cfg(not(desktop))]
#[path = "menu_mobile.rs"]
mod menu;
mod notifications;
mod prompts;
mod remote_backend;
mod rules;
mod self_update_helper;
mod settings;
mod settings_commands;
mod shared;
mod startup_log;
mod state;
mod storage;
mod tailscale;
#[cfg(desktop)]
mod terminal;
#[cfg(not(desktop))]
#[path = "terminal_mobile.rs"]
mod terminal;
mod tray;
mod types;
mod utils;
mod window;
mod workspaces;

#[cfg(desktop)]
static EXIT_CLEANUP_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

#[cfg(desktop)]
fn keep_daemon_running_after_close(app_handle: &tauri::AppHandle) -> bool {
    let state = app_handle.state::<state::AppState>();
    tauri::async_runtime::block_on(async {
        state
            .app_settings
            .lock()
            .await
            .keep_daemon_running_after_app_close
    })
}

#[cfg(desktop)]
async fn stop_managed_daemons_for_exit(app_handle: tauri::AppHandle) {
    let state = app_handle.state::<state::AppState>();
    let _ = tailscale::tailscale_daemon_stop(state).await;
}

#[tauri::command]
fn is_mobile_runtime() -> bool {
    cfg!(any(target_os = "ios", target_os = "android"))
}

pub(crate) fn relaunch_current_app(app: &tauri::AppHandle) -> Result<(), String> {
    let exe_path = std::env::current_exe()
        .map_err(|error| format!("Failed to resolve current executable: {error}"))?;
    startup_log::write(format!("app_relaunch: spawning {}", exe_path.display()));
    shared::process_core::detached_std_command(&exe_path)
        .spawn()
        .map_err(|error| format!("Failed to relaunch app: {error}"))?;
    startup_log::write("app_relaunch: exiting current process");
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn app_relaunch(app: tauri::AppHandle) -> Result<(), String> {
    relaunch_current_app(&app)
}

#[tauri::command]
fn open_wechat_auth_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("wechat-auth") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, "wechat-auth", WebviewUrl::App("index.html".into()))
        .title("LadonX 登录")
        .inner_size(420.0, 640.0)
        .min_inner_size(360.0, 560.0)
        .resizable(false)
        .center()
        .build()
        .map_err(|error| format!("Failed to open WeChat auth window: {error}"))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    startup_log::write("lib: run entered");
    #[cfg(target_os = "linux")]
    {
        // Avoid WebKit compositing issues on NVIDIA Linux setups (GBM buffer errors).
        if std::env::var_os("__NV_PRIME_RENDER_OFFLOAD").is_none() {
            std::env::set_var("__NV_PRIME_RENDER_OFFLOAD", "1");
        }
        let is_wayland = std::env::var("XDG_SESSION_TYPE")
            .map(|session| session.eq_ignore_ascii_case("wayland"))
            .unwrap_or(false)
            || std::env::var_os("WAYLAND_DISPLAY").is_some();
        let has_nvidia = std::path::Path::new("/proc/driver/nvidia/version").exists();
        if is_wayland && has_nvidia && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none()
        {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        let is_x11 = !is_wayland && std::env::var_os("DISPLAY").is_some();
        // Work around sporadic blank WebKitGTK renders on X11 by disabling compositing mode.
        // Keep Wayland untouched because this can interfere with input behavior on some setups.
        if is_x11 && std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
    }

    #[cfg(desktop)]
    let builder = tauri::Builder::default()
        .manage(menu::MenuItemRegistry::<tauri::Wry>::default())
        .manage(tray::TrayState::default())
        .on_menu_event(menu::handle_menu_event)
        .enable_macos_default_menu(false)
        .menu(menu::build_menu);

    #[cfg(not(desktop))]
    let builder = tauri::Builder::default();

    let builder = builder
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            #[cfg(target_os = "macos")]
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            startup_log::write("setup: entered");
            startup_log::write("setup: migrating legacy tool homes");
            if let Err(error) = settings::migrate_legacy_tool_homes_to_ladonx_home() {
                startup_log::write(format!(
                    "setup: failed to migrate legacy tool homes: {error}"
                ));
            } else {
                startup_log::write("setup: migrated legacy tool homes");
            }
            settings::apply_claude_home_env();
            #[cfg(any(target_os = "windows", target_os = "macos"))]
            {
                startup_log::write("setup: ensuring bundled cli");
                let _ = bundled_cli::ensure_bundled_cli();
                startup_log::write("setup: ensuring bundled claude");
                let _ = bundled_cli::ensure_bundled_claude();
                startup_log::write("setup: ensuring bundled rg");
                let _ = bundled_cli::ensure_bundled_rg();
            }

            startup_log::write("setup: loading app state");
            let state = state::AppState::load(&app.handle());
            app.manage(state);
            #[cfg(target_os = "macos")]
            {
                let tray_state = app.state::<tray::TrayState>();
                tray::initialize(&app.handle(), tray_state.inner())?;
            }
            #[cfg(target_os = "windows")]
            {
                startup_log::write("setup: configuring windows main window");
                if let Err(error) = self_update_helper::cleanup_windows_backup_executables() {
                    startup_log::write(format!(
                        "setup: failed to cleanup windows update backups: {error}"
                    ));
                }
                if let Some(main_window) = app.get_webview_window("main") {
                    let _ = main_window.set_decorations(false);
                    // Keep menu accelerators wired while suppressing a visible native menu bar.
                    let _ = main_window.hide_menu();
                }
            }
            #[cfg(desktop)]
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let state = app_handle.state::<state::AppState>();
                    if let Err(error) =
                        ladonx_auth::sync_ladonx_auth_on_startup(state.inner()).await
                    {
                        startup_log::write(format!("setup: startup auth sync failed: {error}"));
                    } else {
                        startup_log::write("setup: startup auth sync completed");
                    }
                });
            }
            #[cfg(desktop)]
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // Auto-start the daemon on app launch
                    let state = app_handle.state::<state::AppState>();
                    let settings = state.app_settings.lock().await.clone();

                    // Only start if token is configured
                    if settings.remote_backend_token.is_some() {
                        println!("[LadonX] Auto-starting daemon with token...");
                        let result = tailscale::tailscale_daemon_start(state).await;
                        println!("[LadonX] Daemon auto-start result: {:?}", result);
                    } else {
                        println!("[LadonX] Skipping daemon auto-start: no token configured");
                    }
                });
            }
            #[cfg(target_os = "ios")]
            {
                if let Some(main_webview) = app.get_webview_window("main") {
                    let _ = window::configure_ios_webview_edge_to_edge(&main_webview);
                }
            }
            startup_log::write("setup: completed");
            Ok(())
        });

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    let app = builder
        .plugin(tauri_plugin_liquid_glass::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            settings_commands::get_app_settings,
            settings_commands::get_app_runtime_defaults,
            settings_commands::update_app_settings,
            settings_commands::get_codex_config_path,
            settings_commands::write_codex_base_url,
            settings_commands::apply_custom_response_api,
            settings_commands::apply_custom_messages_api,
            settings_commands::reveal_codex_config,
            settings_commands::read_codex_base_url,
            settings_commands::read_openai_api_key_env,
            settings_commands::read_anthropic_api_key_env,
            ladonx_auth::sync_ladonx_auth_env,
            ladonx_auth::apply_default_api_credentials,
            startup_log::startup_log_write,
            browser_preview::browser_preview_open,
            browser_preview::browser_preview_set_bounds,
            browser_preview::browser_preview_hide,
            browser_preview::browser_preview_close,
            browser_preview::browser_preview_close_with_prefix,
            clipboard::clipboard_file_paths,
            clipboard::clipboard_image_path,
            files::file_read,
            files::file_write,
            files::read_image_as_data_url,
            files::save_clipboard_image_data_url,
            files::read_binary_file,
            files::read_binary_file_path,
            files::write_text_file,
            files::read_text_file_path,
            codex::get_config_model,
            menu::menu_set_accelerators,
            tray::set_tray_recent_threads,
            tray::set_tray_session_usage,
            codex::codex_doctor,
            codex::codex_update,
            workspaces::list_workspaces,
            workspaces::list_directory_files,
            workspaces::current_workspace_path,
            workspaces::is_workspace_path_dir,
            workspaces::add_workspace,
            workspaces::add_workspace_from_git_url,
            workspaces::add_clone,
            workspaces::add_worktree,
            workspaces::worktree_setup_status,
            workspaces::worktree_setup_mark_ran,
            workspaces::remove_workspace,
            workspaces::remove_worktree,
            workspaces::rename_worktree,
            workspaces::rename_worktree_upstream,
            workspaces::apply_worktree_changes,
            workspaces::update_workspace_settings,
            workspaces::set_workspace_runtime_codex_args,
            codex::start_thread,
            codex::send_user_message,
            codex::turn_steer,
            codex::turn_interrupt,
            codex::start_review,
            codex::respond_to_server_request,
            codex::remember_approval_rule,
            codex::generate_commit_message,
            codex::generate_run_metadata,
            codex::generate_agent_description,
            codex::resume_thread,
            codex::read_thread,
            codex::thread_live_subscribe,
            codex::thread_live_unsubscribe,
            codex::fork_thread,
            codex::list_threads,
            codex::list_mcp_server_status,
            codex::archive_thread,
            codex::compact_thread,
            codex::set_thread_name,
            codex::collaboration_mode_list,
            workspaces::connect_workspace,
            git::get_git_status,
            git::init_git_repo,
            git::create_github_repo,
            git::list_git_roots,
            git::get_git_diffs,
            git::get_git_log,
            git::get_git_commit_diff,
            git::get_git_remote,
            git::stage_git_file,
            git::stage_git_all,
            git::unstage_git_file,
            git::revert_git_file,
            git::revert_git_all,
            git::commit_git,
            git::push_git,
            git::pull_git,
            git::fetch_git,
            git::sync_git,
            git::get_github_issues,
            git::get_github_pull_requests,
            git::get_github_pull_request_diff,
            git::get_github_pull_request_comments,
            git::checkout_github_pull_request,
            workspaces::list_workspace_files,
            workspaces::read_workspace_file,
            workspaces::open_workspace_in,
            workspaces::get_open_app_icon,
            git::list_git_branches,
            git::checkout_git_branch,
            git::create_git_branch,
            codex::model_list,
            codex::experimental_feature_list,
            codex::set_codex_feature_flag,
            codex::get_agents_settings,
            codex::set_agents_core_settings,
            codex::create_agent,
            codex::update_agent,
            codex::delete_agent,
            codex::read_agent_config_toml,
            codex::write_agent_config_toml,
            codex::install_plugin,
            codex::uninstall_plugin,
            codex::account_rate_limits,
            codex::account_read,
            codex::codex_login,
            codex::codex_login_cancel,
            ladonx_auth::ladonx_auth_login,
            ladonx_auth::ladonx_auth_wechat_login,
            ladonx_auth::ladonx_auth_wechat_cancel,
            ladonx_auth::ladonx_auth_register,
            ladonx_auth::ladonx_auth_status,
            ladonx_auth::ladonx_auth_logout,
            ladonx_auth::ladonx_user_usage_statistics,
            ladonx_auth::ladonx_user_subscriptions,
            ladonx_auth::ladonx_api_key_test,
            codex::skills_list,
            codex::automations_list,
            codex::apps_list,
            codex::plugins_marketplace_list,
            codex::configured_plugins_list,
            prompts::prompts_list,
            prompts::prompts_create,
            prompts::prompts_update,
            prompts::prompts_delete,
            prompts::prompts_move,
            prompts::prompts_workspace_dir,
            prompts::prompts_global_dir,
            terminal::terminal_open,
            claudecode::claude_code_paths,
            claudecode::claude_code_list_stored_chats,
            claudecode::claude_code_read_stored_chat,
            claudecode::claude_code_delete_stored_chat,
            claudecode::claude_code_set_stored_chat_title,
            claudecode::claude_code_prompt,
            claudecode::claude_code_stop,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
            app_update::app_update_platform_info,
            app_update::app_update_fetch_manifest,
            app_update::app_update_download_status,
            app_update::app_update_download,
            app_update::app_update_cancel_download,
            app_update::app_update_install_and_restart,
            dictation::dictation_model_status,
            dictation::dictation_download_model,
            dictation::dictation_cancel_download,
            dictation::dictation_remove_model,
            dictation::dictation_start,
            dictation::dictation_request_permission,
            dictation::dictation_stop,
            dictation::dictation_cancel,
            local_usage::local_usage_snapshot,
            notifications::is_macos_debug_build,
            notifications::app_build_type,
            notifications::send_notification_fallback,
            tailscale::tailscale_status,
            tailscale::tailscale_daemon_command_preview,
            tailscale::tailscale_daemon_start,
            tailscale::tailscale_daemon_stop,
            tailscale::tailscale_daemon_status,
            is_mobile_runtime,
            app_relaunch,
            open_wechat_auth_window
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    startup_log::write("lib: app built");
    app.run(|app_handle, event| {
        #[cfg(target_os = "windows")]
        match &event {
            RunEvent::Exit => startup_log::write("run event: Exit"),
            RunEvent::ExitRequested { .. } => startup_log::write("run event: ExitRequested"),
            _ => {}
        }
        #[cfg(desktop)]
        if let RunEvent::ExitRequested { api, .. } = event {
            if !EXIT_CLEANUP_IN_PROGRESS.load(Ordering::SeqCst)
                && !keep_daemon_running_after_close(app_handle)
            {
                api.prevent_exit();
                EXIT_CLEANUP_IN_PROGRESS.store(true, Ordering::SeqCst);
                let app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    stop_managed_daemons_for_exit(app_handle.clone()).await;
                    app_handle.exit(0);
                });
            }
            return;
        }

        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = event {
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    });
}
