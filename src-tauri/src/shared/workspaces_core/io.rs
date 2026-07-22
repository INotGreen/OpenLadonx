use std::collections::HashMap;
use std::env;
use std::path::{Path, PathBuf};

use tokio::sync::Mutex;

use crate::shared::process_core::tokio_command;
#[cfg(target_os = "windows")]
use crate::shared::process_core::{build_cmd_c_command, resolve_windows_executable};
use crate::types::WorkspaceEntry;
use crate::utils::normalize_windows_namespace_path;

use super::helpers::resolve_workspace_root;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LineAwareLaunchStrategy {
    GotoFlag,
    PathWithLineColumn,
}

fn normalize_open_location(line: Option<u32>, column: Option<u32>) -> Option<(u32, Option<u32>)> {
    let line = line.filter(|value| *value > 0)?;
    let column = column.filter(|value| *value > 0);
    Some((line, column))
}

fn format_path_with_location(path: &str, line: u32, column: Option<u32>) -> String {
    match column {
        Some(column) => format!("{path}:{line}:{column}"),
        None => format!("{path}:{line}"),
    }
}

fn command_identifier(command: &str) -> String {
    let trimmed = command.trim();
    let file_name = Path::new(trimmed)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(trimmed);
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(file_name);
    stem.trim().to_ascii_lowercase()
}

fn command_launch_strategy(command: &str) -> Option<LineAwareLaunchStrategy> {
    let identifier = command_identifier(command);
    if identifier == "code"
        || identifier == "code-insiders"
        || identifier == "cursor"
        || identifier == "cursor-insiders"
    {
        return Some(LineAwareLaunchStrategy::GotoFlag);
    }
    if identifier == "zed" || identifier == "zed-preview" {
        return Some(LineAwareLaunchStrategy::PathWithLineColumn);
    }
    None
}

fn app_launch_strategy(app: &str) -> Option<LineAwareLaunchStrategy> {
    let normalized = normalize_app_identifier(app);
    if normalized.contains("visual studio code") || normalized.starts_with("cursor") {
        return Some(LineAwareLaunchStrategy::GotoFlag);
    }
    if normalized == "zed" || normalized.starts_with("zed ") {
        return Some(LineAwareLaunchStrategy::PathWithLineColumn);
    }
    None
}

fn app_cli_command(app: &str) -> Option<&'static str> {
    let normalized = normalize_app_identifier(app);
    if normalized.contains("visual studio code insiders") {
        return Some("code-insiders");
    }
    if normalized.contains("visual studio code") {
        return Some("code");
    }
    if normalized.starts_with("cursor") {
        return Some("cursor");
    }
    if normalized == "zed" || normalized.starts_with("zed ") {
        return Some("zed");
    }
    None
}

fn normalize_app_identifier(app: &str) -> String {
    app.trim()
        .chars()
        .map(|value| {
            if value.is_ascii_alphanumeric() {
                value.to_ascii_lowercase()
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn find_executable_in_path(program: &str) -> Option<PathBuf> {
    let trimmed = program.trim();
    if trimmed.is_empty() {
        return None;
    }

    let path = PathBuf::from(trimmed);
    if path.is_file() {
        return Some(path);
    }

    let path_var = env::var_os("PATH")?;
    for dir in env::split_paths(&path_var) {
        let candidate = dir.join(trimmed);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

fn build_launch_args(
    path: &str,
    args: &[String],
    line: Option<u32>,
    column: Option<u32>,
    strategy: Option<LineAwareLaunchStrategy>,
) -> Vec<String> {
    let mut launch_args = args.to_vec();
    if let Some((line, column)) = normalize_open_location(line, column) {
        match strategy {
            Some(LineAwareLaunchStrategy::GotoFlag) => {
                let sanitized_path = normalize_windows_namespace_path(path);
                let located_path = format_path_with_location(&sanitized_path, line, column);
                launch_args.push("--goto".to_string());
                launch_args.push(located_path);
            }
            Some(LineAwareLaunchStrategy::PathWithLineColumn) => {
                let sanitized_path = normalize_windows_namespace_path(path);
                let located_path = format_path_with_location(&sanitized_path, line, column);
                launch_args.push(located_path);
            }
            None => {
                launch_args.push(path.to_string());
            }
        }
        return launch_args;
    }
    launch_args.push(path.to_string());
    launch_args
}

pub(crate) async fn open_workspace_in_core(
    path: String,
    app: Option<String>,
    args: Vec<String>,
    command: Option<String>,
    line: Option<u32>,
    column: Option<u32>,
) -> Result<(), String> {
    fn output_snippet(bytes: &[u8]) -> Option<String> {
        const MAX_CHARS: usize = 240;
        let text = String::from_utf8_lossy(bytes).trim().replace('\n', "\\n");
        if text.is_empty() {
            return None;
        }
        let mut chars = text.chars();
        let snippet: String = chars.by_ref().take(MAX_CHARS).collect();
        if chars.next().is_some() {
            Some(format!("{snippet}..."))
        } else {
            Some(snippet)
        }
    }

    let target_label = command
        .as_ref()
        .map(|value| format!("command `{value}`"))
        .or_else(|| app.as_ref().map(|value| format!("app `{value}`")))
        .unwrap_or_else(|| "target".to_string());

    let output = if let Some(command) = command {
        let trimmed = command.trim();
        if trimmed.is_empty() {
            return Err("Missing app or command".to_string());
        }
        let launch_args =
            build_launch_args(&path, &args, line, column, command_launch_strategy(trimmed));

        #[cfg(target_os = "windows")]
        let mut cmd = {
            let resolved = resolve_windows_executable(trimmed, None);
            let resolved_path = resolved.as_deref().unwrap_or_else(|| Path::new(trimmed));
            let ext = resolved_path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.to_ascii_lowercase());

            if matches!(ext.as_deref(), Some("cmd") | Some("bat")) {
                let mut cmd = tokio_command("cmd");
                let command_line = build_cmd_c_command(resolved_path, &launch_args)?;
                cmd.arg("/D");
                cmd.arg("/S");
                cmd.arg("/C");
                cmd.raw_arg(command_line);
                cmd
            } else {
                let mut cmd = tokio_command(resolved_path);
                cmd.args(&launch_args);
                cmd
            }
        };

        #[cfg(not(target_os = "windows"))]
        let mut cmd = {
            let mut cmd = tokio_command(trimmed);
            cmd.args(&launch_args);
            cmd
        };

        cmd.output()
            .await
            .map_err(|error| format!("Failed to open app ({target_label}): {error}"))?
    } else if let Some(app) = app {
        let trimmed = app.trim();
        if trimmed.is_empty() {
            return Err("Missing app or command".to_string());
        }
        let app_strategy = app_launch_strategy(trimmed);

        #[cfg(target_os = "macos")]
        {
            if let (Some(strategy), Some(cli_program)) = (
                app_strategy,
                normalize_open_location(line, column)
                    .and_then(|_| app_cli_command(trimmed))
                    .and_then(find_executable_in_path),
            ) {
                let launch_args = build_launch_args(&path, &args, line, column, Some(strategy));
                let mut cmd = tokio_command(cli_program);
                cmd.args(&launch_args);
                cmd.output()
                    .await
                    .map_err(|error| format!("Failed to open app ({target_label}): {error}"))?
            } else {
                let mut cmd = tokio_command("open");
                cmd.arg("-a").arg(trimmed).arg(&path);
                if !args.is_empty() {
                    cmd.arg("--args").args(&args);
                }
                cmd.output()
                    .await
                    .map_err(|error| format!("Failed to open app ({target_label}): {error}"))?
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            let launch_args = build_launch_args(&path, &args, line, column, app_strategy);
            let mut cmd = tokio_command(trimmed);
            cmd.args(&launch_args);
            cmd.output()
                .await
                .map_err(|error| format!("Failed to open app ({target_label}): {error}"))?
        }
    } else {
        return Err("Missing app or command".to_string());
    };

    if output.status.success() {
        return Ok(());
    }

    let exit_detail = output
        .status
        .code()
        .map(|code| format!("exit code {code}"))
        .unwrap_or_else(|| "terminated by signal".to_string());
    let mut details = Vec::new();
    if let Some(stderr) = output_snippet(&output.stderr) {
        details.push(format!("stderr: {stderr}"));
    }
    if let Some(stdout) = output_snippet(&output.stdout) {
        details.push(format!("stdout: {stdout}"));
    }

    if details.is_empty() {
        Err(format!(
            "Failed to open app ({target_label} returned {exit_detail})."
        ))
    } else {
        Err(format!(
            "Failed to open app ({target_label} returned {exit_detail}; {}).",
            details.join("; ")
        ))
    }
}

#[cfg(target_os = "macos")]
pub(crate) async fn get_open_app_icon_core<F>(
    app_name: String,
    icon_loader: F,
) -> Result<Option<String>, String>
where
    F: Fn(&str) -> Option<String> + Send + Sync + 'static,
{
    let trimmed = app_name.trim().to_string();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let icon_loader = std::sync::Arc::new(icon_loader);
    tokio::task::spawn_blocking(move || icon_loader(&trimmed))
        .await
        .map_err(|err| err.to_string())
}

#[cfg(not(target_os = "macos"))]
pub(crate) async fn get_open_app_icon_core<F>(
    app_name: String,
    icon_loader: F,
) -> Result<Option<String>, String>
where
    F: Fn(&str) -> Option<String> + Send + Sync + 'static,
{
    let _ = app_name;
    let _ = icon_loader;
    Ok(None)
}

pub(crate) async fn list_workspace_files_core<F>(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
    list_files: F,
) -> Result<Vec<String>, String>
where
    F: Fn(&PathBuf) -> Vec<String>,
{
    let root = resolve_workspace_root(workspaces, workspace_id).await?;
    Ok(list_files(&root))
}

pub(crate) async fn read_workspace_file_core<F, T>(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
    path: &str,
    read_file: F,
) -> Result<T, String>
where
    F: Fn(&PathBuf, &str) -> Result<T, String>,
{
    let root = resolve_workspace_root(workspaces, workspace_id).await?;
    read_file(&root, path)
}
