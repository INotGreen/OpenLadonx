use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct TextFileResponse {
    pub exists: bool,
    pub content: String,
    pub truncated: bool,
    pub path: String,
}

fn missing_response(path: PathBuf) -> TextFileResponse {
    TextFileResponse {
        exists: false,
        content: String::new(),
        truncated: false,
        path: path.to_string_lossy().to_string(),
    }
}

fn resolve_root(
    root: &Path,
    root_context: &str,
    root_may_be_missing: bool,
) -> Result<Option<PathBuf>, String> {
    if root_may_be_missing && !root.exists() {
        return Ok(None);
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|err| format!("Failed to resolve {root_context}: {err}"))?;
    if !canonical_root.is_dir() {
        return Err(format!("{root_context} is not a directory"));
    }
    Ok(Some(canonical_root))
}

fn resolve_or_create_root(root: &Path, root_context: &str) -> Result<PathBuf, String> {
    std::fs::create_dir_all(root)
        .map_err(|err| format!("Failed to create {root_context}: {err}"))?;
    let canonical_root = root
        .canonicalize()
        .map_err(|err| format!("Failed to resolve {root_context}: {err}"))?;
    if !canonical_root.is_dir() {
        return Err(format!("{root_context} is not a directory"));
    }
    Ok(canonical_root)
}

pub(crate) fn read_text_file_within(
    root: &Path,
    filename: &str,
    root_may_be_missing: bool,
    root_context: &str,
    file_context: &str,
    allow_external_symlink_target: bool,
) -> Result<TextFileResponse, String> {
    let Some(canonical_root) = resolve_root(root, root_context, root_may_be_missing)? else {
        return Ok(missing_response(root.join(filename)));
    };

    let candidate = canonical_root.join(filename);
    if !candidate.exists() {
        return Ok(missing_response(candidate));
    }

    let candidate_is_symlink = std::fs::symlink_metadata(&candidate)
        .map_err(|err| format!("Failed to open {file_context}: {err}"))?
        .file_type()
        .is_symlink();
    let canonical_path = candidate
        .canonicalize()
        .map_err(|err| format!("Failed to open {file_context}: {err}"))?;
    if !canonical_path.starts_with(&canonical_root)
        && !(allow_external_symlink_target && candidate_is_symlink)
    {
        return Err(format!("Invalid {file_context} path"));
    }

    let mut file = File::open(&canonical_path)
        .map_err(|err| format!("Failed to open {file_context}: {err}"))?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)
        .map_err(|err| format!("Failed to read {file_context}: {err}"))?;
    let content =
        String::from_utf8(buffer).map_err(|_| format!("{file_context} is not valid UTF-8"))?;

    Ok(TextFileResponse {
        exists: true,
        content,
        truncated: false,
        path: canonical_path.to_string_lossy().to_string(),
    })
}

pub(crate) fn write_text_file_within(
    root: &Path,
    filename: &str,
    content: &str,
    create_root: bool,
    root_context: &str,
    file_context: &str,
    allow_external_symlink_target: bool,
) -> Result<(), String> {
    let canonical_root = if create_root {
        resolve_or_create_root(root, root_context)?
    } else {
        resolve_root(root, root_context, false)?
            .ok_or_else(|| format!("Failed to resolve {root_context}"))?
    };

    let candidate = canonical_root.join(filename);
    if !candidate.starts_with(&canonical_root) {
        return Err(format!("Invalid {file_context} path"));
    }

    let target_path = if candidate.exists() {
        let candidate_is_symlink = std::fs::symlink_metadata(&candidate)
            .map_err(|err| format!("Failed to resolve {file_context}: {err}"))?
            .file_type()
            .is_symlink();
        let canonical_path = candidate
            .canonicalize()
            .map_err(|err| format!("Failed to resolve {file_context}: {err}"))?;
        if !canonical_path.starts_with(&canonical_root)
            && !(allow_external_symlink_target && candidate_is_symlink)
        {
            return Err(format!("Invalid {file_context} path"));
        }
        canonical_path
    } else {
        candidate
    };

    std::fs::write(&target_path, content)
        .map_err(|err| format!("Failed to write {file_context}: {err}"))
}
