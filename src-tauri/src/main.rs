// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod self_update_helper;
mod startup_log;

fn main() {
    let args: Vec<std::ffi::OsString> = std::env::args_os().collect();
    match self_update_helper::maybe_run_from_args(&args) {
        Ok(true) => return,
        Ok(false) => {}
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(1);
        }
    }
    startup_log::install_panic_hook();
    startup_log::write("main: starting");
    if let Err(err) = fix_path_env::fix() {
        startup_log::write(format!("main: fix_path_env failed: {err}"));
        eprintln!("Failed to sync PATH from shell: {err}");
    }
    ladonx_lib::run();
    startup_log::write("main: exited normally");
}
