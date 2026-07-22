use std::path::PathBuf;

use crate::types::WorkspaceEntry;

pub(crate) fn resolve_workspace_codex_home(
    _entry: &WorkspaceEntry,
    _parent_entry: Option<&WorkspaceEntry>,
) -> Option<PathBuf> {
    resolve_default_codex_home()
}

pub(crate) fn resolve_default_codex_home() -> Option<PathBuf> {
    crate::settings::resolve_default_codex_home()
}

pub(crate) fn resolve_home_dir() -> Option<PathBuf> {
    crate::settings::resolve_home_dir()
}
