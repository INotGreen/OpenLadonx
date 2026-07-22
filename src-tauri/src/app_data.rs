//! 应用程序数据目录管理。
//!
//! 本模块负责确定和管理 LadonX 的应用程序数据目录，包括：
//! - 解析数据目录路径（优先使用可执行文件所在目录）
//! - 确保数据目录存在（不存在时自动创建）
//! - 种子数据文件的初始化（将打包的默认配置文件复制到数据目录中）
//!
//! 这种设计允许 LadonX 以便携模式运行，所有数据存储在可执行文件旁边，
//! 而非系统特定位置（如 ~/.config 或 %APPDATA%）。

use std::path::PathBuf;

/// 嵌入编译时的默认应用状态 JSON 配置文件。
/// 当数据目录中不存在 `app_state.json` 时，会以此内容作为初始配置。
const DEFAULT_APP_STATE_JSON: &str = include_str!("../resources/app_state.json");

/// 解析应用程序数据目录的路径。
///
/// 优先返回可执行文件所在的目录（便携模式），
/// 如果无法获取可执行文件路径，则回退到当前工作目录。
pub(crate) fn resolve_app_data_dir() -> PathBuf {
    crate::settings::resolve_runtime_data_dir()
}

/// 确保应用程序数据目录存在，并初始化默认配置文件。
///
/// 如果数据目录不存在，则自动创建；如果 `app_state.json` 不存在，
/// 则使用编译时嵌入的默认内容写入该文件。
///
/// 返回数据目录的路径，或在创建失败时返回错误信息。
pub(crate) fn ensure_seeded_app_data_dir() -> Result<PathBuf, String> {
    let data_dir = resolve_app_data_dir();
    // 递归创建目录及其所有父目录
    std::fs::create_dir_all(&data_dir)
        .map_err(|err| format!("Failed to create app data dir {}: {err}", data_dir.display()))?;

    // 仅在文件不存在时才写入，避免覆盖用户已有的配置
    seed_if_missing(&data_dir.join("app_state.json"), DEFAULT_APP_STATE_JSON)?;

    Ok(data_dir)
}

/// 获取当前运行的可执行文件所在的目录路径。
///
/// 用于确定便携模式下的数据存储位置。
/// 如果目标文件尚不存在，则用指定内容创建它。
///
/// 这是种子数据初始化的核心逻辑：仅在不覆盖已有文件的前提下写入默认内容，
/// 确保用户的个性化配置不会被重置。
fn seed_if_missing(path: &PathBuf, content: &str) -> Result<(), String> {
    // 文件已存在则跳过，保护用户数据不被覆盖
    if path.exists() {
        return Ok(());
    }
    std::fs::write(path, content)
        .map_err(|err| format!("Failed to write default file {}: {err}", path.display()))
}
