//! # WebSocket 传输实现
//!
//! 本模块实现了基于 WebSocket 协议的远程后端传输层。
//! 用于通过 WebSocket 中继（relay）连接远程守护进程，
//! 适用于存在防火墙/NAT 的网络环境。
//!
//! ## 认证策略
//!
//! 根据 WebSocket URL 的不同，采用不同的认证方式：
//! * **中继端点**（URL 包含 `/api/ladonxrelay/`）— 通过 WebSocket
//!   升级请求的查询字符串携带认证令牌，无需单独的 `auth` 消息。
//! * **直连端点** — 在 WebSocket 连接建立后发送 `auth` JSON-RPC 消息。
//!
//! ## I/O 处理
//!
//! 与 TCP 传输不同，WebSocket 传输的 I/O 循环直接内联在 connect 方法中，
//! 因为 WebSocket 使用的是基于帧的 `Sink`/`Stream` 抽象而非 `AsyncRead`/`AsyncWrite`。
//! 读写任务共享相同的 `pending` 映射表和 `connected` 标志。

use futures_util::{SinkExt, StreamExt};
use tauri::AppHandle;
use tokio_tungstenite::{connect_async, tungstenite::Message};

use super::transport::{mark_disconnected, PendingMap};

/// WebSocket 连接的句柄，与 `TransportConnection` 类似但不通过 trait 泛型。
pub(crate) struct WebSocketConnection {
    pub(crate) out_tx: tokio::sync::mpsc::Sender<String>,
    pub(crate) pending: std::sync::Arc<tokio::sync::Mutex<PendingMap>>,
    pub(crate) connected: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

/// WebSocket 传输层（无状态，仅提供 `connect` 方法）。
pub(crate) struct WebSocketTransport;

impl WebSocketTransport {
    /// 建立 WebSocket 连接并进行认证。
    ///
    /// 连接成功后启动后台读写任务，返回 `WebSocketConnection` 句柄。
    pub(crate) async fn connect(
        app: AppHandle,
        url: String,
        auth_token: Option<String>,
    ) -> Result<WebSocketConnection, String> {
        let (ws_stream, _) = connect_async(&url)
            .await
            .map_err(|err| format!("Failed to connect to WebSocket server at {url}: {err}"))?;

        let (mut ws_sender, mut ws_receiver) = ws_stream.split();

        let (out_tx, mut out_rx) = tokio::sync::mpsc::channel::<String>(512);
        let pending = std::sync::Arc::new(tokio::sync::Mutex::new(PendingMap::new()));
        let connected = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));

        // 中继端点通过 HTTP 升级的查询字符串认证，无需单独发送 auth 消息
        // 非中继端点需要主动发送 auth 消息
        if let Some(token) = auth_token.filter(|_| !uses_query_auth(&url)) {
            let auth_msg = serde_json::json!({
                "id": 0,
                "method": "auth",
                "params": { "token": token }
            });
            let auth_line = serde_json::to_string(&auth_msg).map_err(|e| e.to_string())?;
            ws_sender
                .send(Message::Text(auth_line))
                .await
                .map_err(|e| format!("Auth failed: {e}"))?;
        }

        let pending_for_writer = std::sync::Arc::clone(&pending);
        let connected_for_writer = std::sync::Arc::clone(&connected);
        let pending_for_reader = std::sync::Arc::clone(&pending);
        let connected_for_reader = std::sync::Arc::clone(&connected);

        // 写任务：将输出通道中的消息作为 WebSocket 文本帧发送
        tokio::spawn(async move {
            while let Some(line) = out_rx.recv().await {
                if ws_sender.send(Message::Text(line)).await.is_err() {
                    mark_disconnected(&pending_for_writer, &connected_for_writer).await;
                    break;
                }
            }
        });

        // 读任务：接收 WebSocket 帧，分派文本/二进制消息
        tokio::spawn(async move {
            while let Some(msg_result) = ws_receiver.next().await {
                match msg_result {
                    Ok(Message::Text(text)) => {
                        handle_incoming_line(&app, &pending_for_reader, &text).await;
                    }
                    // 某些实现可能发送二进制帧，尝试以 UTF-8 解析
                    Ok(Message::Binary(data)) => {
                        if let Ok(text) = String::from_utf8(data) {
                            handle_incoming_line(&app, &pending_for_reader, &text).await;
                        }
                    }
                    // 关闭帧：正常退出循环
                    Ok(Message::Close(_)) => break,
                    Err(_) => break,
                    _ => {} // Ping/Pong 由 tungstenite 自动处理
                }
            }
            mark_disconnected(&pending_for_reader, &connected_for_reader).await;
        });

        Ok(WebSocketConnection {
            out_tx,
            pending,
            connected,
        })
    }
}

/// 判断 WebSocket URL 是否使用查询字符串认证。
///
/// 中继端点（包含 `/api/ladonxrelay/`）在 HTTP 升级阶段已完成认证，
/// 无需额外的 JSON-RPC auth 消息。
fn uses_query_auth(url: &str) -> bool {
    url.contains("/api/ladonxrelay/")
}

/// 处理从 WebSocket 接收到的一行文本消息。
///
/// 委托给共享的 `dispatch_incoming_line` 函数进行响应分发和通知转发。
async fn handle_incoming_line(
    app: &AppHandle,
    pending: &std::sync::Arc<tokio::sync::Mutex<PendingMap>>,
    line: &str,
) {
    use super::transport::dispatch_incoming_line;
    dispatch_incoming_line(app, pending, line).await;
}
