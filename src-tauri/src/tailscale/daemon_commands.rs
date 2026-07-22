//! Tailscale 守护进程管理命令。
//!
//! 本模块负责 TCP 守护进程的完整生命周期管理：
//! - 启动守护进程（包括端口检测、旧版本检测和自动重启）
//! - 停止守护进程（优雅关闭 + 强制终止回退）
//! - 状态查询（进程存活检测 + RPC 探活）
//! - 命令行预览（用于前端调试）
//!
//! 守护进程管理策略：
//! - 通过 RPC 探活确认守护进程身份（名称、版本、模式）
//! - 如果已有守护进程在运行但版本/模式不匹配，自动重启
//! - 如果运行的是非本应用管理的守护进程，拒绝强制终止

use super::rpc_client::{
    probe_daemon, request_daemon_shutdown, wait_for_daemon_shutdown, DaemonInfo, DaemonProbe,
};
use super::*;

/// 本应用期望的守护进程二进制文件名。
const EXPECTED_DAEMON_NAME: &str = "ladonx-daemon";

/// 守护进程的运行模式，必须为 "tcp"。
const EXPECTED_DAEMON_MODE: &str = "tcp";

/// 当前应用版本号，来自 Cargo.toml。
/// 用于与运行中的守护进程版本进行比较，以决定是否需要重启。
const CURRENT_APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// 检查守护进程是否为本应用管理的进程。
/// 通过对比名称来验证守护进程身份，防止误操作其他进程。
fn is_managed_daemon(info: &DaemonInfo) -> bool {
    info.name == EXPECTED_DAEMON_NAME
}

/// 判断是否有权限强制停止守护进程。
///
/// 强制停止的条件：
/// 1. RPC 认证通过（auth_ok），确保有权限控制该进程
/// 2. 守护进程身份匹配（is_managed_daemon），确保是本应用的进程
///
/// 这两个条件同时满足才能安全地执行 kill 操作。
fn can_force_stop_daemon(auth_ok: bool, info: Option<&DaemonInfo>) -> bool {
    auth_ok && info.is_some_and(is_managed_daemon)
}

/// 判断守护进程是否需要重启。
///
/// 需要重启的情况：
/// - 没有守护进程信息（报告异常）
/// - 守护进程不是本应用管理的（名称不匹配）
/// - 守护进程版本与当前应用版本不同
/// - 守护进程模式不是预期的 "tcp"
fn should_restart_daemon(info: Option<&DaemonInfo>) -> bool {
    let Some(info) = info else {
        return true; // 无法获取守护进程身份信息，需要重启
    };
    !is_managed_daemon(info)
        || info.version != CURRENT_APP_VERSION
        || info.mode != EXPECTED_DAEMON_MODE
}

/// 生成守护进程重启原因的描述信息。
///
/// 按优先级检查各种不匹配原因，返回最具体的描述。
fn daemon_restart_reason(info: Option<&DaemonInfo>) -> String {
    let Some(info) = info else {
        return "Daemon is running but did not report identity/version metadata".to_string();
    };
    if !is_managed_daemon(info) {
        return format!("Daemon identity mismatch (`{}`)", info.name);
    }
    if info.version != CURRENT_APP_VERSION {
        return format!(
            "Daemon version {} is different from app version {}",
            info.version, CURRENT_APP_VERSION
        );
    }
    if info.mode != EXPECTED_DAEMON_MODE {
        return format!(
            "Daemon mode `{}` does not match expected `{}`",
            info.mode, EXPECTED_DAEMON_MODE
        );
    }
    "Daemon restart required".to_string()
}

/// 解析守护进程的 PID。
///
/// 优先使用 RPC 报告的 PID（更可靠），
/// 如果不可用则通过 `lsof` 查找占用目标端口的进程。
async fn resolve_daemon_pid(listen_port: u16, info: Option<&DaemonInfo>) -> Option<u32> {
    match info.and_then(|entry| entry.pid) {
        Some(pid) => Some(pid),                       // 信任 RPC 报告的 PID
        None => find_listener_pid(listen_port).await, // 回退到 lsof 查找
    }
}

/// 生成守护进程启动命令的预览信息。
///
/// 将真实 token 替换为占位符以保护敏感信息，
/// 生成的命令字符串可在终端中直接粘贴执行。
pub(super) async fn tailscale_daemon_command_preview(
    state: State<'_, AppState>,
) -> Result<TailscaleDaemonCommandPreview, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        return Err(UNSUPPORTED_MESSAGE.to_string());
    }

    let daemon_path = resolve_daemon_binary_path()?;
    let data_dir = state
        .storage_path
        .parent()
        .map(|path| path.to_path_buf())
        .ok_or_else(|| "Unable to resolve app data directory".to_string())?;
    let settings = state.app_settings.lock().await.clone();
    // 检查 token 是否已配置（非空）
    let token_configured = settings
        .remote_backend_token
        .as_deref()
        .map(str::trim)
        .map(|value| !value.is_empty())
        .unwrap_or(false);

    Ok(tailscale_core::daemon_command_preview(
        &daemon_path,
        &data_dir,
        token_configured,
    ))
}

/// 启动 Tailscale TCP 守护进程。
///
/// 启动流程：
/// 1. 验证必要的配置（token、监听地址、二进制文件路径）
/// 2. 刷新当前守护进程的运行时状态
/// 3. 通过 RPC 探活检查是否已有守护进程在目标端口运行
/// 4. 如果已有守护进程，检查身份/版本匹配，必要时先停止旧进程
/// 5. 确保端口可用后，启动新守护进程
///
/// 安全性设计：
/// - 只有通过身份验证的守护进程才能被强制停止
/// - 如果端口被非本应用的进程占用，拒绝启动并提示用户
pub(super) async fn tailscale_daemon_start(
    state: State<'_, AppState>,
) -> Result<TcpDaemonStatus, String> {
    if cfg!(any(target_os = "android", target_os = "ios")) {
        return Err("Tailscale daemon start is only supported on desktop.".to_string());
    }

    // 步骤 1：获取并验证配置
    let settings = state.app_settings.lock().await.clone();
    let token = settings
        .remote_backend_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Set a Remote backend token before starting mobile access daemon.".to_string()
        })?;
    let listen_addr = configured_daemon_listen_addr(&settings);
    let listen_port = parse_port_from_remote_host(&listen_addr)
        .ok_or_else(|| format!("Invalid daemon listen address: {listen_addr}"))?;
    let daemon_binary = resolve_daemon_binary_path()?;

    let data_dir = state
        .storage_path
        .parent()
        .map(|path| path.to_path_buf())
        .ok_or_else(|| "Unable to resolve app data directory".to_string())?;

    // 步骤 2：刷新运行时状态并获取锁
    let mut runtime = state.tcp_daemon.lock().await;
    refresh_tcp_daemon_runtime(&mut runtime).await;

    // 步骤 3：通过 RPC 探活检查目标端口上的进程
    match probe_daemon(&listen_addr, Some(token)).await {
        // 情况 A：端口上已有进程在运行
        DaemonProbe::Running {
            auth_ok,
            auth_error,
            info,
        } => {
            let pid = resolve_daemon_pid(listen_port, info.as_ref()).await;
            let restart_required = should_restart_daemon(info.as_ref());
            let restart_reason = if restart_required {
                Some(daemon_restart_reason(info.as_ref()))
            } else {
                None
            };

            // 更新运行时状态为已运行（可能是本应用或其他方式启动的）
            runtime.child = None;
            runtime.status = TcpDaemonStatus {
                state: TcpDaemonState::Running,
                pid,
                started_at_ms: runtime.status.started_at_ms,
                last_error: auth_error.clone(),
                listen_addr: Some(listen_addr.clone()),
            };
            if !auth_ok {
                return Err(auth_error.unwrap_or_else(|| {
                    "Daemon is already running but authentication failed.".to_string()
                }));
            }
            // 版本匹配且无需重启，直接返回成功
            if !restart_required {
                return Ok(runtime.status.clone());
            }

            // 需要重启：先停止旧守护进程
            let force_kill_allowed = can_force_stop_daemon(auth_ok, info.as_ref());
            let pid_for_control = pid;
            // 尝试通过 RPC 请求优雅关闭
            if let Err(shutdown_error) = request_daemon_shutdown(&listen_addr, Some(token)).await {
                // RPC 关闭失败，需要根据权限决定是否强制终止
                if !force_kill_allowed {
                    return Err(format!(
                        "{}; automatic restart aborted because daemon ownership could not be verified: {}",
                        restart_reason.unwrap_or_else(|| "Daemon restart required".to_string()),
                        shutdown_error
                    ));
                }
                if let Some(pid) = pid_for_control {
                    kill_pid_gracefully(pid).await.map_err(|err| {
                        format!(
                            "{}; graceful shutdown failed ({shutdown_error}) and forced stop failed: {err}",
                            restart_reason
                                .clone()
                                .unwrap_or_else(|| "Daemon restart required".to_string())
                        )
                    })?;
                } else {
                    return Err(format!(
                        "{}; daemon did not stop and no PID could be resolved for safe forced stop ({shutdown_error})",
                        restart_reason.unwrap_or_else(|| "Daemon restart required".to_string())
                    ));
                }
            }

            // RPC 关闭成功（或已强制终止），等待守护进程真正退出
            if !wait_for_daemon_shutdown(&listen_addr, Some(token)).await {
                if !force_kill_allowed {
                    return Err(format!(
                        "{}; daemon acknowledged shutdown but is still reachable",
                        restart_reason.unwrap_or_else(|| "Daemon restart required".to_string())
                    ));
                }
                // 守护进程没有按时退出，强制终止
                if let Some(pid) = resolve_daemon_pid(listen_port, info.as_ref()).await {
                    kill_pid_gracefully(pid).await.map_err(|err| {
                        format!(
                            "{}; daemon remained reachable and forced stop failed: {err}",
                            restart_reason
                                .clone()
                                .unwrap_or_else(|| "Daemon restart required".to_string())
                        )
                    })?;
                } else {
                    return Err(format!(
                        "{}; daemon remained reachable and no PID could be resolved for safe forced stop",
                        restart_reason.unwrap_or_else(|| "Daemon restart required".to_string())
                    ));
                }
            }

            // 旧守护进程已停止，更新状态
            runtime.status = TcpDaemonStatus {
                state: TcpDaemonState::Stopped,
                pid: None,
                started_at_ms: None,
                last_error: None,
                listen_addr: Some(listen_addr.clone()),
            };
        }
        // 情况 B：端口被非守护进程占用
        DaemonProbe::NotDaemon => {
            return Err(format!(
                "Cannot start mobile access daemon because {listen_addr} is already in use by another process."
            ));
        }
        // 情况 C：端口空闲，可以直接启动
        DaemonProbe::NotReachable => {}
    }

    // 启动前的最后检查：确保端口确实可用
    ensure_listen_addr_available(&listen_addr).await?;

    // 启动新守护进程，关闭所有标准 IO 流
    let child = tokio_command(&daemon_binary)
        .arg("--listen")
        .arg(&listen_addr)
        .arg("--data-dir")
        .arg(data_dir)
        .arg("--token")
        .arg(token)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|err| format!("Failed to start mobile access daemon: {err}"))?;

    runtime.status = TcpDaemonStatus {
        state: TcpDaemonState::Running,
        pid: child.id(),
        started_at_ms: Some(now_unix_ms()),
        last_error: None,
        listen_addr: Some(listen_addr),
    };
    runtime.child = Some(child);

    Ok(runtime.status.clone())
}

/// 停止 Tailscale TCP 守护进程。
///
/// 停止策略（按优先级尝试）：
/// 1. 如果有子进程句柄，直接终止进程树（最快）
/// 2. 否则通过 RPC 请求守护进程优雅关闭
/// 3. RPC 关闭失败时，如果身份验证通过，使用 SIGTERM/SIGKILL 强制终止
/// 4. 端口被非本应用的进程占用时，拒绝停止
///
/// 停止后执行探活确认，更新状态为 Stopped 或 Error。
pub(super) async fn tailscale_daemon_stop(
    state: State<'_, AppState>,
) -> Result<TcpDaemonStatus, String> {
    let settings = state.app_settings.lock().await.clone();
    let configured_listen_addr = configured_daemon_listen_addr(&settings);
    let listen_port = parse_port_from_remote_host(&configured_listen_addr);

    let mut runtime = state.tcp_daemon.lock().await;
    let mut stop_error: Option<String> = None;

    // 策略 1：如果有子进程句柄，直接终止整个进程树
    if let Some(mut child) = runtime.child.take() {
        kill_child_process_tree(&mut child).await;
        let _ = child.wait().await;
    } else if let Some(port) = listen_port {
        // 策略 2：没有子进程句柄，通过 RPC 探活并发送关闭请求
        match probe_daemon(
            &configured_listen_addr,
            settings.remote_backend_token.as_deref(),
        )
        .await
        {
            DaemonProbe::Running { auth_ok, info, .. } => {
                let force_kill_allowed = can_force_stop_daemon(auth_ok, info.as_ref());
                // 尝试通过 RPC 请求优雅关闭
                if let Err(shutdown_error) = request_daemon_shutdown(
                    &configured_listen_addr,
                    settings.remote_backend_token.as_deref(),
                )
                .await
                {
                    // RPC 关闭失败，根据权限决定是否强制终止
                    let pid = resolve_daemon_pid(port, info.as_ref()).await;
                    if let Some(pid) = pid {
                        if force_kill_allowed {
                            if let Err(err) = kill_pid_gracefully(pid).await {
                                stop_error = Some(format!("{shutdown_error}; {err}"));
                            } else {
                                stop_error = None;
                            }
                        } else {
                            stop_error = Some(format!(
                                "{shutdown_error}; refusing forced stop because daemon ownership could not be verified"
                            ));
                        }
                    } else {
                        stop_error = Some(shutdown_error);
                    }
                } else if !wait_for_daemon_shutdown(
                    &configured_listen_addr,
                    settings.remote_backend_token.as_deref(),
                )
                .await
                {
                    // 守护进程确认关闭但未退出，可能卡死
                    if force_kill_allowed {
                        let pid = resolve_daemon_pid(port, info.as_ref()).await;
                        if let Some(pid) = pid {
                            if let Err(err) = kill_pid_gracefully(pid).await {
                                stop_error = Some(format!(
                                    "Daemon acknowledged shutdown but remained reachable; {err}"
                                ));
                            } else {
                                stop_error = None;
                            }
                        } else {
                            stop_error = Some(
                                "Daemon acknowledged shutdown but remained reachable and PID could not be resolved."
                                    .to_string(),
                            );
                        }
                    } else {
                        stop_error = Some(
                            "Daemon acknowledged shutdown but is still reachable; refusing forced stop because daemon ownership could not be verified."
                                .to_string(),
                        );
                    }
                }
            }
            DaemonProbe::NotDaemon => {
                stop_error = Some(format!(
                    "Port {port} is in use by a non-daemon process; refusing to stop it."
                ));
            }
            DaemonProbe::NotReachable => {} // 端口空闲，无需操作
        }
    }

    // 停止后验证：再次探活确认守护进程状态
    let probe_after_stop = probe_daemon(
        &configured_listen_addr,
        settings.remote_backend_token.as_deref(),
    )
    .await;
    let pid_after_stop = match listen_port {
        Some(port) => find_listener_pid(port).await,
        None => None,
    };
    runtime.status = match probe_after_stop {
        // 停止后仍在运行：标记为 Error 状态
        DaemonProbe::Running { auth_error, .. } => TcpDaemonStatus {
            state: TcpDaemonState::Error,
            pid: pid_after_stop,
            started_at_ms: runtime.status.started_at_ms,
            last_error: Some(
                stop_error
                    .or(auth_error)
                    .unwrap_or_else(|| "Daemon is still running after stop attempt.".to_string()),
            ),
            listen_addr: runtime.status.listen_addr.clone(),
        },
        // 端口被非守护进程占用：标记为 Error
        DaemonProbe::NotDaemon => TcpDaemonStatus {
            state: TcpDaemonState::Error,
            pid: pid_after_stop,
            started_at_ms: runtime.status.started_at_ms,
            last_error: Some(stop_error.unwrap_or_else(|| {
                "Configured port is now occupied by a non-daemon process.".to_string()
            })),
            listen_addr: runtime.status.listen_addr.clone(),
        },
        // 端口空闲：成功停止
        DaemonProbe::NotReachable => TcpDaemonStatus {
            state: TcpDaemonState::Stopped,
            pid: None,
            started_at_ms: None,
            last_error: stop_error,
            listen_addr: runtime.status.listen_addr.clone(),
        },
    };
    sync_tcp_daemon_listen_addr(&mut runtime.status, &configured_listen_addr);

    Ok(runtime.status.clone())
}

/// 查询 Tailscale TCP 守护进程的当前状态。
///
/// 查询策略：
/// 1. 先刷新本应用管理的子进程状态（非阻塞检查）
/// 2. 如果本应用没有记录运行中的子进程，通过 RPC 探活检测外部启动的守护进程
/// 3. 区分三种情况：守护进程运行中、端口被其他进程占用、端口空闲
///
/// 此命令对前端是只读操作，不会修改守护进程的实际运行状态。
pub(super) async fn tailscale_daemon_status(
    state: State<'_, AppState>,
) -> Result<TcpDaemonStatus, String> {
    let settings = state.app_settings.lock().await.clone();
    let configured_listen_addr = configured_daemon_listen_addr(&settings);
    let listen_port = parse_port_from_remote_host(&configured_listen_addr);

    let mut runtime = state.tcp_daemon.lock().await;
    refresh_tcp_daemon_runtime(&mut runtime).await;

    // 如果本应用没有记录运行中的子进程，通过 RPC 探活检测外部守护进程
    if !matches!(runtime.status.state, TcpDaemonState::Running) {
        let pid = match listen_port {
            Some(port) => find_listener_pid(port).await,
            None => None,
        };
        runtime.status = match probe_daemon(
            &configured_listen_addr,
            settings.remote_backend_token.as_deref(),
        )
        .await
        {
            // 端口上有守护进程在运行
            DaemonProbe::Running {
                auth_ok: _,
                auth_error,
                info: _,
            } => TcpDaemonStatus {
                state: TcpDaemonState::Running,
                pid,
                started_at_ms: runtime.status.started_at_ms,
                last_error: auth_error,
                listen_addr: runtime.status.listen_addr.clone(),
            },
            // 端口被非守护进程占用
            DaemonProbe::NotDaemon => TcpDaemonStatus {
                state: TcpDaemonState::Error,
                pid,
                started_at_ms: runtime.status.started_at_ms,
                last_error: Some(format!(
                    "Configured daemon port {configured_listen_addr} is occupied by a non-daemon process."
                )),
                listen_addr: runtime.status.listen_addr.clone(),
            },
            // 端口空闲
            DaemonProbe::NotReachable => TcpDaemonStatus {
                state: runtime.status.state.clone(),
                pid: runtime.status.pid,
                started_at_ms: runtime.status.started_at_ms,
                last_error: runtime.status.last_error.clone(),
                listen_addr: runtime.status.listen_addr.clone(),
            },
        };
    }

    sync_tcp_daemon_listen_addr(&mut runtime.status, &configured_listen_addr);

    Ok(runtime.status.clone())
}
