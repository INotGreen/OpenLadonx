use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum FileScope {
    Workspace,
    Global,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum FileKind {
    Agents,
    Config,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct FilePolicy {
    pub(crate) filename: &'static str,
    pub(crate) root_context: &'static str,
    pub(crate) root_may_be_missing: bool,
    pub(crate) create_root: bool,
    pub(crate) allow_external_symlink_target: bool,
}

const AGENTS_FILENAME: &str = "AGENTS.md";
const CONFIG_FILENAME: &str = "config.toml";

pub(crate) fn policy_for(scope: FileScope, kind: FileKind) -> Result<FilePolicy, String> {
    match (scope, kind) {
        (FileScope::Workspace, FileKind::Agents) => Ok(FilePolicy {
            filename: AGENTS_FILENAME,
            root_context: "workspace root",
            root_may_be_missing: false,
            create_root: false,
            allow_external_symlink_target: false,
        }),
        (FileScope::Global, FileKind::Agents) => Ok(FilePolicy {
            filename: AGENTS_FILENAME,
            root_context: "CODEX_HOME",
            root_may_be_missing: true,
            create_root: true,
            allow_external_symlink_target: true,
        }),
        (FileScope::Global, FileKind::Config) => Ok(FilePolicy {
            filename: CONFIG_FILENAME,
            root_context: "CODEX_HOME",
            root_may_be_missing: true,
            create_root: true,
            allow_external_symlink_target: false,
        }),
        (FileScope::Workspace, FileKind::Config) => {
            Err("config.toml is only supported for global scope".to_string())
        }
    }
}
