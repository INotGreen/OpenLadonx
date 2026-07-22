use std::ffi::OsString;
use std::fs;
#[cfg(target_os = "windows")]
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
#[cfg(unix)]
use std::thread;
use std::time::Duration;
#[cfg(unix)]
use std::time::Instant;

pub(crate) const HELPER_FLAG: &str = "--self-update-helper";

fn std_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

#[derive(Debug, Clone)]
pub(crate) struct SelfUpdatePlan {
    pub(crate) wait_pid: u32,
    pub(crate) source_path: PathBuf,
    pub(crate) target_path: PathBuf,
    pub(crate) restart_path: PathBuf,
    pub(crate) helper_source_path: PathBuf,
    pub(crate) helper_path: PathBuf,
}

#[derive(Debug, Clone)]
struct HelperArgs {
    wait_pid: u32,
    source_path: PathBuf,
    target_path: PathBuf,
    restart_path: PathBuf,
}

pub(crate) fn maybe_run_from_args(args: &[OsString]) -> Result<bool, String> {
    if args.get(1).and_then(|value| value.to_str()) != Some(HELPER_FLAG) {
        return Ok(false);
    }
    let parsed = parse_helper_args(args)?;
    run_helper(parsed)?;
    Ok(true)
}

pub(crate) fn spawn_helper(plan: &SelfUpdatePlan) -> Result<(), String> {
    if let Some(parent) = plan.helper_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create updater directory: {error}"))?;
    }
    if plan.helper_path.exists() {
        let _ = fs::remove_file(&plan.helper_path);
    }
    fs::copy(&plan.helper_source_path, &plan.helper_path)
        .map_err(|error| format!("Failed to stage updater helper: {error}"))?;

    let mut command = std_command(&plan.helper_path);
    command
        .arg(HELPER_FLAG)
        .arg("--wait-pid")
        .arg(plan.wait_pid.to_string())
        .arg("--source")
        .arg(&plan.source_path)
        .arg("--target")
        .arg(&plan.target_path)
        .arg("--restart")
        .arg(&plan.restart_path);
    command
        .spawn()
        .map_err(|error| format!("Failed to launch updater helper: {error}"))?;
    Ok(())
}

fn parse_helper_args(args: &[OsString]) -> Result<HelperArgs, String> {
    let mut wait_pid = None;
    let mut source_path = None;
    let mut target_path = None;
    let mut restart_path = None;
    let mut index = 2usize;

    while index < args.len() {
        let key = args[index]
            .to_str()
            .ok_or_else(|| "Updater helper received invalid unicode argument.".to_string())?;
        let value = args
            .get(index + 1)
            .ok_or_else(|| format!("Missing value for updater helper argument {key}"))?;
        match key {
            "--wait-pid" => {
                let raw = value
                    .to_str()
                    .ok_or_else(|| "Invalid wait pid argument.".to_string())?;
                wait_pid = Some(
                    raw.parse::<u32>()
                        .map_err(|error| format!("Invalid wait pid `{raw}`: {error}"))?,
                );
            }
            "--source" => source_path = Some(PathBuf::from(value)),
            "--target" => target_path = Some(PathBuf::from(value)),
            "--restart" => restart_path = Some(PathBuf::from(value)),
            other => return Err(format!("Unknown updater helper argument: {other}")),
        }
        index += 2;
    }

    Ok(HelperArgs {
        wait_pid: wait_pid.ok_or_else(|| "Missing updater wait pid.".to_string())?,
        source_path: source_path.ok_or_else(|| "Missing updater source path.".to_string())?,
        target_path: target_path.ok_or_else(|| "Missing updater target path.".to_string())?,
        restart_path: restart_path.ok_or_else(|| "Missing updater restart path.".to_string())?,
    })
}

fn run_helper(args: HelperArgs) -> Result<(), String> {
    wait_for_process_exit(args.wait_pid, Duration::from_secs(120))?;

    #[cfg(target_os = "macos")]
    install_macos_update(&args)?;

    #[cfg(target_os = "windows")]
    install_windows_update(&args)?;

    #[cfg(all(unix, not(target_os = "macos")))]
    install_posix_update(&args)?;

    Ok(())
}

#[cfg(unix)]
fn wait_for_process_exit(pid: u32, timeout: Duration) -> Result<(), String> {
    let start = Instant::now();
    loop {
        let status = unsafe { libc::kill(pid as i32, 0) };
        if status != 0 {
            let errno = std::io::Error::last_os_error()
                .raw_os_error()
                .unwrap_or_default();
            if errno == libc::ESRCH {
                return Ok(());
            }
        }
        if start.elapsed() >= timeout {
            return Err("Timed out waiting for app process to exit.".to_string());
        }
        thread::sleep(Duration::from_millis(300));
    }
}

#[cfg(target_os = "windows")]
fn wait_for_process_exit(pid: u32, timeout: Duration) -> Result<(), String> {
    use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    const SYNCHRONIZE_ACCESS: u32 = 0x0010_0000;

    let handle = unsafe {
        OpenProcess(
            SYNCHRONIZE_ACCESS | PROCESS_QUERY_LIMITED_INFORMATION,
            0,
            pid,
        )
    };
    if handle.is_null() {
        return Ok(());
    }

    let wait_ms = timeout.as_millis().min(u32::MAX as u128) as u32;
    let result = unsafe { WaitForSingleObject(handle, wait_ms) };
    unsafe {
        CloseHandle(handle);
    }
    match result {
        WAIT_OBJECT_0 => Ok(()),
        WAIT_TIMEOUT => Err("Timed out waiting for app process to exit.".to_string()),
        _ => Err("Failed while waiting for app process to exit.".to_string()),
    }
}

#[cfg(target_os = "macos")]
fn install_macos_update(args: &HelperArgs) -> Result<(), String> {
    let mount_dir = std::env::temp_dir().join(format!("ladonx-update-{}", std::process::id()));
    if mount_dir.exists() {
        let _ = fs::remove_dir_all(&mount_dir);
    }
    fs::create_dir_all(&mount_dir)
        .map_err(|error| format!("Failed to create mount directory: {error}"))?;

    let detach = || {
        let _ = Command::new("/usr/bin/hdiutil")
            .arg("detach")
            .arg(&mount_dir)
            .arg("-quiet")
            .status();
        let _ = fs::remove_dir_all(&mount_dir);
    };

    let status = Command::new("/usr/bin/hdiutil")
        .arg("attach")
        .arg(&args.source_path)
        .arg("-nobrowse")
        .arg("-quiet")
        .arg("-mountpoint")
        .arg(&mount_dir)
        .status()
        .map_err(|error| format!("Failed to mount update dmg: {error}"))?;
    if !status.success() {
        detach();
        return Err(format!("Failed to mount update dmg: exit {status}"));
    }

    let mounted_app = fs::read_dir(&mount_dir)
        .map_err(|error| format!("Failed to inspect mounted dmg: {error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("app"))
                .unwrap_or(false)
        })
        .ok_or_else(|| "No .app bundle found in downloaded dmg.".to_string())?;

    let temp_target = args.target_path.with_extension("app.updating");
    if temp_target.exists() {
        let _ = fs::remove_dir_all(&temp_target);
    }
    let status = Command::new("/usr/bin/ditto")
        .arg(&mounted_app)
        .arg(&temp_target)
        .status()
        .map_err(|error| format!("Failed to copy updated app bundle: {error}"))?;
    if !status.success() {
        detach();
        return Err(format!("Failed to copy updated app bundle: exit {status}"));
    }

    if args.target_path.exists() {
        fs::remove_dir_all(&args.target_path)
            .map_err(|error| format!("Failed to remove current app bundle: {error}"))?;
    }
    fs::rename(&temp_target, &args.target_path)
        .map_err(|error| format!("Failed to replace app bundle: {error}"))?;
    detach();

    Command::new("/usr/bin/open")
        .arg(&args.restart_path)
        .spawn()
        .map_err(|error| format!("Failed to relaunch updated app: {error}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn is_zip_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("zip"))
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn is_msi_path(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("msi"))
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn retry_io<T>(
    description: &str,
    mut action: impl FnMut() -> std::io::Result<T>,
) -> Result<T, String> {
    let mut last_error = None;
    for _ in 0..40 {
        match action() {
            Ok(value) => return Ok(value),
            Err(error) => {
                last_error = Some(error);
                std::thread::sleep(Duration::from_millis(250));
            }
        }
    }
    Err(format!(
        "{description}: {}",
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "operation did not complete".to_string())
    ))
}

#[cfg(target_os = "windows")]
fn stop_ladonx_processes() {
    let current_pid = std::process::id().to_string();
    let script = format!(
        "$current = {current_pid}; \
         Get-Process ladonx,ladonx_daemon,ladonx_daemonctl -ErrorAction SilentlyContinue | \
         Where-Object {{ $_.Id -ne $current }} | \
         Stop-Process -Force -ErrorAction SilentlyContinue"
    );
    let _ = std_command("powershell.exe")
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(script)
        .status();
}

#[cfg(target_os = "windows")]
fn expand_zip_archive(source_path: &Path, extract_dir: &Path) -> Result<(), String> {
    if extract_dir.exists() {
        retry_io("Failed to remove previous update extraction", || {
            fs::remove_dir_all(extract_dir)
        })?;
    }
    fs::create_dir_all(extract_dir)
        .map_err(|error| format!("Failed to create update extraction directory: {error}"))?;

    let status = std_command("powershell.exe")
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg("Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force")
        .arg(source_path)
        .arg(extract_dir)
        .status()
        .map_err(|error| format!("Failed to start zip extraction: {error}"))?;
    if !status.success() {
        return Err(format!("Failed to extract update zip: exit {status}"));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn find_windows_update_root(dir: &Path) -> Result<PathBuf, String> {
    if dir.join("ladonx.exe").exists() {
        return Ok(dir.to_path_buf());
    }

    for entry in
        fs::read_dir(dir).map_err(|error| format!("Failed to inspect extracted update: {error}"))?
    {
        let path = entry
            .map_err(|error| format!("Failed to inspect extracted update entry: {error}"))?
            .path();
        if path.is_dir() && path.join("ladonx.exe").exists() {
            return Ok(path);
        }
    }

    Err("Extracted update zip does not contain ladonx.exe.".to_string())
}

#[cfg(target_os = "windows")]
fn windows_backup_path(path: &Path) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("Path {} does not have a file name.", path.display()))?;
    let mut backup_name = file_name.to_os_string();
    backup_name.push(".bak");
    Ok(path.with_file_name(backup_name))
}

#[cfg(target_os = "windows")]
fn collect_windows_executables(dir: &Path, output: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in
        fs::read_dir(dir).map_err(|error| format!("Failed to inspect app directory: {error}"))?
    {
        let path = entry
            .map_err(|error| format!("Failed to inspect app directory entry: {error}"))?
            .path();
        if path.is_dir() {
            collect_windows_executables(&path, output)?;
            continue;
        }
        let is_exe = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("exe"))
            .unwrap_or(false);
        if is_exe {
            output.push(path);
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn rename_windows_executables_to_backup(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut executables = Vec::new();
    collect_windows_executables(dir, &mut executables)?;
    executables.sort();

    let mut backups = Vec::with_capacity(executables.len());
    for path in executables {
        let backup_path = windows_backup_path(&path)?;
        if backup_path.exists() {
            retry_io(
                &format!(
                    "Failed to remove previous backup executable {}",
                    backup_path.display()
                ),
                || fs::remove_file(&backup_path),
            )?;
        }
        retry_io(
            &format!("Failed to backup executable {}", path.display()),
            || fs::rename(&path, &backup_path),
        )?;
        backups.push(backup_path);
    }
    Ok(backups)
}

#[cfg(target_os = "windows")]
fn restore_windows_executable_backups(backups: &[PathBuf]) -> Result<(), String> {
    for backup_path in backups {
        let original_path = backup_path.with_file_name(
            backup_path
                .file_name()
                .and_then(|value| value.to_str())
                .and_then(|value| value.strip_suffix(".bak"))
                .ok_or_else(|| {
                    format!(
                        "Backup executable {} does not have a valid .bak name.",
                        backup_path.display()
                    )
                })?,
        );
        if original_path.exists() {
            retry_io(
                &format!(
                    "Failed to remove partially updated executable {}",
                    original_path.display()
                ),
                || fs::remove_file(&original_path),
            )?;
        }
        retry_io(
            &format!(
                "Failed to restore backup executable {}",
                backup_path.display()
            ),
            || fs::rename(backup_path, &original_path),
        )?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn copy_windows_update_tree(source_dir: &Path, target_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(target_dir)
        .map_err(|error| format!("Failed to create update target directory: {error}"))?;

    for entry in fs::read_dir(source_dir)
        .map_err(|error| format!("Failed to inspect extracted update files: {error}"))?
    {
        let path = entry
            .map_err(|error| format!("Failed to inspect extracted update entry: {error}"))?
            .path();
        let file_name = path
            .file_name()
            .ok_or_else(|| "Extracted update contains a file without a name.".to_string())?;
        let target_path = target_dir.join(file_name);
        if path.is_dir() {
            copy_windows_update_tree(&path, &target_path)?;
            continue;
        }
        retry_io(
            &format!("Failed to copy update file {}", target_path.display()),
            || fs::copy(&path, &target_path),
        )?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub(crate) fn cleanup_windows_backup_executables() -> Result<(), String> {
    let current_exe = std::env::current_exe()
        .map_err(|error| format!("Unable to locate current executable: {error}"))?;
    let target_dir = current_exe
        .parent()
        .ok_or_else(|| "Unable to locate current app directory.".to_string())?;
    cleanup_windows_backup_executables_in_dir(&target_dir)
}

#[cfg(target_os = "windows")]
fn cleanup_windows_backup_executables_in_dir(dir: &Path) -> Result<(), String> {
    for entry in
        fs::read_dir(dir).map_err(|error| format!("Failed to inspect app directory: {error}"))?
    {
        let path = entry
            .map_err(|error| format!("Failed to inspect app directory entry: {error}"))?
            .path();
        if path.is_dir() {
            cleanup_windows_backup_executables_in_dir(&path)?;
            continue;
        }
        let file_name = match path.file_name().and_then(|value| value.to_str()) {
            Some(value) => value,
            None => continue,
        };
        if !file_name.to_ascii_lowercase().ends_with(".exe.bak") {
            continue;
        }
        retry_io(
            &format!("Failed to remove backup executable {}", path.display()),
            || fs::remove_file(&path),
        )?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn install_windows_zip_update(args: &HelperArgs) -> Result<(), String> {
    stop_ladonx_processes();

    let target_dir = args
        .target_path
        .parent()
        .ok_or_else(|| "Unable to locate current app directory.".to_string())?;
    let extract_dir =
        std::env::temp_dir().join(format!("ladonx-update-extract-{}", std::process::id()));
    expand_zip_archive(&args.source_path, &extract_dir)?;
    let update_root = find_windows_update_root(&extract_dir)?;

    let backups = rename_windows_executables_to_backup(target_dir)?;
    if let Err(error) = copy_windows_update_tree(&update_root, target_dir) {
        let _ = restore_windows_executable_backups(&backups);
        return Err(error);
    }

    if !args.restart_path.exists() {
        let _ = restore_windows_executable_backups(&backups);
        return Err("Extracted update zip did not replace the app executable.".to_string());
    }

    let _ = fs::remove_dir_all(&extract_dir);
    std_command(&args.restart_path)
        .current_dir(target_dir)
        .spawn()
        .map_err(|error| format!("Failed to relaunch updated app: {error}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn install_windows_msi_update(args: &HelperArgs) -> Result<(), String> {
    let mut command = Command::new("msiexec.exe");
    command
        .arg("/i")
        .arg(&args.source_path)
        .arg("REINSTALLMODE=amus");
    command
        .spawn()
        .map_err(|error| format!("Failed to launch MSI installer: {error}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn install_windows_update(args: &HelperArgs) -> Result<(), String> {
    if is_zip_path(&args.source_path) {
        return install_windows_zip_update(args);
    }

    if is_msi_path(&args.source_path) {
        return install_windows_msi_update(args);
    }

    stop_ladonx_processes();

    let staged_target = args.target_path.with_extension("new");
    if staged_target.exists() {
        retry_io("Failed to remove previous staged update", || {
            fs::remove_file(&staged_target)
        })?;
    }
    retry_io("Failed to stage updated executable", || {
        fs::copy(&args.source_path, &staged_target)
    })?;

    if args.target_path.exists() {
        retry_io("Failed to remove current executable", || {
            fs::remove_file(&args.target_path)
        })?;
    }
    retry_io("Failed to replace executable", || {
        fs::rename(&staged_target, &args.target_path)
    })?;

    std_command(&args.restart_path)
        .spawn()
        .map_err(|error| format!("Failed to relaunch updated app: {error}"))?;
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn install_posix_update(args: &HelperArgs) -> Result<(), String> {
    let staged_target = args.target_path.with_extension("new");
    if staged_target.exists() {
        let _ = fs::remove_file(&staged_target);
    }
    fs::copy(&args.source_path, &staged_target)
        .map_err(|error| format!("Failed to stage updated executable: {error}"))?;
    fs::rename(&staged_target, &args.target_path)
        .map_err(|error| format!("Failed to replace executable: {error}"))?;
    std_command(&args.restart_path)
        .spawn()
        .map_err(|error| format!("Failed to relaunch updated app: {error}"))?;
    Ok(())
}
