// Tauri v2 shell for Big Fat Fish Girl.
//
// The window behaviour lives in the modules below — the bridge adapter, the shared
// state, the commands the page calls, the click-through loop and the self-test. This
// file only wires them into the Tauri application.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod click_through;
mod commands;
mod connection;
mod diagnostics;
mod discovery;
mod self_test;
#[cfg(target_os = "windows")]
mod single_instance;
mod state;

use std::sync::Mutex;

use discovery::{desktop_url, page_target, url_arg, DEFAULT_PORT};
use state::ShellState;
use tauri::{Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

/// The binary's path segment, followed by arguments or the end of the line: a shell
/// launched with `--url …` must still count, while a stray command that merely
/// mentions the name has no slash before it.
#[cfg(any(target_os = "macos", target_os = "linux"))]
const SHELL_PGREP_PATTERN: &str = "/big-fat-fish-girl-shell( |$)";

/// A second launch must not stack another pet. The self-test is exempt because it
/// uses its own window.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn another_instance_running() -> bool {
    let Ok(output) = std::process::Command::new("pgrep")
        .args(["-f", SHELL_PGREP_PATTERN])
        .output()
    else {
        return false;
    };
    let self_pid = std::process::id();
    String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .any(|pid| {
            pid.parse::<u32>()
                .map(|pid| pid != self_pid)
                .unwrap_or(false)
        })
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let run_self_test = args.iter().any(|arg| arg == "--self-test");
    #[cfg(target_os = "windows")]
    let _single_instance = if run_self_test {
        None
    } else {
        match single_instance::acquire() {
            Ok(Some(guard)) => Some(guard),
            Ok(None) => {
                println!("shell: another Big Fat Fish Girl shell is already running; exiting");
                return;
            }
            Err(error) => {
                diagnostics::report::<(), _>("create the single-instance mutex", Err(error));
                std::process::exit(1);
            }
        }
    };
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    if !run_self_test && another_instance_running() {
        println!("shell: another Big Fat Fish Girl shell is already running; exiting");
        return;
    }
    // URL resolution: --url, then BFFG_URL, then discovery, then the default port. The
    // plugin passes --url because Harness 0.2.1 binds an OS-assigned port; the shell is
    // still meant to work standalone, next to a running Harness on the old fixed port.
    let pinned_url = url_arg(&args).or_else(|| std::env::var("BFFG_URL").ok());
    let allow_discovery = pinned_url.is_none();
    let url = page_target(pinned_url.as_deref())
        .unwrap_or_else(|| desktop_url(&format!("http://127.0.0.1:{DEFAULT_PORT}")));

    tauri::Builder::default()
        .manage(Mutex::new(ShellState::default()))
        .invoke_handler(tauri::generate_handler![
            commands::move_by,
            commands::quit_app,
            commands::start_drag,
            commands::end_drag,
            commands::reset_position,
            commands::frame,
            commands::interactive_regions,
            commands::open_target,
            commands::open_menu,
            commands::ping,
            commands::self_report
        ])
        .on_menu_event({
            // A pinned URL also remains the Reconnect target: the plugin started this
            // shell for the current Harness session, so re-discovery would move it away.
            let pinned = pinned_url.clone();
            move |app, event| match event.id().as_ref() {
                // Harness may not have been running when the shell started, or moved ports.
                "reconnect" => {
                    let allow = pinned.is_none();
                    let target = page_target(pinned.as_deref()).unwrap_or_else(|| {
                        desktop_url(&format!("http://127.0.0.1:{DEFAULT_PORT}"))
                    });
                    if let (Some(window), Ok(url)) =
                        (app.get_webview_window("pet"), target.parse::<tauri::Url>())
                    {
                        connection::navigate(&window, url.clone());
                        connection::recover_initial_page(window, url, allow);
                    }
                }
                "reset" => {
                    if let Some(window) = app.get_webview_window("pet") {
                        commands::reset_position(window);
                    }
                }
                "hide" => {
                    if let Some(window) = app.get_webview_window("pet") {
                        diagnostics::report("hide the window", window.hide());
                    }
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .setup(move |app| {
            // A companion, not an app: no Dock icon, no menu-bar takeover (the Swift shell
            // runs the same way), and above ordinary windows on supported workspaces.
            #[cfg(target_os = "macos")]
            // This call is infallible in Tauri 2; there is no result to report.
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            let parsed: tauri::Url = url.parse().expect("shell: --url must be a valid URL");
            {
                let origin = parsed.origin().ascii_serialization();
                state::state_of(app.handle())
                    .lock()
                    .expect("shell state")
                    .origin = origin;
            }
            let builder =
                WebviewWindowBuilder::new(app, "pet", WebviewUrl::External(parsed.clone()))
                    .title("Big Fat Fish Girl")
                    .transparent(true)
                    .decorations(false)
                    .shadow(false)
                    .always_on_top(true)
                    .resizable(false)
                    .focused(false)
                    .focusable(false);
            #[cfg(target_os = "macos")]
            let builder = builder
                // Accept the initial press for dragging while the working app keeps focus.
                .accept_first_mouse(true);
            #[cfg(target_os = "windows")]
            let builder = builder.skip_taskbar(true);
            let window = builder
                // At the default size (132), the square canvas is 176px. The window
                // keeps the existing 64px side margins and 116px bubble margin.
                .inner_size(304.0, 292.0)
                .initialization_script(bridge::BRIDGE)
                .build()?;
            // Stay visible when another app is active and on every Space where supported.
            diagnostics::report("keep the window on top", window.set_always_on_top(true));
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            diagnostics::report(
                "show the window on every space",
                window.set_visible_on_all_workspaces(true),
            );
            connection::recover_initial_page(window.clone(), parsed, allow_discovery);
            if run_self_test {
                // Park it offscreen so the check never flashes on someone's desktop.
                diagnostics::report(
                    "park the self-test window",
                    window.set_position(PhysicalPosition::new(-6000, -6000)),
                );
                self_test::self_test(window.clone());
            } else {
                // Start on screen: a borderless window can otherwise open past an edge.
                if let Some(origin) = commands::default_origin(&window) {
                    diagnostics::report(
                        "place the window on the screen",
                        window.set_position(origin),
                    );
                }
                click_through::start_click_through(app.handle().clone());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the shell");
}
