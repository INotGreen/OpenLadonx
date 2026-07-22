//! Cargo 构建脚本。
//!
//! 本脚本在编译 crate 之前运行，负责：
//! - 调用 tauri_build 生成 Tauri 所需的编译时代码和资产
//! - 在 iOS 目标平台上链接必要的系统库（libz 用于压缩，libiconv 用于字符编码转换）
//!
//! `tauri_build::build()` 会生成 `tauri::generate_context!()` 宏所需的编译时常量，
//! 并设置 Windows 资源文件、macOS Info.plist 等平台特定配置。

fn main() {
    // 触发 Tauri 的构建流程：生成编译时常量、处理图标、设置平台特定配置
    tauri_build::build();

    // iOS 平台需要显式链接系统压缩库和字符编码转换库
    // 这些库是 Tauri WebView 和底层网络栈所依赖的
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        // libz: 压缩库，WebView 和 HTTP 响应解压需要
        println!("cargo:rustc-link-lib=z");
        // libiconv: 字符编码转换库，处理非 UTF-8 编码文本时需要
        println!("cargo:rustc-link-lib=iconv");
    }
}
