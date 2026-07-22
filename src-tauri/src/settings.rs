use std::path::PathBuf;
pub(crate) const OPENAI_API_KEY_ENV: &str = "OPENAI_API_KEY";
pub(crate) const ANTHROPIC_API_KEY_ENV: &str = "ANTHROPIC_AUTH_TOKEN";
pub(crate) const ANTHROPIC_BASE_URL_ENV: &str = "ANTHROPIC_BASE_URL";
pub(crate) const LADONX_SETTINGS_FILE_NAME: &str = "ladonx_settings.json";
const LEGACY_SETTINGS_FILE_NAME: &str = "settings.json";

pub(crate) const OPENAI_BASE_URL_ENV: &str = "OPENAI_BASE_URL";
pub(crate) const CODEX_HOME_ENV: &str = "CODEX_HOME";
pub(crate) const CLAUDE_HOME_ENV: &str = "CLAUDE_HOME";
pub(crate) const CLAUDE_CONFIG_DIR_ENV: &str = "CLAUDE_CONFIG_DIR";

#[cfg(debug_assertions)]
pub(crate) const DEFAULT_LADONX_API_BASE_URL: &str = "http://10.211.55.2:5001";
#[cfg(not(debug_assertions))]
pub(crate) const DEFAULT_LADONX_API_BASE_URL: &str = "https://www.ladonx.com";

#[cfg(debug_assertions)]
pub(crate) const CODEX_BASE_URL: &str = "http://10.211.55.2:5001/v1";
#[cfg(not(debug_assertions))]
pub(crate) const CODEX_BASE_URL: &str = "https://www.ladonx.com/v1";

#[cfg(debug_assertions)]
pub(crate) const ANTHROPIC_BASE_URL: &str = "http://10.211.55.2:5001/anthropic";
#[cfg(not(debug_assertions))]
pub(crate) const ANTHROPIC_BASE_URL: &str = "https://www.ladonx.com/anthropic";

pub(crate) const OPENAI_BASE_URL: &str = CODEX_BASE_URL;

pub(crate) const DEFAULT_REMOTE_BACKEND_HOST: &str = "127.0.0.1:4732";

#[cfg(debug_assertions)]
pub(crate) const DEFAULT_RELAY_HOST_URL: &str = "ws://127.0.0.1:5001/v1/api/ladonxrelay/host";
#[cfg(not(debug_assertions))]
pub(crate) const DEFAULT_RELAY_HOST_URL: &str = "wss://www.ladonx.com/v1/api/ladonxrelay/host";

fn ensure_preferred_file_path(
    file_name: &str,
    program_dir: &std::path::Path,
    app_data_dir: &std::path::Path,
) -> PathBuf {
    let preferred_path = program_dir.join(file_name);
    if preferred_path.exists() {
        return preferred_path;
    }

    let legacy_path = app_data_dir.join(file_name);
    if legacy_path.exists() {
        if let Some(parent) = preferred_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::copy(&legacy_path, &preferred_path);
        if preferred_path.exists() {
            return preferred_path;
        }
        return legacy_path;
    }

    preferred_path
}

fn ensure_preferred_file_path_with_legacy_names(
    preferred_name: &str,
    legacy_names: &[&str],
    program_dir: &std::path::Path,
    app_data_dir: &std::path::Path,
) -> PathBuf {
    let preferred_path = program_dir.join(preferred_name);
    if preferred_path.exists() {
        return preferred_path;
    }

    let mut legacy_paths = vec![app_data_dir.join(preferred_name)];
    for file_name in legacy_names {
        legacy_paths.push(program_dir.join(file_name));
        legacy_paths.push(app_data_dir.join(file_name));
    }

    for legacy_path in legacy_paths {
        if !legacy_path.exists() {
            continue;
        }
        if let Some(parent) = preferred_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::copy(&legacy_path, &preferred_path);
        if preferred_path.exists() {
            return preferred_path;
        }
        return legacy_path;
    }

    preferred_path
}

pub(crate) fn trim_optional_setting(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(crate) fn openai_api_key_from_env() -> Option<String> {
    trim_optional_setting(std::env::var(OPENAI_API_KEY_ENV).ok().as_deref())
}

pub(crate) fn resolve_codex_auth_path() -> Option<PathBuf> {
    resolve_effective_codex_home()
}

pub(crate) fn resolve_effective_codex_home() -> Option<PathBuf> {
    if let Ok(value) = std::env::var(CODEX_HOME_ENV) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    resolve_default_codex_home()
}

pub(crate) fn read_openai_api_key_from_auth_json() -> Option<String> {
    let auth_path = resolve_codex_auth_path()?.join("auth.json");
    let data = std::fs::read_to_string(&auth_path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&data).ok()?;
    let api_key = value.get(OPENAI_API_KEY_ENV).and_then(|v| v.as_str())?;
    trim_optional_setting(Some(api_key))
}

pub(crate) fn apply_openai_api_key_env(value: Option<&str>) {
    apply_openai_credentials_env(Some(CODEX_BASE_URL), value);
}

pub(crate) fn apply_openai_credentials_env(base_url: Option<&str>, api_key: Option<&str>) {
    if let Some(api_key) = trim_optional_setting(api_key) {
        std::env::set_var(OPENAI_API_KEY_ENV, api_key);
        if let Some(base_url) = trim_optional_setting(base_url) {
            std::env::set_var(OPENAI_BASE_URL_ENV, base_url);
        } else {
            std::env::remove_var(OPENAI_BASE_URL_ENV);
        }
    } else {
        std::env::remove_var(OPENAI_API_KEY_ENV);
        std::env::remove_var(OPENAI_BASE_URL_ENV);
    }
}

pub(crate) fn anthropic_api_key_from_env() -> Option<String> {
    trim_optional_setting(std::env::var(ANTHROPIC_API_KEY_ENV).ok().as_deref())
}

pub(crate) fn anthropic_base_url_from_env() -> Option<String> {
    trim_optional_setting(std::env::var(ANTHROPIC_BASE_URL_ENV).ok().as_deref())
}

pub(crate) fn apply_anthropic_api_key_env(value: Option<&str>) {
    apply_anthropic_credentials_env(Some(ANTHROPIC_BASE_URL), value);
}

pub(crate) fn apply_anthropic_credentials_env(base_url: Option<&str>, api_key: Option<&str>) {
    if let Some(api_key) = trim_optional_setting(api_key) {
        std::env::set_var(ANTHROPIC_API_KEY_ENV, api_key);
        if let Some(base_url) = trim_optional_setting(base_url) {
            std::env::set_var(ANTHROPIC_BASE_URL_ENV, base_url);
        } else {
            std::env::remove_var(ANTHROPIC_BASE_URL_ENV);
        }
    } else {
        std::env::remove_var(ANTHROPIC_API_KEY_ENV);
        std::env::remove_var(ANTHROPIC_BASE_URL_ENV);
    }
}

pub(crate) fn current_working_dir() -> PathBuf {
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

pub(crate) fn current_exe_path() -> Option<PathBuf> {
    std::env::current_exe().ok()
}

pub(crate) fn current_exe_dir() -> Option<PathBuf> {
    current_exe_path().and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
}

pub(crate) fn resolve_default_workspace_dir() -> Result<PathBuf, String> {
    resolve_ladonx_home().ok_or_else(|| "Unable to resolve user home directory".to_string())
}

pub(crate) fn resolve_settings_path(
    program_dir: &std::path::Path,
    app_data_dir: &std::path::Path,
) -> PathBuf {
    ensure_preferred_file_path_with_legacy_names(
        LADONX_SETTINGS_FILE_NAME,
        &[LEGACY_SETTINGS_FILE_NAME],
        program_dir,
        app_data_dir,
    )
}

pub(crate) fn resolve_workspaces_path(
    program_dir: &std::path::Path,
    app_data_dir: &std::path::Path,
) -> PathBuf {
    resolve_default_codex_home()
        .map(|home| home.join("workspaces.json"))
        .unwrap_or_else(|| ensure_preferred_file_path("workspaces.json", program_dir, app_data_dir))
}

pub(crate) fn resolve_default_codex_home() -> Option<PathBuf> {
    resolve_home_dir().map(|home| {
        #[cfg(target_os = "windows")]
        {
            home.join(".ladonx")
        }
        #[cfg(not(target_os = "windows"))]
        {
            home.join(".ladonx")
        }
    })
}

pub(crate) fn resolve_default_claude_home() -> Option<PathBuf> {
    resolve_home_dir().map(|home| {
        #[cfg(target_os = "windows")]
        {
            home.join(".ladonx")
        }
        #[cfg(not(target_os = "windows"))]
        {
            home.join(".ladonx")
        }
    })
}

pub(crate) fn apply_claude_home_env() {
    let claude_home = resolve_default_claude_home()
        .map(|path| path.to_string_lossy().to_string())
        .filter(|value| !value.trim().is_empty());

    match claude_home.as_deref() {
        Some(value) => {
            std::env::set_var(CLAUDE_HOME_ENV, value);
            std::env::set_var(CLAUDE_CONFIG_DIR_ENV, value);
        }
        None => {
            std::env::remove_var(CLAUDE_HOME_ENV);
            std::env::remove_var(CLAUDE_CONFIG_DIR_ENV);
        }
    }
}

pub(crate) fn resolve_legacy_codex_home() -> Option<PathBuf> {
    resolve_home_dir().map(|home| {
        #[cfg(target_os = "windows")]
        {
            home.join("codex")
        }
        #[cfg(not(target_os = "windows"))]
        {
            home.join(".ladonx").join("codex")
        }
    })
}

pub(crate) fn resolve_legacy_claude_home() -> Option<PathBuf> {
    resolve_home_dir().map(|home| {
        #[cfg(target_os = "windows")]
        {
            home.join("claude")
        }
        #[cfg(not(target_os = "windows"))]
        {
            home.join(".ladonx").join("claude")
        }
    })
}

pub(crate) fn migrate_legacy_tool_homes_to_ladonx_home() -> Result<(), String> {
    let Some(target_home) = resolve_ladonx_home() else {
        return Ok(());
    };

    std::fs::create_dir_all(&target_home)
        .map_err(|error| format!("Failed to create {}: {error}", target_home.display()))?;

    if let Some(legacy_codex_home) = resolve_legacy_codex_home() {
        remove_legacy_home_dir(&legacy_codex_home)?;
    }
    if let Some(legacy_claude_home) = resolve_legacy_claude_home() {
        remove_legacy_home_dir(&legacy_claude_home)?;
    }

    Ok(())
}

pub(crate) fn resolve_ladonx_home() -> Option<PathBuf> {
    resolve_home_dir().map(|home| home.join(".ladonx"))
}

pub(crate) fn resolve_runtime_data_dir() -> PathBuf {
    if cfg!(debug_assertions) {
        resolve_ladonx_home().unwrap_or_else(current_working_dir)
    } else {
        resolve_ladonx_home().unwrap_or_else(current_working_dir)
    }
}

pub(crate) fn normalize_configured_path(value: &str) -> Option<PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Some(path) = expand_tilde_path(trimmed) {
        return Some(path);
    }
    if let Some(path) = expand_dollar_env_path(trimmed) {
        return Some(path);
    }
    if let Some(path) = expand_percent_env_path(trimmed) {
        return Some(path);
    }
    Some(PathBuf::from(trimmed))
}

pub(crate) fn expand_home_path(path: &str) -> PathBuf {
    if path == "~" {
        if let Some(home) = resolve_home_dir() {
            return home;
        }
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = resolve_home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

pub(crate) fn resolve_home_dir() -> Option<PathBuf> {
    if let Some(value) = lookup_env_value("HOME") {
        return Some(PathBuf::from(value));
    }
    if let Some(value) = lookup_env_value("USERPROFILE") {
        return Some(PathBuf::from(value));
    }
    #[cfg(unix)]
    {
        // Fallback for daemon environments that do not expose HOME.
        unsafe {
            let uid = libc::geteuid();
            let pwd = libc::getpwuid(uid);
            if !pwd.is_null() {
                let dir_ptr = (*pwd).pw_dir;
                if !dir_ptr.is_null() {
                    if let Ok(dir) = std::ffi::CStr::from_ptr(dir_ptr).to_str() {
                        if !dir.trim().is_empty() {
                            return Some(PathBuf::from(dir));
                        }
                    }
                }
            }
        }
    }
    None
}

fn expand_tilde_path(value: &str) -> Option<PathBuf> {
    if !value.starts_with('~') {
        return None;
    }
    let home_dir = resolve_home_dir()?;
    if value == "~" {
        return Some(home_dir);
    }
    let rest = value.strip_prefix("~/")?;
    Some(home_dir.join(rest))
}

fn expand_dollar_env_path(value: &str) -> Option<PathBuf> {
    let rest = value.strip_prefix('$')?;
    if rest.is_empty() {
        return None;
    }

    let (var, remainder) = if let Some(inner) = rest.strip_prefix('{') {
        let end = inner.find('}')?;
        let name = &inner[..end];
        let remaining = &inner[end + 1..];
        (name, remaining)
    } else {
        let end = rest
            .find(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '_'))
            .unwrap_or(rest.len());
        let name = &rest[..end];
        let remaining = &rest[end..];
        (name, remaining)
    };

    if var.is_empty() {
        return None;
    }

    let value = resolve_env_var(var)?;
    Some(join_env_path(&value, remainder))
}

fn expand_percent_env_path(value: &str) -> Option<PathBuf> {
    let rest = value.strip_prefix('%')?;
    let end = rest.find('%')?;
    let var = &rest[..end];
    if var.is_empty() {
        return None;
    }
    let remainder = &rest[end + 1..];
    let value = resolve_env_var(var)?;
    Some(join_env_path(&value, remainder))
}

fn resolve_env_var(name: &str) -> Option<String> {
    if name.eq_ignore_ascii_case("HOME") {
        if let Some(home) = resolve_home_dir() {
            return Some(home.to_string_lossy().to_string());
        }
    }
    lookup_env_value(name)
}

fn lookup_env_value(name: &str) -> Option<String> {
    if let Ok(value) = std::env::var(name) {
        if !value.trim().is_empty() {
            return Some(value);
        }
    }
    let upper = name.to_ascii_uppercase();
    if upper != name {
        if let Ok(value) = std::env::var(&upper) {
            if !value.trim().is_empty() {
                return Some(value);
            }
        }
    }
    let lower = name.to_ascii_lowercase();
    if lower != name && lower != upper {
        if let Ok(value) = std::env::var(&lower) {
            if !value.trim().is_empty() {
                return Some(value);
            }
        }
    }
    None
}

fn join_env_path(prefix: &str, remainder: &str) -> PathBuf {
    let mut base = PathBuf::from(prefix.trim());
    let trimmed_remainder = remainder.trim_start_matches(['/', '\\']);
    if !trimmed_remainder.is_empty() {
        base.push(trimmed_remainder);
    }
    base
}

fn remove_legacy_home_dir(path: &std::path::Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to stat {}: {error}", path.display()))?;
    if metadata.is_dir() {
        std::fs::remove_dir_all(path)
            .map_err(|error| format!("Failed to remove directory {}: {error}", path.display()))
    } else {
        std::fs::remove_file(path)
            .map_err(|error| format!("Failed to remove file {}: {error}", path.display()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn normalize_configured_path_expands_home_and_env_vars() {
        let _guard = ENV_LOCK.lock().expect("lock env");
        let home_dir = std::env::temp_dir().join("ladonx-settings-test");
        let home_str = home_dir.to_string_lossy().to_string();

        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &home_str);

        let prev_appdata = std::env::var("APPDATA").ok();
        std::env::set_var("APPDATA", "/tmp/appdata-root");

        assert_eq!(
            normalize_configured_path("~/.codex-api"),
            Some(home_dir.join(".codex-api"))
        );
        assert_eq!(
            normalize_configured_path("$HOME/.codex-api"),
            Some(home_dir.join(".codex-api"))
        );
        assert_eq!(
            normalize_configured_path("${HOME}/.codex-api"),
            Some(home_dir.join(".codex-api"))
        );
        assert_eq!(
            normalize_configured_path("%APPDATA%/Codex"),
            Some(PathBuf::from("/tmp/appdata-root/Codex"))
        );
        assert_eq!(
            normalize_configured_path("$appdata/Codex"),
            Some(PathBuf::from("/tmp/appdata-root/Codex"))
        );

        match prev_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }

        match prev_appdata {
            Some(value) => std::env::set_var("APPDATA", value),
            None => std::env::remove_var("APPDATA"),
        }
    }

    #[test]
    fn resolve_default_workspace_dir_uses_platform_stable_home_location() {
        let _guard = ENV_LOCK.lock().expect("lock env");
        let home_dir = std::env::temp_dir().join("ladonx-default-workspace-home");
        let home_str = home_dir.to_string_lossy().to_string();

        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &home_str);

        let prev_userprofile = std::env::var("USERPROFILE").ok();
        std::env::set_var("USERPROFILE", &home_str);

        let resolved = resolve_default_workspace_dir().expect("resolve default workspace dir");
        #[cfg(target_os = "windows")]
        assert_eq!(resolved, home_dir.join(".ladonx"));
        #[cfg(not(target_os = "windows"))]
        assert_eq!(resolved, home_dir.join(".ladonx"));

        match prev_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        match prev_userprofile {
            Some(value) => std::env::set_var("USERPROFILE", value),
            None => std::env::remove_var("USERPROFILE"),
        }
    }

    #[test]
    fn resolve_default_tool_homes_use_ladonx_subdirectories() {
        let _guard = ENV_LOCK.lock().expect("lock env");
        let home_dir = std::env::temp_dir().join("ladonx-default-tool-home");
        let home_str = home_dir.to_string_lossy().to_string();

        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &home_str);

        let prev_userprofile = std::env::var("USERPROFILE").ok();
        std::env::set_var("USERPROFILE", &home_str);

        let prev_codex_home = std::env::var(CODEX_HOME_ENV).ok();
        std::env::remove_var(CODEX_HOME_ENV);

        let prev_claude_home = std::env::var(CLAUDE_HOME_ENV).ok();
        std::env::remove_var(CLAUDE_HOME_ENV);

        assert_eq!(resolve_ladonx_home(), Some(home_dir.join(".ladonx")));
        assert_eq!(resolve_default_codex_home(), Some(home_dir.join(".ladonx")));
        assert_eq!(
            resolve_default_claude_home(),
            Some(home_dir.join(".ladonx"))
        );
        assert_eq!(
            resolve_legacy_codex_home(),
            Some(home_dir.join(".ladonx/codex"))
        );
        assert_eq!(
            resolve_legacy_claude_home(),
            Some(home_dir.join(".ladonx/claude"))
        );

        match prev_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        match prev_userprofile {
            Some(value) => std::env::set_var("USERPROFILE", value),
            None => std::env::remove_var("USERPROFILE"),
        }
        match prev_codex_home {
            Some(value) => std::env::set_var(CODEX_HOME_ENV, value),
            None => std::env::remove_var(CODEX_HOME_ENV),
        }
        match prev_claude_home {
            Some(value) => std::env::set_var(CLAUDE_HOME_ENV, value),
            None => std::env::remove_var(CLAUDE_HOME_ENV),
        }
    }

    #[test]
    fn apply_claude_home_env_sets_claude_env_vars_to_ladonx_home() {
        let _guard = ENV_LOCK.lock().expect("lock env");
        let home_dir = std::env::temp_dir().join("ladonx-apply-claude-home");
        let home_str = home_dir.to_string_lossy().to_string();

        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &home_str);

        let prev_userprofile = std::env::var("USERPROFILE").ok();
        std::env::set_var("USERPROFILE", &home_str);

        let prev_claude_home = std::env::var(CLAUDE_HOME_ENV).ok();
        let prev_claude_config_dir = std::env::var(CLAUDE_CONFIG_DIR_ENV).ok();

        apply_claude_home_env();

        let expected = home_dir.join(".ladonx").to_string_lossy().to_string();
        assert_eq!(std::env::var(CLAUDE_HOME_ENV).ok(), Some(expected.clone()));
        assert_eq!(std::env::var(CLAUDE_CONFIG_DIR_ENV).ok(), Some(expected));

        match prev_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        match prev_userprofile {
            Some(value) => std::env::set_var("USERPROFILE", value),
            None => std::env::remove_var("USERPROFILE"),
        }
        match prev_claude_home {
            Some(value) => std::env::set_var(CLAUDE_HOME_ENV, value),
            None => std::env::remove_var(CLAUDE_HOME_ENV),
        }
        match prev_claude_config_dir {
            Some(value) => std::env::set_var(CLAUDE_CONFIG_DIR_ENV, value),
            None => std::env::remove_var(CLAUDE_CONFIG_DIR_ENV),
        }
    }

    #[test]
    fn migrate_legacy_tool_homes_removes_legacy_dirs_without_moving_contents() {
        let _guard = ENV_LOCK.lock().expect("lock env");
        let temp_root = std::env::temp_dir().join(format!(
            "ladonx-migrate-home-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("unix epoch")
                .as_nanos()
        ));
        let home_dir = temp_root.join("home");
        let ladonx_home = home_dir.join(".ladonx");
        let legacy_codex_home = ladonx_home.join("codex");
        let legacy_claude_home = ladonx_home.join("claude");

        fs::create_dir_all(legacy_codex_home.join("skills")).expect("create legacy codex dir");
        fs::create_dir_all(legacy_claude_home.join("projects")).expect("create legacy claude dir");
        fs::write(legacy_codex_home.join("config.toml"), "new-config").expect("write config");
        fs::write(
            legacy_codex_home.join("auth.json"),
            "{\"OPENAI_API_KEY\":\"a\"}",
        )
        .expect("write auth");
        fs::write(legacy_codex_home.join("skills/agent.md"), "skill").expect("write skill");
        fs::write(legacy_claude_home.join("projects/chat.json"), "chat").expect("write project");
        fs::write(ladonx_home.join("config.toml"), "old-config").expect("write existing target");

        let prev_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", home_dir.to_string_lossy().to_string());

        let prev_userprofile = std::env::var("USERPROFILE").ok();
        std::env::set_var("USERPROFILE", home_dir.to_string_lossy().to_string());

        migrate_legacy_tool_homes_to_ladonx_home().expect("migrate legacy homes");

        assert_eq!(
            fs::read_to_string(ladonx_home.join("config.toml")).expect("read existing target"),
            "old-config"
        );
        assert!(!ladonx_home.join("auth.json").exists());
        assert!(!ladonx_home.join("skills/agent.md").exists());
        assert!(!ladonx_home.join("projects/chat.json").exists());
        assert!(!legacy_codex_home.exists());
        assert!(!legacy_claude_home.exists());

        match prev_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        match prev_userprofile {
            Some(value) => std::env::set_var("USERPROFILE", value),
            None => std::env::remove_var("USERPROFILE"),
        }

        let _ = fs::remove_dir_all(temp_root);
    }
}
