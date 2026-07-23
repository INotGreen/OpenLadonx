#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::path::PathBuf;

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const BUNDLED_CLI_EXE: &[u8] = include_bytes!("../resources/windows/x64/codex.exe");
#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
const BUNDLED_CLI_EXE: &[u8] = include_bytes!("../resources/windows/arm64/codex.exe");
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const BUNDLED_CLI_EXE: &[u8] = include_bytes!("../resources/macos/x64/codex");
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const BUNDLED_CLI_EXE: &[u8] = include_bytes!("../resources/macos/arm64/codex");

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const BUNDLED_CLAUDE_EXE: &[u8] = include_bytes!("../resources/windows/x64/claude.exe");
#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
const BUNDLED_CLAUDE_EXE: &[u8] = include_bytes!("../resources/windows/arm64/claude.exe");
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const BUNDLED_CLAUDE_EXE: &[u8] = include_bytes!("../resources/macos/x64/claude");
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const BUNDLED_CLAUDE_EXE: &[u8] = include_bytes!("../resources/macos/arm64/claude");

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const BUNDLED_RG_EXE: &[u8] = include_bytes!("../resources/windows/x64/rg.exe");
#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
const BUNDLED_RG_EXE: &[u8] = include_bytes!("../resources/windows/arm64/rg.exe");
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
const BUNDLED_RG_EXE: &[u8] = include_bytes!("../resources/macos/x64/rg");
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
const BUNDLED_RG_EXE: &[u8] = include_bytes!("../resources/macos/arm64/rg");

const BUNDLED_CONFIG_TOML: &[u8] = include_bytes!("../resources/config.toml");
const BUNDLED_AGENTS_MD: &[u8] = include_bytes!("../resources/AGENTS.md");

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn render_codex_config(base_url: &str) -> Option<String> {
    let template = std::str::from_utf8(BUNDLED_CONFIG_TOML).ok()?;
    let rendered = template
        .replace("REPLACE_BASE_URL", base_url)
        .replace(
            "REPLACE_OPENAI_BASE_URL",
            std::env::var(crate::settings::OPENAI_BASE_URL_ENV)
                .ok()
                .as_deref()
                .unwrap_or(base_url),
        )
        .replace(
            "REPLACE_OPENAI_API_KEY",
            crate::settings::openai_api_key_from_env()
                .as_deref()
                .unwrap_or(""),
        );
    Some(rendered)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn render_agents_md_with_values(base_url: &str, openai_api_key: Option<&str>) -> Option<String> {
    let template = std::str::from_utf8(BUNDLED_AGENTS_MD).ok()?;
    let rendered = template
        .replace(
            "REPLACE_API_KEY",
            openai_api_key
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(""),
        )
        .replace(
            "REPLACE_BASE_URL",
            std::env::var(crate::settings::OPENAI_BASE_URL_ENV)
                .ok()
                .as_deref()
                .unwrap_or(base_url),
        );
    Some(rendered)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn write_codex_config(home: &std::path::Path, base_url: &str) -> Result<(), String> {
    std::fs::create_dir_all(home)
        .map_err(|error| format!("Failed to create {}: {error}", home.display()))?;
    let config_path = home.join("config.toml");
    if config_path.exists() {
        return Ok(());
    }
    let config = render_codex_config(base_url)
        .unwrap_or_else(|| String::from_utf8_lossy(BUNDLED_CONFIG_TOML).into_owned());
    std::fs::write(&config_path, config)
        .map_err(|error| format!("Failed to write {}: {error}", config_path.display()))
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn write_agents_md_with_values(
    home: &std::path::Path,
    base_url: &str,
    openai_api_key: Option<&str>,
) -> Result<(), String> {
    std::fs::create_dir_all(home)
        .map_err(|error| format!("Failed to create {}: {error}", home.display()))?;
    let agents_path = home.join("AGENTS.md");
    let agents = render_agents_md_with_values(base_url, openai_api_key)
        .unwrap_or_else(|| String::from_utf8_lossy(BUNDLED_AGENTS_MD).into_owned());
    std::fs::write(&agents_path, agents)
        .map_err(|error| format!("Failed to write {}: {error}", agents_path.display()))
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn write_claude_settings(
    home: &std::path::Path,
    anthropic_base_url: &str,
    anthropic_auth_token: Option<&str>,
) -> Result<(), String> {
    std::fs::create_dir_all(home)
        .map_err(|error| format!("Failed to create {}: {error}", home.display()))?;

    let settings_path = home.join("settings.json");
    let claude_home = home.to_string_lossy().to_string();
    let mut env = serde_json::Map::new();
    env.insert(
        crate::settings::ANTHROPIC_BASE_URL_ENV.to_string(),
        serde_json::Value::String(anthropic_base_url.trim().to_string()),
    );
    env.insert(
        crate::settings::CLAUDE_HOME_ENV.to_string(),
        serde_json::Value::String(claude_home.clone()),
    );
    env.insert(
        crate::settings::CLAUDE_CONFIG_DIR_ENV.to_string(),
        serde_json::Value::String(claude_home),
    );
    if let Some(value) = anthropic_auth_token
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        env.insert(
            crate::settings::ANTHROPIC_API_KEY_ENV.to_string(),
            serde_json::Value::String(value.to_string()),
        );
    }
    let root = serde_json::json!({
        "env": env,
    });

    let data = serde_json::to_string_pretty(&root).map_err(|error| error.to_string())?;
    std::fs::write(&settings_path, data)
        .map_err(|error| format!("Failed to write {}: {error}", settings_path.display()))
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn read_claude_settings_env_value(home: &std::path::Path, key: &str) -> Option<String> {
    let settings_path = home.join("settings.json");
    let data = std::fs::read_to_string(settings_path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&data).ok()?;
    value
        .get("env")
        .and_then(|env| env.get(key))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn resolve_claude_base_url_for_ensure(home: &std::path::Path) -> String {
    let env_base_url = crate::settings::anthropic_base_url_from_env();
    let settings_base_url =
        read_claude_settings_env_value(home, crate::settings::ANTHROPIC_BASE_URL_ENV);

    if let Some(settings_base_url) = settings_base_url.as_deref() {
        if env_base_url.as_deref() == Some(crate::settings::ANTHROPIC_BASE_URL) {
            return settings_base_url.to_string();
        }
    }

    env_base_url
        .or(settings_base_url)
        .unwrap_or_else(|| crate::settings::ANTHROPIC_BASE_URL.to_string())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn resolve_claude_auth_token_for_ensure(
    home: &std::path::Path,
    anthropic_base_url: &str,
) -> Option<String> {
    let settings_token =
        read_claude_settings_env_value(home, crate::settings::ANTHROPIC_API_KEY_ENV);
    if anthropic_base_url.trim() != crate::settings::ANTHROPIC_BASE_URL {
        return settings_token.or_else(crate::settings::anthropic_api_key_from_env);
    }
    crate::settings::anthropic_api_key_from_env().or(settings_token)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn clear_claude_settings_credentials(home: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(home)
        .map_err(|error| format!("Failed to create {}: {error}", home.display()))?;

    let settings_path = home.join("settings.json");
    let claude_home = home.to_string_lossy().to_string();
    let root = serde_json::json!({
        "env": {
            crate::settings::ANTHROPIC_BASE_URL_ENV: "",
            crate::settings::ANTHROPIC_API_KEY_ENV: "",
            crate::settings::CLAUDE_HOME_ENV: claude_home,
            crate::settings::CLAUDE_CONFIG_DIR_ENV: claude_home,
        },
    });
    let data = serde_json::to_string_pretty(&root).map_err(|error| error.to_string())?;
    std::fs::write(&settings_path, data)
        .map_err(|error| format!("Failed to write {}: {error}", settings_path.display()))
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) fn bundled_cli_home() -> Option<PathBuf> {
    crate::settings::resolve_default_codex_home()
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) fn bundled_claude_home() -> Option<PathBuf> {
    crate::settings::resolve_default_claude_home()
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) fn bundled_cli_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let file_name = "codex.exe";
    #[cfg(target_os = "macos")]
    let file_name = "codex";

    Some(bundled_cli_home()?.join(file_name))
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) fn bundled_claude_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let file_name = "claude.exe";
    #[cfg(target_os = "macos")]
    let file_name = "claude";

    Some(bundled_claude_home()?.join(file_name))
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn remove_legacy_bundled_claude_binary() {
    let home = match bundled_claude_home() {
        Some(home) => home,
        None => return,
    };
    #[cfg(target_os = "windows")]
    let legacy_paths: Vec<PathBuf> = vec![home.join("claudecode.exe")];
    #[cfg(target_os = "macos")]
    let legacy_paths: Vec<PathBuf> = vec![home.join("claudecode")];

    for path in legacy_paths {
        if path.exists() {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) fn bundled_rg_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let file_name = "rg.exe";
    #[cfg(target_os = "macos")]
    let file_name = "rg";

    Some(bundled_cli_home()?.join(file_name))
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) fn ensure_bundled_rg() -> Option<PathBuf> {
    let path = bundled_rg_path()?;
    if path.exists() {
        #[cfg(target_os = "macos")]
        make_executable(&path);
        return Some(path);
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok()?;
    }
    std::fs::write(&path, BUNDLED_RG_EXE).ok()?;
    #[cfg(target_os = "macos")]
    make_executable(&path);

    Some(path)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) fn ensure_bundled_claude() -> Option<PathBuf> {
    remove_legacy_bundled_claude_binary();
    let path = bundled_claude_path()?;
    let needs_write = std::fs::metadata(&path)
        .map(|metadata| metadata.len() != BUNDLED_CLAUDE_EXE.len() as u64)
        .unwrap_or(true);

    if needs_write {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok()?;
        }
        std::fs::write(&path, BUNDLED_CLAUDE_EXE).ok()?;
    }
    #[cfg(target_os = "macos")]
    make_executable(&path);

    let claude_home = bundled_claude_home()?;
    let anthropic_base_url = resolve_claude_base_url_for_ensure(&claude_home);
    let anthropic_auth_token =
        resolve_claude_auth_token_for_ensure(&claude_home, &anthropic_base_url);
    crate::settings::apply_anthropic_credentials_env(
        Some(&anthropic_base_url),
        anthropic_auth_token.as_deref(),
    );
    write_claude_settings(
        &claude_home,
        &anthropic_base_url,
        anthropic_auth_token.as_deref(),
    )
    .ok()?;

    Some(path)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) fn ensure_bundled_cli() -> Option<PathBuf> {
    let path = bundled_cli_path()?;
    let needs_write = std::fs::metadata(&path)
        .map(|metadata| metadata.len() != BUNDLED_CLI_EXE.len() as u64)
        .unwrap_or(true);

    if needs_write {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok()?;
        }
        std::fs::write(&path, BUNDLED_CLI_EXE).ok()?;
    }
    #[cfg(target_os = "macos")]
    make_executable(&path);

    let codex_home = bundled_cli_home()?;
    write_codex_config(&codex_home, crate::settings::CODEX_BASE_URL).ok()?;
    write_agents_md_with_values(
        &codex_home,
        crate::settings::CODEX_BASE_URL,
        crate::settings::openai_api_key_from_env().as_deref(),
    )
    .ok()?;

    std::fs::create_dir_all(codex_home.join("automations")).ok()?;

    Some(path)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) fn sync_ladonx_cli_credentials(
    codex_api_key: Option<&str>,
    claudecode_api_key: Option<&str>,
    codex_base_url: &str,
    anthropic_base_url: &str,
) -> Result<(), String> {
    if let Some(codex_api_key) = codex_api_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let codex_home =
            bundled_cli_home().ok_or_else(|| "Failed to resolve Codex home".to_string())?;
        write_codex_config(&codex_home, codex_base_url)?;
        crate::codex::config::write_base_url_with_wire_api(
            Some(codex_base_url),
            Some("responses"),
        )?;
        write_agents_md_with_values(&codex_home, codex_base_url, Some(codex_api_key))?;
        write_codex_auth_json(codex_api_key)?;
        crate::settings::apply_openai_credentials_env(Some(codex_base_url), Some(codex_api_key));
    }

    if let Some(claudecode_api_key) = claudecode_api_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let claude_home =
            bundled_claude_home().ok_or_else(|| "Failed to resolve Claude home".to_string())?;
        write_claude_settings(&claude_home, anthropic_base_url, Some(claudecode_api_key))?;
    }

    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) fn write_codex_auth_json(codex_api_key: &str) -> Result<(), String> {
    let codex_api_key = codex_api_key.trim();
    if codex_api_key.is_empty() {
        return Ok(());
    }

    let codex_home =
        bundled_cli_home().ok_or_else(|| "Failed to resolve Codex home".to_string())?;
    std::fs::create_dir_all(&codex_home)
        .map_err(|error| format!("Failed to create {}: {error}", codex_home.display()))?;

    let auth_path = codex_home.join("auth.json");
    let auth_json = serde_json::json!({
        crate::settings::OPENAI_API_KEY_ENV: codex_api_key,
    });
    let data = serde_json::to_string_pretty(&auth_json).map_err(|error| error.to_string())?;
    std::fs::write(&auth_path, data)
        .map_err(|error| format!("Failed to write {}: {error}", auth_path.display()))
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) fn apply_custom_response_credentials(
    base_url: &str,
    api_key: &str,
) -> Result<(), String> {
    let trimmed_url = base_url.trim();
    if !trimmed_url.is_empty() {
        crate::codex::config::write_base_url_with_wire_api(Some(trimmed_url), Some("responses"))?;
    }
    crate::settings::apply_openai_credentials_env(Some(trimmed_url), Some(api_key));
    write_codex_auth_json(api_key)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) fn apply_custom_messages_credentials(
    base_url: &str,
    api_key: &str,
) -> Result<(), String> {
    crate::settings::apply_anthropic_credentials_env(Some(base_url), Some(api_key));
    let claude_home =
        bundled_claude_home().ok_or_else(|| "Failed to resolve Claude home".to_string())?;
    write_claude_settings(&claude_home, base_url.trim(), Some(api_key))
}

/// 切回「默认」时调用：用 Ladonx 默认值覆盖三处文件，彻底清除自定义配置。
/// - config.toml：把 base_url 与 [model_providers.custom].base_url 重置为 codex_base_url
/// - auth.json：OPENAI_API_KEY 重置为 codex_api_key
/// - settings.json：ANTHROPIC_BASE_URL 重置为默认、ANTHROPIC_AUTH_TOKEN 重置为 codex_api_key
#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) fn restore_default_credentials(
    codex_base_url: &str,
    codex_api_key: Option<&str>,
) -> Result<(), String> {
    let trimmed_url = codex_base_url.trim();
    if !trimmed_url.is_empty() {
        crate::codex::config::write_base_url_with_wire_api(Some(trimmed_url), Some("responses"))?;
    }
    let trimmed_key = codex_api_key
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let claude_home = bundled_claude_home();
    match trimmed_key {
        Some(key) => {
            write_codex_auth_json(key)?;
            if let Some(claude_home) = claude_home {
                write_claude_settings(
                    &claude_home,
                    crate::settings::ANTHROPIC_BASE_URL,
                    Some(key),
                )?;
            }
            crate::settings::apply_openai_credentials_env(Some(trimmed_url), Some(key));
            crate::settings::apply_anthropic_credentials_env(
                Some(crate::settings::ANTHROPIC_BASE_URL),
                Some(key),
            );
        }
        None => {
            if let Some(claude_home) = claude_home {
                let _ =
                    write_claude_settings(&claude_home, crate::settings::ANTHROPIC_BASE_URL, None);
            }
            crate::settings::apply_openai_credentials_env(Some(trimmed_url), None);
            crate::settings::apply_anthropic_credentials_env(
                Some(crate::settings::ANTHROPIC_BASE_URL),
                None,
            );
        }
    }
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub(crate) fn restore_default_credentials(
    _codex_base_url: &str,
    _codex_api_key: Option<&str>,
) -> Result<(), String> {
    Ok(())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) fn clear_ladonx_cli_credentials() -> Result<(), String> {
    crate::codex::config::clear_base_url_values()?;

    if let Some(codex_home) = bundled_cli_home() {
        let auth_path = codex_home.join("auth.json");
        if auth_path.exists() {
            let empty = serde_json::json!({});
            let data = serde_json::to_string_pretty(&empty).map_err(|error| error.to_string())?;
            std::fs::write(&auth_path, data)
                .map_err(|error| format!("Failed to clear {}: {error}", auth_path.display()))?;
        }
    }

    if let Some(claude_home) = bundled_claude_home() {
        clear_claude_settings_credentials(&claude_home)?;
    }

    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub(crate) fn clear_ladonx_cli_credentials() -> Result<(), String> {
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub(crate) fn apply_custom_response_credentials(
    base_url: &str,
    api_key: &str,
) -> Result<(), String> {
    crate::settings::apply_openai_credentials_env(Some(base_url), Some(api_key));
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub(crate) fn apply_custom_messages_credentials(
    base_url: &str,
    api_key: &str,
) -> Result<(), String> {
    crate::settings::apply_anthropic_credentials_env(Some(base_url), Some(api_key));
    Ok(())
}

#[cfg(target_os = "macos")]
fn make_executable(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;

    if let Ok(metadata) = std::fs::metadata(path) {
        let mut permissions = metadata.permissions();
        permissions.set_mode(0o755);
        let _ = std::fs::set_permissions(path, permissions);
    }
}
