//! 中继桥接模块
//!
//! 实现本地守护进程与远程 WebSocket 中继服务器之间的双向数据桥接。
//! 该模块使远程客户端可以通过中继服务器访问本地守护进程，
//! 从而实现对本地文件系统、终端等资源的远程操作。
//!
//! 工作流程：
//! 1. 根据应用设置中的 WebSocket URL 和 token 构建中继连接 URL
//! 2. 连接到本地守护进程（127.0.0.1:4732）并进行认证
//! 3. 同时建立与远程中继服务器的 WebSocket 连接
//! 4. 在本地 TCP 和远程 WebSocket 之间双向转发消息
//!
//! 注意：移动端（Android/iOS）不支持此功能。

use serde_json::Value;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout, Duration, Instant};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use futures_util::{SinkExt, StreamExt};

use crate::state::{AppState, RelayBridgeRuntime};

/// 本地守护进程的默认监听地址。
const LOCAL_DAEMON_ADDR: &str = crate::settings::DEFAULT_REMOTE_BACKEND_HOST;

/// 根据最新的应用设置刷新中继桥接连接状态。
///
/// 当用户修改远程后端 URL 或 token 时调用此函数。
/// 如果设置变更导致目标 URL 发生变化，会先停止旧连接再启动新连接。
/// 在移动端平台上此函数不执行任何操作。
pub(crate) async fn refresh_for_settings(state: &AppState, app: &AppHandle) {
    // 移动端不支持中继桥接功能
    if cfg!(any(target_os = "android", target_os = "ios")) {
        return;
    }

    // 从设置中提取并清理 WebSocket URL 和 token
    let (websocket_url, token) = {
        let settings = state.app_settings.lock().await;
        (
            settings
                .remote_backend_websocket_url
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            settings
                .remote_backend_token
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
        )
    };

    // 只有同时提供了 URL 和 token 时才启用中继连接
    let desired = match (websocket_url, token) {
        (Some(url), Some(token)) => Some((build_host_relay_url(&url, &token), token)),
        _ => None,
    };

    let mut runtime = state.relay_bridge.lock().await;

    // 如果目标 URL 未变化，无需重新连接
    if runtime.current_url == desired.as_ref().map(|(url, _)| url.clone()) {
        return;
    }

    // 停止旧的中继桥接任务
    stop_runtime(&mut runtime);

    // 启动新的中继桥接任务
    if let Some((url, token)) = desired {
        runtime.current_url = Some(url.clone());
        runtime.task = Some(spawn_bridge(app.clone(), url, token));
    }
}

/// 停止当前正在运行的中继桥接任务。
fn stop_runtime(runtime: &mut RelayBridgeRuntime) {
    if let Some(task) = runtime.task.take() {
        task.abort();
    }
    runtime.current_url = None;
}

/// 启动中继桥接后台任务。
///
/// 任务会持续循环运行：等待本地守护进程就绪，建立桥接，
/// 断开后等待 2 秒自动重连。当应用设置中的 token 被清空时，
/// 循环自动退出。
fn spawn_bridge(app: AppHandle, relay_url: String, daemon_token: String) -> JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            let state = app.state::<AppState>();
            // 检查 token 是否仍然有效，避免在用户清除设置后继续重连
            let keep_running = {
                let settings = state.app_settings.lock().await;
                settings
                    .remote_backend_token
                    .as_deref()
                    .map(str::trim)
                    .is_some_and(|value| !value.is_empty())
            };

            if !keep_running {
                break;
            }

            // 等待本地守护进程启动并就绪
            let _ = wait_for_local_daemon_ready(Duration::from_secs(5)).await;
            if let Err(err) = bridge_once(&relay_url, &daemon_token).await {
                eprintln!("[LadonX] Relay bridge disconnected: {err}");
            }

            // 断开后等待 2 秒再重连，避免频繁重试
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    })
}

/// 等待本地守护进程就绪。
///
/// 在指定的最大等待时间内，每隔 200ms 尝试连接本地守护进程。
/// 返回 `true` 表示守护进程已就绪，`false` 表示超时。
pub(crate) async fn wait_for_local_daemon_ready(max_wait: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < max_wait {
        // 每次连接尝试最多等待 500ms
        match timeout(Duration::from_millis(500), TcpStream::connect(LOCAL_DAEMON_ADDR)).await {
            Ok(Ok(stream)) => {
                drop(stream);
                return true;
            }
            _ => {
                // 连接失败，等待 200ms 后重试
                sleep(Duration::from_millis(200)).await;
            }
        }
    }
    false
}

/// 执行单次桥接会话。
///
/// 连接到本地守护进程，完成认证后建立与远程中继的 WebSocket 连接，
/// 然后在两者之间双向转发数据。任一端断开连接时函数返回。
async fn bridge_once(relay_url: &str, daemon_token: &str) -> Result<(), String> {
    // 连接到本地守护进程
    let tcp_stream = TcpStream::connect(LOCAL_DAEMON_ADDR)
        .await
        .map_err(|err| format!("failed to connect local daemon at {LOCAL_DAEMON_ADDR}: {err}"))?;
    let (tcp_reader, mut tcp_writer) = tcp_stream.into_split();
    let mut tcp_lines = BufReader::new(tcp_reader).lines();

    // 先对本地守护进程进行认证
    authenticate_local_daemon(&mut tcp_writer, &mut tcp_lines, daemon_token).await?;

    // 连接到远程 WebSocket 中继服务器
    let (ws_stream, _) = connect_async(relay_url)
        .await
        .map_err(|err| format!("failed to connect relay host {relay_url}: {err}"))?;
    let (mut ws_writer, mut ws_reader) = ws_stream.split();

    // TCP -> WebSocket 转发：将本地守护进程的输出转发到远程中继
    let tcp_to_ws = async move {
        while let Ok(Some(line)) = tcp_lines.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            ws_writer
                .send(Message::Text(trimmed.to_string().into()))
                .await
                .map_err(|err| format!("failed to forward TCP -> WebSocket: {err}"))?;
        }
        Ok::<(), String>(())
    };

    // WebSocket -> TCP 转发：将远程中继的消息转发到本地守护进程
    let ws_to_tcp = async move {
        while let Some(message) = ws_reader.next().await {
            match message {
                Ok(Message::Text(text)) => {
                    // 过滤掉系统级别的无关消息（如心跳、会话信息等）
                    if should_ignore_relay_message(&text) {
                        continue;
                    }
                    tcp_writer
                        .write_all(text.as_bytes())
                        .await
                        .map_err(|err| format!("failed to write relay message to TCP: {err}"))?;
                    tcp_writer
                        .write_all(b"\n")
                        .await
                        .map_err(|err| format!("failed to terminate relay TCP line: {err}"))?;
                }
                Ok(Message::Binary(data)) => {
                    tcp_writer
                        .write_all(&data)
                        .await
                        .map_err(|err| format!("failed to write relay binary to TCP: {err}"))?;
                    tcp_writer
                        .write_all(b"\n")
                        .await
                        .map_err(|err| format!("failed to terminate relay TCP binary line: {err}"))?;
                }
                Ok(Message::Close(_)) => break,
                Ok(_) => {}
                Err(err) => return Err(format!("failed to read relay message: {err}")),
            }
        }
        Ok::<(), String>(())
    };

    // 并行运行双向转发，当 WebSocket->TCP 方向结束时终止 TCP->WS 方向
    let tcp_to_ws_task = tokio::spawn(tcp_to_ws);
    let ws_to_tcp_result = ws_to_tcp.await;
    tcp_to_ws_task.abort();
    ws_to_tcp_result
}

/// 向本地守护进程发送认证请求。
///
/// 使用 JSON-RPC 风格的 `auth` 方法，将 token 作为参数发送。
/// 如果守护进程返回错误响应，则认证失败。
async fn authenticate_local_daemon(
    tcp_writer: &mut tokio::net::tcp::OwnedWriteHalf,
    tcp_lines: &mut tokio::io::Lines<BufReader<tokio::net::tcp::OwnedReadHalf>>,
    daemon_token: &str,
) -> Result<(), String> {
    // 构造 JSON-RPC 认证请求
    let mut payload = serde_json::to_string(&serde_json::json!({
        "id": 0,
        "method": "auth",
        "params": { "token": daemon_token },
    }))
    .map_err(|err| format!("failed to encode daemon auth request: {err}"))?;
    payload.push('\n');

    // 发送认证请求
    tcp_writer
        .write_all(payload.as_bytes())
        .await
        .map_err(|err| format!("failed to send daemon auth request: {err}"))?;

    // 读取认证响应
    let line = tcp_lines
        .next_line()
        .await
        .map_err(|err| format!("failed to read daemon auth response: {err}"))?
        .ok_or_else(|| "local daemon closed connection during auth".to_string())?;

    let response: Value = serde_json::from_str(&line)
        .map_err(|err| format!("failed to parse daemon auth response: {err}"))?;

    // 检查响应中是否包含错误信息
    if let Some(message) = response
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
    {
        return Err(format!("local daemon auth failed: {message}"));
    }

    Ok(())
}

/// 将客户端 relay URL 转换为宿主端 relay URL。
///
/// 将 `/v1/api/ladonxrelay/client` 路径替换为 `/v1/api/ladonxrelay/host`，
/// 并附加 token 查询参数。同时处理 URL 解析失败时的回退逻辑。
fn build_host_relay_url(base_url: &str, token: &str) -> String {
    match reqwest::Url::parse(base_url.trim()) {
        Ok(mut url) => {
            // 将客户端端点路径替换为宿主端点路径
            if url.path() == "/v1/api/ladonxrelay/client" {
                url.set_path("/v1/api/ladonxrelay/host");
            }
            // 清除现有查询参数，只保留 token
            url.query_pairs_mut()
                .clear()
                .append_pair("token", token);
            url.to_string()
        }
        Err(_) => {
            // URL 解析失败时的回退方案：手动拼接字符串
            let mut url = base_url.trim().to_string();
            if let Some((prefix, _)) = url.split_once('?') {
                url = prefix.to_string();
            }
            if url.ends_with("/v1/api/ladonxrelay/client") {
                url.truncate(url.len() - "/client".len());
                url.push_str("/host");
            }
            let separator = if url.contains('?') { '&' } else { '?' };
            url.push(separator);
            url.push_str("token=");
            url.push_str(token);
            url
        }
    }
}

/// 判断中继消息是否应被过滤忽略。
///
/// 过滤掉系统级别的无关消息类型（如心跳 pong、会话信息、连接通知等），
/// 这些消息不需要转发到本地守护进程，以减少不必要的网络流量。
fn should_ignore_relay_message(text: &str) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return false;
    };

    let Some(message_type) = value.get("type").and_then(Value::as_str) else {
        return false;
    };

    // 这些消息类型仅用于中继协议维护，无需转发
    matches!(message_type, "session_info" | "connected" | "pong" | "error")
}
