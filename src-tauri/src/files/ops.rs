use std::path::PathBuf;

use crate::files::io::{read_text_file_within, write_text_file_within, TextFileResponse};
use crate::files::policy::FilePolicy;

pub(crate) fn read_with_policy(
    root: &PathBuf,
    policy: FilePolicy,
) -> Result<TextFileResponse, String> {
    read_text_file_within(
        root,
        policy.filename,
        policy.root_may_be_missing,
        policy.root_context,
        policy.filename,
        policy.allow_external_symlink_target,
    )
}

pub(crate) fn write_with_policy(
    root: &PathBuf,
    policy: FilePolicy,
    content: &str,
) -> Result<(), String> {
    write_text_file_within(
        root,
        policy.filename,
        content,
        policy.create_root,
        policy.root_context,
        policy.filename,
        policy.allow_external_symlink_target,
    )
}
