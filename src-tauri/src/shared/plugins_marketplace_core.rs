use crate::shared::config_toml_core;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginMarketItem {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) display_name: String,
    pub(crate) description: String,
    pub(crate) short_description: Option<String>,
    pub(crate) long_description: Option<String>,
    pub(crate) category: Option<String>,
    pub(crate) version: Option<String>,
    pub(crate) developer_name: Option<String>,
    pub(crate) homepage: Option<String>,
    pub(crate) repository: Option<String>,
    pub(crate) license: Option<String>,
    pub(crate) brand_color: Option<String>,
    pub(crate) icon_data_url: Option<String>,
    pub(crate) source_marketplace: String,
    pub(crate) installation_policy: Option<String>,
    pub(crate) installed: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfiguredPluginItem {
    pub(crate) key: String,
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) description: Option<String>,
    pub(crate) icon_data_url: Option<String>,
    pub(crate) brand_color: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketplaceManifest {
    plugins: Vec<MarketplaceEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketplaceEntry {
    name: String,
    source: Option<MarketplaceSource>,
    policy: Option<MarketplacePolicy>,
    category: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketplaceSource {
    source: Option<String>,
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketplacePolicy {
    installation: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PluginManifest {
    name: Option<String>,
    version: Option<String>,
    description: Option<String>,
    homepage: Option<String>,
    repository: Option<String>,
    license: Option<String>,
    interface: Option<PluginInterface>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginInterface {
    display_name: Option<String>,
    short_description: Option<String>,
    long_description: Option<String>,
    category: Option<String>,
    developer_name: Option<String>,
    brand_color: Option<String>,
    logo: Option<String>,
}

pub(crate) fn list_plugins_marketplace_core(
    cli_home: Option<PathBuf>,
) -> Result<Vec<PluginMarketItem>, String> {
    let Some(cli_home) = cli_home else {
        return Ok(Vec::new());
    };
    let marketplace_root = cli_home.join(".tmp").join("plugins");
    let marketplace_json = marketplace_root
        .join(".agents")
        .join("plugins")
        .join("marketplace.json");
    if !marketplace_json.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(&marketplace_json)
        .map_err(|err| format!("Failed to read marketplace.json: {err}"))?;
    let manifest: MarketplaceManifest = serde_json::from_str(&raw)
        .map_err(|err| format!("Failed to parse marketplace.json: {err}"))?;

    let source_marketplace = marketplace_name(&raw).unwrap_or_else(|| "marketplace".to_string());
    let cache_root = cli_home.join("plugins").join("cache");
    let (_, document) = config_toml_core::load_global_config_document(&cli_home)
        .unwrap_or((false, toml_edit::Document::new()));
    let mut items = Vec::new();
    for entry in manifest.plugins {
        let relative_path = entry
            .source
            .as_ref()
            .and_then(|source| source.path.as_deref())
            .map(|value| value.to_string())
            .unwrap_or_else(|| format!("./plugins/{}", entry.name));
        let plugin_dir = normalize_plugin_dir(&marketplace_root, &relative_path, &entry.name);
        let plugin_json = plugin_dir.join(".codex-plugin").join("plugin.json");
        let parsed = parse_plugin_manifest(&plugin_json);
        let display_name = parsed
            .as_ref()
            .and_then(|(m, _)| m.interface.as_ref())
            .and_then(|iface| iface.display_name.clone())
            .or_else(|| parsed.as_ref().and_then(|(m, _)| m.name.clone()))
            .unwrap_or_else(|| entry.name.clone());
        let (
            interface_logo,
            category_override,
            short_description,
            long_description,
            developer_name,
            brand_color,
        ) = match parsed.as_ref().and_then(|(m, _)| m.interface.as_ref()) {
            Some(iface) => (
                iface.logo.clone(),
                iface.category.clone(),
                iface.short_description.clone(),
                iface.long_description.clone(),
                iface.developer_name.clone(),
                iface.brand_color.clone(),
            ),
            None => (None, None, None, None, None, None),
        };
        let icon_data_url =
            resolve_plugin_icon(&plugin_dir, interface_logo.as_deref(), &entry.name);
        let description = parsed
            .as_ref()
            .and_then(|(m, _)| m.description.clone())
            .or_else(|| short_description.clone())
            .unwrap_or_default();
        items.push(PluginMarketItem {
            id: entry.name.clone(),
            name: entry.name.clone(),
            display_name,
            description,
            short_description,
            long_description,
            category: category_override.or(entry.category),
            version: parsed.as_ref().and_then(|(m, _)| m.version.clone()),
            developer_name,
            homepage: parsed.as_ref().and_then(|(m, _)| m.homepage.clone()),
            repository: parsed.as_ref().and_then(|(m, _)| m.repository.clone()),
            license: parsed.as_ref().and_then(|(m, _)| m.license.clone()),
            brand_color,
            icon_data_url,
            source_marketplace: source_marketplace.clone(),
            installation_policy: entry
                .policy
                .as_ref()
                .and_then(|policy| policy.installation.clone()),
            installed: read_plugin_enabled(&document, &source_marketplace, &entry.name)
                .unwrap_or_else(|| {
                    is_plugin_installed(&cache_root, &source_marketplace, &entry.name)
                }),
        });
    }

    items.sort_by(|left, right| {
        left.display_name
            .to_ascii_lowercase()
            .cmp(&right.display_name.to_ascii_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(items)
}

pub(crate) fn list_configured_plugins_core(
    cli_home: Option<PathBuf>,
) -> Result<Vec<ConfiguredPluginItem>, String> {
    let Some(cli_home) = cli_home else {
        return Ok(Vec::new());
    };
    let (_, document) = config_toml_core::load_global_config_document(&cli_home)?;
    let Some(plugins_table) = config_toml_core::read_table_item(&document, "plugins") else {
        return Ok(Vec::new());
    };
    let marketplace_items =
        list_plugins_marketplace_core(Some(cli_home.clone())).unwrap_or_default();
    let mut configured = Vec::new();
    for (plugin_key, item) in plugins_table.iter() {
        let Some(plugin_table) = item.as_table_like() else {
            continue;
        };
        if plugin_table
            .get("enabled")
            .and_then(|value| value.as_bool())
            != Some(true)
        {
            continue;
        }
        let (plugin_name, marketplace_name) = split_plugin_key(plugin_key);
        let metadata = marketplace_items.iter().find(|candidate| {
            candidate.name == plugin_name && candidate.source_marketplace == marketplace_name
        });
        let path = resolve_configured_plugin_path(&cli_home, &marketplace_name, &plugin_name);
        configured.push(ConfiguredPluginItem {
            key: plugin_key.to_string(),
            name: metadata
                .map(|plugin| plugin.display_name.clone())
                .unwrap_or_else(|| plugin_name.clone()),
            path: path.to_string_lossy().to_string(),
            description: metadata
                .map(|plugin| plugin.description.clone())
                .filter(|value| !value.is_empty()),
            icon_data_url: metadata.and_then(|plugin| plugin.icon_data_url.clone()),
            brand_color: metadata.and_then(|plugin| plugin.brand_color.clone()),
        });
    }
    configured.sort_by(|left, right| {
        left.name
            .to_ascii_lowercase()
            .cmp(&right.name.to_ascii_lowercase())
            .then_with(|| left.key.cmp(&right.key))
    });
    Ok(configured)
}

fn marketplace_name(raw: &str) -> Option<String> {
    let value: Value = serde_json::from_str(raw).ok()?;
    value
        .get("name")
        .and_then(Value::as_str)
        .map(|value| value.to_string())
}

fn normalize_plugin_dir(marketplace_root: &Path, relative: &str, fallback_name: &str) -> PathBuf {
    let trimmed = relative.trim_start_matches("./");
    let path = marketplace_root.join(trimmed);
    if path.is_dir() {
        return path;
    }
    marketplace_root.join("plugins").join(fallback_name)
}

fn parse_plugin_manifest(plugin_json: &Path) -> Option<(PluginManifest, PathBuf)> {
    let raw = fs::read_to_string(plugin_json).ok()?;
    let manifest: PluginManifest = serde_json::from_str(&raw).ok()?;
    Some((manifest, plugin_json.to_path_buf()))
}

fn resolve_plugin_icon(
    plugin_dir: &Path,
    interface_logo: Option<&str>,
    plugin_name: &str,
) -> Option<String> {
    let candidates = icon_candidates(plugin_dir, interface_logo, plugin_name);
    for candidate in candidates {
        if let Some(data_url) = read_png_as_data_url(&candidate) {
            return Some(data_url);
        }
    }
    None
}

fn is_plugin_installed(cache_root: &Path, marketplace: &str, plugin_name: &str) -> bool {
    cache_root.join(marketplace).join(plugin_name).is_dir()
}

pub(crate) fn plugin_cache_dir(cache_root: &Path, marketplace: &str, plugin_name: &str) -> PathBuf {
    cache_root.join(marketplace).join(plugin_name)
}

pub(crate) fn plugin_key(marketplace: &str, plugin_name: &str) -> String {
    format!("{plugin_name}@{marketplace}")
}

fn split_plugin_key(plugin_key: &str) -> (String, String) {
    let mut parts = plugin_key.splitn(2, '@');
    let plugin_name = parts.next().unwrap_or(plugin_key).trim().to_string();
    let marketplace = parts.next().unwrap_or("marketplace").trim().to_string();
    (plugin_name, marketplace)
}

fn resolve_configured_plugin_path(
    cli_home: &Path,
    marketplace: &str,
    plugin_name: &str,
) -> PathBuf {
    let cache_root = cli_home.join("plugins").join("cache");
    let plugin_root = plugin_cache_dir(&cache_root, marketplace, plugin_name);
    if !plugin_root.is_dir() {
        return plugin_root;
    }
    let Ok(entries) = fs::read_dir(&plugin_root) else {
        return plugin_root;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            return entry.path();
        }
    }
    plugin_root
}

pub(crate) fn cache_plugin_source_path(cli_home: &Path, plugin_name: &str) -> PathBuf {
    cli_home
        .join(".tmp")
        .join("plugins")
        .join("plugins")
        .join(plugin_name)
}

pub(crate) fn read_plugin_enabled(
    document: &toml_edit::Document,
    marketplace: &str,
    plugin_name: &str,
) -> Option<bool> {
    config_toml_core::read_plugin_enabled(document, &plugin_key(marketplace, plugin_name))
}

pub(crate) fn copy_plugin_dir(source: &Path, target: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Err(format!(
            "Plugin source directory does not exist: {}",
            source.display()
        ));
    }
    if target.exists() {
        fs::remove_dir_all(target)
            .map_err(|err| format!("Failed to remove existing plugin cache: {err}"))?;
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create plugin cache parent: {err}"))?;
    }
    copy_dir_recursive(source, target)
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|err| format!("Failed to create plugin cache directory: {err}"))?;
    for entry in fs::read_dir(source)
        .map_err(|err| format!("Failed to read plugin source directory: {err}"))?
    {
        let entry = entry.map_err(|err| format!("Failed to read plugin source entry: {err}"))?;
        let file_type = entry
            .file_type()
            .map_err(|err| format!("Failed to read plugin source file type: {err}"))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if file_type.is_dir() {
            copy_dir_recursive(&source_path, &target_path)?;
        } else if file_type.is_file() {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|err| format!("Failed to create plugin cache parent: {err}"))?;
            }
            fs::copy(&source_path, &target_path)
                .map_err(|err| format!("Failed to copy plugin file: {err}"))?;
        } else if file_type.is_symlink() {
            let metadata = fs::metadata(&source_path)
                .map_err(|err| format!("Failed to read plugin symlink target: {err}"))?;
            if metadata.is_dir() {
                copy_dir_recursive(&source_path, &target_path)?;
            } else if metadata.is_file() {
                fs::copy(&source_path, &target_path)
                    .map_err(|err| format!("Failed to copy plugin symlink file: {err}"))?;
            }
        }
    }
    Ok(())
}

pub(crate) fn remove_plugin_dir(target: &Path) -> Result<(), String> {
    if !target.exists() {
        return Ok(());
    }
    fs::remove_dir_all(target).or_else(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            Ok(())
        } else {
            Err(format!("Failed to remove plugin cache directory: {error}"))
        }
    })
}

pub(crate) fn detect_plugin_version(source_dir: &Path) -> Option<String> {
    let plugin_json = source_dir.join(".codex-plugin").join("plugin.json");
    let raw = fs::read_to_string(plugin_json).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    value
        .get("version")
        .and_then(Value::as_str)
        .map(|value| value.to_string())
}

const MAX_ICON_BYTES: u64 = 200 * 1024;

fn icon_candidates(
    plugin_dir: &Path,
    interface_logo: Option<&str>,
    plugin_name: &str,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(logo) = interface_logo {
        let stripped = logo.trim_start_matches("./");
        let path = plugin_dir.join(stripped);
        if path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("png"))
            .unwrap_or(false)
        {
            candidates.push(path);
        }
    }
    let assets_dir = plugin_dir.join("assets");
    candidates.push(assets_dir.join("app-icon.png"));
    candidates.push(assets_dir.join(format!("{plugin_name}.png")));
    candidates
}

fn read_png_as_data_url(path: &Path) -> Option<String> {
    if !path.is_file() {
        return None;
    }
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() > MAX_ICON_BYTES {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    if bytes.len() > MAX_ICON_BYTES as usize {
        return None;
    }
    let encoded = STANDARD.encode(&bytes);
    Some(format!("data:image/png;base64,{encoded}"))
}
