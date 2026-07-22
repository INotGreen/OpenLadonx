//! Tailscale 集成模块。
//!
//! 本模块负责与 Tailscale 守护进程进行交互，包括：
//! - 检测系统中 Tailscale CLI 的安装位置和版本
//! - 启动、停止和监控 Tailscale TCP 守护进程
//! - 通过 RPC 客户端与守护进程通信
//! - 在所有桌面平台上管理 Tailscale 网络连接状态
//!
//! 主要入口点是通过 Tauri 命令暴露给前端的 `tailscale_status`、
//! `tailscale_daemon_start`、`tailscale_daemon_stop` 和 `tailscale_daemon_status`。

mod core;
mod daemon_commands;
mod rpc_client;

use std::ffi::{OsStr, OsString};
use std::io::ErrorKind;
use std::process::Output;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::TcpStream;
use tokio::time::{sleep, timeout, Instant};

use crate::daemon_binary::resolve_daemon_binary_path;
use crate::shared::process_core::{kill_child_process_tree, tokio_command};
use crate::state::{AppState, TcpDaemonRuntime};
use crate::types::{
    TailscaleDaemonCommandPreview, TailscaleStatus, TcpDaemonState, TcpDaemonStatus,
};

use self::core as tailscale_core;

/// 当平台为 Android 或 iOS 时显示的不支持提示信息。
/// Tailscale 集成仅适用于桌面平台。
#[cfg(any(target_os = "android", target_os = "ios"))]
const UNSUPPORTED_MESSAGE: &str = "Tailscale integration is only available on desktop.";

/// 为 Tailscale 命令设置必要的环境变量。
///
/// 在 macOS 上，从 GUI 启动的应用程序通常缺少 TERM 环境变量，
/// 这会导致 Tailscale 二进制文件因 CLIError 3 而失败。
/// 此函数强制设置一个合理的终端类型来避免该问题。
fn apply_tailscale_command_env(command: &mut tokio::process::Command) {
    #[cfg(target_os = "macos")]
    {
        // 从 GUI 启动的 release 应用可能缺少 TERM 环境变量，
        // 导致应用内 Tailscale 二进制文件报 CLIError 3。强制设置一个合理的终端类型。
        let term = std::env::var("TERM").unwrap_or_else(|_| "xterm-256color".to_string());
        command.env("TERM", term);
    }
}

/// 创建直接调用 Tailscale 二进制文件的命令，不通过 launchctl 包装。
/// 适用于非 macOS 平台，以及 macOS 上 launchctl 方式失败时的回退方案。
fn direct_tailscale_command(binary: &OsStr) -> tokio::process::Command {
    let mut command = tokio_command(binary);
    apply_tailscale_command_env(&mut command);
    command
}

/// 在 macOS 上，通过 `launchctl asuser` 以当前用户身份运行 Tailscale 命令。
/// 这是必需的，因为 Tauri 应用进程可能以不同的有效用户 ID 运行，
/// 而 Tailscale 需要以登录用户的身份执行才能访问其密钥链和网络配置。
#[cfg(target_os = "macos")]
fn tailscale_command(binary: &OsStr) -> tokio::process::Command {
    let mut command = tokio_command("/bin/launchctl");
    let uid = unsafe { libc::geteuid() };
    command.arg("asuser").arg(uid.to_string()).arg(binary);
    apply_tailscale_command_env(&mut command);
    command
}

/// 非 macOS 平台直接调用 Tailscale 二进制文件，无需 launchctl 包装。
#[cfg(not(target_os = "macos"))]
fn tailscale_command(binary: &OsStr) -> tokio::process::Command {
    direct_tailscale_command(binary)
}

/// 获取 Tailscale 命令的输出。
///
/// 在 macOS 上，优先通过 `launchctl` 运行；如果 launchctl 方式失败，
/// 则回退到直接调用二进制文件。这提供了双重保障以确保命令能成功执行。
#[cfg(target_os = "macos")]
async fn tailscale_output(binary: &OsStr, args: &[&str]) -> std::io::Result<Output> {
    let primary = tailscale_command(binary).args(args).output().await;
    match primary {
        // 主路径成功，直接返回结果
        Ok(output) if output.status.success() => Ok(output),
        // 主路径失败（非零退出码），尝试直接调用作为回退
        Ok(output) => match direct_tailscale_command(binary).args(args).output().await {
            Ok(fallback) if fallback.status.success() => Ok(fallback),
            Ok(_) => Ok(output),  // 回退也失败，返回主路径的结果用于诊断
            Err(_) => Ok(output), // 回退发生 IO 错误，返回主路径结果
        },
        // 主路径发生 IO 错误，尝试直接调用作为回退
        Err(primary_err) => match direct_tailscale_command(binary).args(args).output().await {
            Ok(fallback) => Ok(fallback),
            Err(_) => Err(primary_err), // 两种方式均失败，返回原始错误
        },
    }
}

/// 非 macOS 平台直接运行命令获取输出，无需回退逻辑。
#[cfg(not(target_os = "macos"))]
async fn tailscale_output(binary: &OsStr, args: &[&str]) -> std::io::Result<Output> {
    tailscale_command(binary).args(args).output().await
}

/// 去除字符串两端的空白字符，如果结果为空字符串则返回 `None`。
/// 用于标准化命令输出中的文本字段。
fn trim_to_non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(str::to_string)
}

/// 将字符串截断到指定字符数，如果被截断则在末尾追加省略号（…）。
///
/// 使用字符级迭代（而非字节索引）以避免在多字节 UTF-8 边界处截断导致 panic。
fn truncate_preview(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let preview: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{preview}…")
    } else {
        preview
    }
}

/// 返回所有可能找到 Tailscale 二进制文件的候选路径列表。
///
/// 搜索顺序从最常见的开始（PATH 中的 `tailscale`），
/// 然后依次尝试各个平台的特定安装位置。
fn tailscale_binary_candidates() -> Vec<OsString> {
    let mut candidates = vec![OsString::from("tailscale")];

    // macOS 候选路径：Homebrew、系统级安装、App Bundle 内部
    #[cfg(target_os = "macos")]
    {
        candidates.push(OsString::from("/opt/homebrew/bin/tailscale"));
        candidates.push(OsString::from("/usr/local/bin/tailscale"));
        candidates.push(OsString::from("/usr/local/bin/Tailscale"));
        candidates.push(OsString::from(
            "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        ));
        candidates.push(OsString::from(
            "/Applications/Tailscale.app/Contents/MacOS/tailscale",
        ));
    }

    // Linux 候选路径：各种发行版的常见安装位置
    #[cfg(target_os = "linux")]
    {
        candidates.push(OsString::from("/usr/bin/tailscale"));
        candidates.push(OsString::from("/usr/sbin/tailscale"));
        candidates.push(OsString::from("/usr/local/bin/tailscale"));
        candidates.push(OsString::from("/run/current-system/sw/bin/tailscale"));
        candidates.push(OsString::from("/snap/bin/tailscale"));
    }

    // Windows 候选路径：标准 Program Files 目录
    #[cfg(target_os = "windows")]
    {
        candidates.push(OsString::from(
            "C:\\Program Files\\Tailscale\\tailscale.exe",
        ));
        candidates.push(OsString::from(
            "C:\\Program Files (x86)\\Tailscale\\tailscale.exe",
        ));
    }

    candidates
}

/// 返回描述 Tailscale CLI 未找到的提示信息，包含平台特定的安装路径参考。
fn missing_tailscale_message() -> String {
    #[cfg(target_os = "macos")]
    {
        return "Tailscale CLI not found on PATH or standard install paths (including /Applications/Tailscale.app/Contents/MacOS/Tailscale).".to_string();
    }
    #[cfg(not(target_os = "macos"))]
    {
        "Tailscale CLI not found on PATH or standard install paths.".to_string()
    }
}

/// 检查标准输出内容是否看起来像 Tailscale 的版本输���。
///
/// 通过查找版本号格式的 token（如 "1.94.2"）来进行启发式检测，
/// 以区分真实的 Tailscale 输出和 GUI 错误消息（如 CLIError 3）。
fn looks_like_tailscale_version(stdout: &str) -> bool {
    /// 判断单个 token 是否匹配版本号格式（至少 X.Y 两位数字）。
    /// 支持带有 "v" 前缀和连字符后缀的格式（如 "v1.94.2-t123"）。
    fn is_version_token(token: &str) -> bool {
        let trimmed = token.trim().trim_start_matches('v'); // 去除可选的 "v" 前缀
        let core = trimmed
            .split_once('-') // 去除可选的后缀（如 commit hash）
            .map(|(value, _)| value)
            .unwrap_or(trimmed);
        let parts = core.split('.');
        let mut count = 0usize;
        for part in parts {
            if part.is_empty() || !part.chars().all(|ch| ch.is_ascii_digit()) {
                return false;
            }
            count += 1;
        }
        count >= 2 // 至少需要两个数字段（如 major.minor）
    }

    // 按空白字符和常见标点分割输入，然后检查每个 token
    stdout
        .split(|ch: char| ch.is_whitespace() || matches!(ch, ',' | ':' | '(' | ')' | ';'))
        .any(is_version_token)
}

/// 在候选路径中依次尝试查找可工作的 Tailscale 二进制文件。
///
/// 对每个候选路径运行 `tailscale version` 命令，
/// 通过检查退出码和输出格式来验证二进制文件是否正确。
/// 返回第一个验证通过的二进制文件路径和版本输出。
async fn resolve_tailscale_binary() -> Result<Option<(OsString, Output)>, String> {
    let mut failures: Vec<String> = Vec::new();
    for binary in tailscale_binary_candidates() {
        let output = tailscale_output(binary.as_os_str(), &["version"]).await;
        match output {
            Ok(version_output) => {
                let stdout = trim_to_non_empty(std::str::from_utf8(&version_output.stdout).ok());
                let stderr = trim_to_non_empty(std::str::from_utf8(&version_output.stderr).ok());
                // 验证退出码成功且输出内容像 Tailscale 版本信息
                if version_output.status.success()
                    && stdout.as_deref().is_some_and(looks_like_tailscale_version)
                {
                    return Ok(Some((binary, version_output)));
                }
                // 记录失败详情以便后续诊断
                let detail = match (stdout, stderr) {
                    (Some(out), Some(err)) => format!("stdout: {out}; stderr: {err}"),
                    (Some(out), None) => format!("stdout: {out}"),
                    (None, Some(err)) => format!("stderr: {err}"),
                    (None, None) => "no output".to_string(),
                };
                failures.push(format!(
                    "{}: tailscale version failed or returned unexpected output ({detail})",
                    OsStr::new(&binary).to_string_lossy()
                ));
            }
            Err(err) if err.kind() == ErrorKind::NotFound => continue, // 文件不存在，静默跳过
            Err(err) => failures.push(format!("{}: {err}", OsStr::new(&binary).to_string_lossy())),
        }
    }

    if failures.is_empty() {
        Ok(None) // 没有找到二进制文件，也没有错误
    } else {
        Err(format!(
            "Failed to run tailscale version from candidate paths: {}",
            failures.join(" | ")
        ))
    }
}

/// 构建一个降级的 Tailscale 状态对象，表示已安装但未正常运行。
///
/// 当 Tailscale CLI 存在但状态查询失败时使用此函数，
/// 前端可以根据 `running` 字段做出相应的 UI 提示。
fn degraded_tailscale_status(version: Option<String>, message: String) -> TailscaleStatus {
    TailscaleStatus {
        installed: true,
        running: false,
        version,
        dns_name: None,
        host_name: None,
        tailnet_name: None,
        ipv4: Vec::new(),
        ipv6: Vec::new(),
        suggested_remote_host: None,
        message,
    }
}

/// 获取当前的 Unix 毫秒时间戳。
/// 用于记录守护进程的启动时间。
fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// 从远程主机地址字符串中解析出端口号。
///
/// 支持两种格式：
/// - 完整的 SocketAddr（如 "100.100.100.1:4732" 或 "[::1]:8080"）
/// - 简单的 host:port 格式（如 "example.ts.net:8888"）
fn parse_port_from_remote_host(remote_host: &str) -> Option<u16> {
    if remote_host.trim().is_empty() {
        return None;
    }
    // 尝试作为标准 SocketAddr 解析
    if let Ok(addr) = remote_host.trim().parse::<std::net::SocketAddr>() {
        return Some(addr.port());
    }
    // 回退：取最后一个冒号后的部分作为端口号
    remote_host
        .trim()
        .rsplit_once(':')
        .and_then(|(_, port)| port.parse::<u16>().ok())
}

/// 根据远程主机配置生成守护进程的监听地址。
/// 提取端口号，如果解析失败则使用默认端口 4732。
fn daemon_listen_addr(remote_host: &str) -> String {
    let port = parse_port_from_remote_host(remote_host).unwrap_or(4732);
    format!("0.0.0.0:{port}")
}

/// 将监听地址转换为本地回环连接地址。
/// 从 "0.0.0.0:PORT" 格式转换为 "127.0.0.1:PORT"。
fn daemon_connect_addr(listen_addr: &str) -> Option<String> {
    let port = parse_port_from_remote_host(listen_addr)?;
    Some(format!("127.0.0.1:{port}"))
}

/// 从应用设置中读取配置的守护进程监听地址。
fn configured_daemon_listen_addr(settings: &crate::types::AppSettings) -> String {
    daemon_listen_addr(&settings.remote_backend_host)
}

/// 同步 TCP 守护进程的监听地址状态。
///
/// 如果守护进程正在运行且已有监听地址，则保持不变（避免覆盖运行时状态）。
/// 否则，更新为配置的监听地址值。
fn sync_tcp_daemon_listen_addr(status: &mut TcpDaemonStatus, configured_listen_addr: &str) {
    // 运行中的守护进程已经绑定了端口，不应覆盖其监听地址
    if matches!(status.state, TcpDaemonState::Running) && status.listen_addr.is_some() {
        return;
    }
    status.listen_addr = Some(configured_listen_addr.to_string());
}

/// 检查监听地址是否可用（端口未被占用）。
/// 通过尝试绑定端口来验证，绑定后立即释放。
async fn ensure_listen_addr_available(listen_addr: &str) -> Result<(), String> {
    match tokio::net::TcpListener::bind(listen_addr).await {
        Ok(listener) => {
            drop(listener); // 立即释放端口，仅用于检测
            Ok(())
        }
        Err(err) => Err(format!(
            "Cannot start mobile access daemon because {listen_addr} is unavailable: {err}"
        )),
    }
}

/// 刷新 TCP 守护进程的运行时状态。
///
/// 通过 `try_wait()` 非阻塞地检查子进程状态：
/// - 如果进程已退出，根据退出码判断是正常停止还是错误
/// - 退出码 101 通常表示 Rust panic，常见于端口被占用
/// - 如果进程仍在运行，更新为 Running 状态
async fn refresh_tcp_daemon_runtime(runtime: &mut TcpDaemonRuntime) {
    let Some(child) = runtime.child.as_mut() else {
        // 没有子进程存在，标记为已停止
        runtime.status.state = TcpDaemonState::Stopped;
        runtime.status.pid = None;
        return;
    };

    match child.try_wait() {
        Ok(Some(status)) => {
            // 子进程已退出
            let pid = child.id();
            runtime.child = None; // 已退出，清除子进程句柄
            if status.success() {
                runtime.status = TcpDaemonStatus {
                    state: TcpDaemonState::Stopped,
                    pid,
                    started_at_ms: None,
                    last_error: None,
                    listen_addr: runtime.status.listen_addr.clone(),
                };
            } else {
                // 退出码 101 是 Rust panic 的典型退出码，
                // 通常由端口被占用等启动失败原因引起
                let failure_hint = if status.code() == Some(101) {
                    " This usually indicates a startup panic (often due to an unavailable listen port)."
                } else {
                    ""
                };
                runtime.status = TcpDaemonStatus {
                    state: TcpDaemonState::Error,
                    pid,
                    started_at_ms: runtime.status.started_at_ms,
                    last_error: Some(format!(
                        "Daemon exited with status: {status}.{failure_hint}"
                    )),
                    listen_addr: runtime.status.listen_addr.clone(),
                };
            }
        }
        Ok(None) => {
            // 子进程仍在运行
            runtime.status.state = TcpDaemonState::Running;
            runtime.status.pid = child.id();
            runtime.status.last_error = None;
        }
        Err(err) => {
            // 无法检查子进程状态（系统级错误）
            runtime.status = TcpDaemonStatus {
                state: TcpDaemonState::Error,
                pid: child.id(),
                started_at_ms: runtime.status.started_at_ms,
                last_error: Some(format!("Failed to inspect daemon process: {err}")),
                listen_addr: runtime.status.listen_addr.clone(),
            };
        }
    }
}

/// 在 Unix 系统上通过发送空信号（signal 0）检查进程是否存在。
///
/// `kill(pid, 0)` 不会向进程发送实际信号，仅检查权限和进程存在性。
/// 返回 true 表示进程存在，false 表示进程不存在（ESRCH）。
#[cfg(unix)]
fn is_pid_running(pid: u32) -> bool {
    let result = unsafe { libc::kill(pid as i32, 0) };
    if result == 0 {
        return true; // 进程存在且有权限发送信号
    }
    match std::io::Error::last_os_error().raw_os_error() {
        Some(code) => code != libc::ESRCH, // 非 ESRCH 的错误码（如 EPERM）表示进程存在
        None => false,
    }
}

/// 在 Unix 系统上通过 `lsof` 查找监听指定端口的进程 PID。
///
/// 用于检测是否有守护进程已在目标端口上监听，
/// 以便在启动新守护进程前进行冲突检测或复用已有实例。
#[cfg(unix)]
async fn find_listener_pid(port: u16) -> Option<u32> {
    let target = format!(":{port}");
    let output = match tokio_command("lsof")
        .args(["-nP", "-iTCP"]) // 不解析主机名，显示数字端口
        .arg(&target) // 过滤指定端口
        .args(["-sTCP:LISTEN", "-t"]) // 仅监听状态的 TCP 连接，简洁输出 PID
        .output()
        .await
    {
        Ok(output) => output,
        Err(err) if err.kind() == ErrorKind::NotFound => return None, // lsof 未安装
        Err(_) => return None,
    };

    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        // lsof 在无匹配时返回退出码 1 且无输出，这是正常情况
        if output.status.code() == Some(1) && stdout.trim().is_empty() && stderr.trim().is_empty() {
            return None;
        }
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .find_map(|line| line.trim().parse::<u32>().ok())
}

/// 优雅地终止 Unix 进程，先尝试 SIGTERM 再尝试 SIGKILL。
///
/// 终止策略：
/// 1. 发送 SIGTERM，等待最多 1.2 秒（12 * 100ms）
/// 2. 如果进程仍未退出，发送 SIGKILL 强制终止
/// 3. 再等待最多 800ms（8 * 100ms）
/// 4. 如果进程仍然存活，返回错误
#[cfg(unix)]
async fn kill_pid_gracefully(pid: u32) -> Result<(), String> {
    // 第一步：发送 SIGTERM 请求优雅退出
    let term_result = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
    if term_result != 0 {
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() != Some(libc::ESRCH) {
            return Err(format!("Failed to stop daemon process {pid}: {err}"));
        }
        return Ok(()); // 进程已不存在，无需终止
    }

    // 等待进程响应 SIGTERM（最多 1.2 秒）
    for _ in 0..12 {
        if !is_pid_running(pid) {
            return Ok(());
        }
        sleep(Duration::from_millis(100)).await;
    }

    // 第二步：SIGTERM 无效，发送 SIGKILL 强制终止
    let kill_result = unsafe { libc::kill(pid as i32, libc::SIGKILL) };
    if kill_result != 0 {
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() != Some(libc::ESRCH) {
            return Err(format!("Failed to force-stop daemon process {pid}: {err}"));
        }
    }

    // 等待 SIGKILL 生效（最多 800ms）
    for _ in 0..8 {
        if !is_pid_running(pid) {
            return Ok(());
        }
        sleep(Duration::from_millis(100)).await;
    }

    Err(format!("Daemon process {pid} is still running."))
}

/// 非 Unix 平台的占位实现，不支持通过 PID 查找监听者。
#[cfg(not(unix))]
async fn find_listener_pid(_port: u16) -> Option<u32> {
    None
}

/// 非 Unix 平台的占位实现，不支持通过 PID 终止进程。
#[cfg(not(unix))]
async fn kill_pid_gracefully(_pid: u32) -> Result<(), String> {
    Err("Stopping external daemon by pid is not supported on this platform.".to_string())
}

/// Tauri 命令：查询 Tailscale 的完整状态。
///
/// 此命令执行以下步骤：
/// 1. 在系统中查找可工作的 Tailscale 二进制文件并获取版本
/// 2. 运行 `tailscale status --json` 获取当前网络状态
/// 3. 解析 JSON 输出为结构化状态对象
///
/// 每个步骤都有完善的错误处理，在失败时返回降级的状态信息，
/// 帮助前端诊断问题。
#[tauri::command]
pub(crate) async fn tailscale_status() -> Result<TailscaleStatus, String> {
    // 移动平台不支持 Tailscale 集成
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        return Ok(tailscale_core::unavailable_status(
            None,
            UNSUPPORTED_MESSAGE.to_string(),
        ));
    }

    // 步骤 1：解析 Tailscale 二进制文件路径并获取版本信息
    let resolved_tailscale_binary = match resolve_tailscale_binary().await {
        Ok(result) => result,
        Err(err) => {
            return Ok(degraded_tailscale_status(None, err));
        }
    };
    let Some((tailscale_binary, version_output)) = resolved_tailscale_binary else {
        return Ok(tailscale_core::unavailable_status(
            None,
            missing_tailscale_message(),
        ));
    };

    // 从版本输出中提取版本号（取第一行）
    let version = trim_to_non_empty(std::str::from_utf8(&version_output.stdout).ok())
        .and_then(|raw| raw.lines().next().map(str::trim).map(str::to_string));

    // 步骤 2：获取 Tailscale 状态 JSON
    let status_output =
        match tailscale_output(tailscale_binary.as_os_str(), &["status", "--json"]).await {
            Ok(output) => output,
            Err(err) => {
                return Ok(degraded_tailscale_status(
                    version,
                    format!("Failed to run tailscale status --json: {err}"),
                ));
            }
        };

    // 步骤 3：处理非零退出码的情况
    if !status_output.status.success() {
        let stderr_text = trim_to_non_empty(std::str::from_utf8(&status_output.stderr).ok())
            .unwrap_or_else(|| "tailscale status returned a non-zero exit code.".to_string());
        return Ok(TailscaleStatus {
            installed: true,
            running: false,
            version,
            dns_name: None,
            host_name: None,
            tailnet_name: None,
            ipv4: Vec::new(),
            ipv6: Vec::new(),
            suggested_remote_host: None,
            message: stderr_text,
        });
    }

    // 验证输出是否为有效 UTF-8
    let payload = match std::str::from_utf8(&status_output.stdout) {
        Ok(value) => value,
        Err(err) => {
            return Ok(degraded_tailscale_status(
                version,
                format!("Invalid UTF-8 from tailscale status: {err}"),
            ));
        }
    };
    let stderr_text = trim_to_non_empty(std::str::from_utf8(&status_output.stderr).ok());
    if payload.trim().is_empty() {
        let suffix = stderr_text
            .as_deref()
            .map(|value| format!(" stderr: {value}"))
            .unwrap_or_default();
        return Ok(degraded_tailscale_status(
            version,
            format!("tailscale status --json returned empty output.{suffix}"),
        ));
    }
    // 步骤 4：解析 JSON 为结构化状态
    match tailscale_core::status_from_json(version.clone(), payload) {
        Ok(status) => Ok(status),
        Err(err) => {
            // 解析失败时提供详细的诊断信息，包含输出预览
            let trimmed_payload = payload.trim();
            let payload_preview = if trimmed_payload.is_empty() {
                None
            } else {
                Some(truncate_preview(trimmed_payload, 200))
            };
            let mut details = Vec::new();
            if let Some(stderr) = stderr_text {
                details.push(format!("stderr: {stderr}"));
            }
            if let Some(preview) = payload_preview {
                details.push(format!("stdout: {preview}"));
            }
            if details.is_empty() {
                Ok(degraded_tailscale_status(version, err))
            } else {
                Ok(degraded_tailscale_status(
                    version,
                    format!("{err} ({})", details.join("; ")),
                ))
            }
        }
    }
}

/// Tauri 命令：预览启动 Tailscale 守护进程时将使用的命令。
/// 用于在前端显示将要执行的命令，方便调试和确认。
#[tauri::command]
pub(crate) async fn tailscale_daemon_command_preview(
    state: State<'_, AppState>,
) -> Result<TailscaleDaemonCommandPreview, String> {
    daemon_commands::tailscale_daemon_command_preview(state).await
}

/// Tauri 命令：启动 Tailscale TCP 守护进程。
/// 委托给 `daemon_commands` 模块处理实际的启动逻辑。
#[tauri::command]
pub(crate) async fn tailscale_daemon_start(
    state: State<'_, AppState>,
) -> Result<TcpDaemonStatus, String> {
    daemon_commands::tailscale_daemon_start(state).await
}

/// Tauri 命令：停止 Tailscale TCP 守护进程。
/// 委托给 `daemon_commands` 模块处理实际的停止逻辑。
#[tauri::command]
pub(crate) async fn tailscale_daemon_stop(
    state: State<'_, AppState>,
) -> Result<TcpDaemonStatus, String> {
    daemon_commands::tailscale_daemon_stop(state).await
}

/// Tauri 命令：查询 Tailscale TCP 守护进程的当前状态。
/// 委托给 `daemon_commands` 模块处理实际的状态查询。
#[tauri::command]
pub(crate) async fn tailscale_daemon_status(
    state: State<'_, AppState>,
) -> Result<TcpDaemonStatus, String> {
    daemon_commands::tailscale_daemon_status(state).await
}
