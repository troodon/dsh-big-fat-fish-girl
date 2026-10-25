//! The commands the page calls through the bridge (`#[tauri::command]`).

use std::sync::Mutex;

use bffg_shell_core::{accumulate_move, grabbed_origin, Cell};
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

use crate::state::{parse_rect, parse_rects, DragOrigin, ShellState};

#[tauri::command]
pub fn move_by(
    state: tauri::State<'_, Mutex<ShellState>>,
    window: tauri::Window,
    dx: f64,
    dy: f64,
) {
    // The page sends logical (CSS) pixels; window positions are physical. The carry
    // keeps sub-pixel motion: rounding every call separately would make a slow drag
    // fall a bit further behind with every step.
    let scale = window.scale_factor().unwrap_or(1.0);
    let step = {
        let mut guard = state.lock().expect("shell state");
        let (step, remainder) = accumulate_move(guard.move_remainder, dx * scale, dy * scale);
        guard.move_remainder = remainder;
        step
    };
    if step == (0, 0) {
        return;
    }
    if let Ok(position) = window.outer_position() {
        let next = PhysicalPosition::new(position.x + step.0, position.y + step.1);
        crate::diagnostics::report("move the window", window.set_position(next));
    }
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Start a drag: from now on the click-through loop keeps the window at the cursor's
/// own displacement from where the drag began (physical pixels, computed from the
/// origin every tick). Global cursor polling is immune to the window moving beneath
/// the pointer and also reports each horizontal cursor delta to the page for animation.
///
/// `grabbed_x`/`grabbed_y` is how far the cursor already travelled (logical page
/// pixels) while the page was waiting for the takeover; subtracting it from the
/// captured cursor puts the origin back at the press, so the pet keeps the grabbed
/// point under the cursor instead of trailing by the threshold distance.
#[tauri::command]
pub fn start_drag(
    state: tauri::State<'_, Mutex<ShellState>>,
    window: WebviewWindow,
    session: u64,
    grabbed_x: Option<f64>,
    grabbed_y: Option<f64>,
) -> bool {
    let Some(cursor) = window.cursor_position().ok() else {
        return false;
    };
    let Some(position) = window.outer_position().ok() else {
        return false;
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let (x, y) = grabbed_origin(
        (cursor.x, cursor.y),
        (grabbed_x.unwrap_or(0.0), grabbed_y.unwrap_or(0.0)),
        scale,
    );
    let origin_cursor = PhysicalPosition::new(x, y);
    state.lock().expect("shell state").drag_origin = Some(DragOrigin {
        session,
        cursor: origin_cursor,
        window: position,
        last_cursor: cursor,
    });
    true
}

/// The page calls this on pointerup/pointercancel or focus loss.
#[tauri::command]
pub fn end_drag(state: tauri::State<'_, Mutex<ShellState>>, session: u64) {
    let mut state = state.lock().expect("shell state");
    if state
        .drag_origin
        .is_some_and(|drag| drag.session == session)
    {
        state.drag_origin = None;
    }
}

/// Where the shell parks itself on launch and on "reset": near the bottom-right of the
/// primary monitor, inside the visible frame even with menu bars and docks.
pub fn default_origin(window: &WebviewWindow) -> Option<PhysicalPosition<i32>> {
    let monitor = window.primary_monitor().ok().flatten()?;
    let size = window.outer_size().ok()?;
    let area = monitor.size();
    let origin = monitor.position();
    let x = origin.x + area.width as i32 - size.width as i32 - 80;
    let y = origin.y + area.height as i32 - size.height as i32 - 140;
    Some(PhysicalPosition::new(
        x.max(origin.x),
        y.max(origin.y),
    ))
}

#[tauri::command]
pub fn reset_position(window: WebviewWindow) {
    if let Some(origin) = default_origin(&window) {
        crate::diagnostics::report("reset the window position", window.set_position(origin));
    }
}

#[tauri::command]
pub fn frame(
    state: tauri::State<'_, Mutex<ShellState>>,
    sheet: String,
    row: u32,
    column: u32,
    columns: u32,
    rows: u32,
    cell_width: u32,
    cell_height: u32,
    skin: Option<String>,
    flip_x: Option<bool>,
) {
    let mut guard = state.lock().expect("shell state");
    if guard.skin != skin {
        // A different skin means different pixels: drop the decoded atlases and the
        // manifest URLs so the click-through hit-test uses the art actually shown.
        guard.skin = skin;
        guard.sheets.clear();
        guard.sources.clear();
    }
    guard.cell = Some(Cell { columns, rows, cell_width, cell_height, row, column, flip_x: flip_x.unwrap_or(false) });
    guard.sheet = Some(sheet);
}

#[tauri::command]
pub fn interactive_regions(
    state: tauri::State<'_, Mutex<ShellState>>,
    bubble_rects: Option<serde_json::Value>,
    pet_rect: Option<serde_json::Value>,
    dragging: Option<bool>,
) {
    let pet = pet_rect.as_ref().and_then(|value| parse_rect(value));
    let mut guard = state.lock().expect("shell state");
    guard.bubble = parse_rects(bubble_rects.as_ref());
    if let Some(rect) = pet {
        guard.pet = Some(rect);
    }
    guard.dragging = dragging.unwrap_or(false);
}

/// Bring the Harness window forward. The session itself is opened by the in-page client,
/// which received the same command over the host's navigate stream.
#[tauri::command]
pub fn open_target(target_ref: String) {
    if target_ref.is_empty() {
        return;
    }
    #[cfg(target_os = "macos")]
    {
        crate::diagnostics::report("open Harness", std::process::Command::new("open").arg("dsh://open").spawn());
    }
    #[cfg(target_os = "linux")]
    {
        crate::diagnostics::report("open Harness", std::process::Command::new("xdg-open").arg("dsh://open").spawn());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

        crate::diagnostics::report(
            "open Harness",
            std::process::Command::new("cmd")
                .args(["/C", "start", "", "dsh://open"])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn(),
        );
    }
}

#[tauri::command]
pub fn open_menu(window: WebviewWindow, labels: Option<serde_json::Value>) {
    let label = |key: &str, fallback: &str| -> String {
        labels
            .as_ref()
            .and_then(|value| value.get(key))
            .and_then(|value| value.as_str())
            .unwrap_or(fallback)
            .to_string()
    };
    let app = window.app_handle();
    let reconnect = MenuItemBuilder::with_id("reconnect", label("reconnect", "Reconnect"))
        .build(app)
        .expect("menu item");
    let reset = MenuItemBuilder::with_id("reset", label("reset", "Reset position"))
        .build(app)
        .expect("menu item");
    let hide = MenuItemBuilder::with_id("hide", label("hide", "Hide for this run"))
        .build(app)
        .expect("menu item");
    let quit = MenuItemBuilder::with_id("quit", label("quit", "Quit")).build(app).expect("menu item");
    let menu = MenuBuilder::new(app)
        .item(&reconnect)
        .item(&reset)
        .item(&hide)
        .item(&quit)
        .build()
        .expect("menu");
    crate::diagnostics::report("open the shell menu", window.popup_menu(&menu));
}

#[tauri::command]
pub fn ping() -> String {
    "pong".to_string()
}

/// The self-test page script reports what it can see; the shell decides the exit code.
#[tauri::command]
pub fn self_report(app: AppHandle, payload: String) {
    println!("tauri-self-test: page reports {payload}");
    if crate::self_test::passed(&payload) {
        println!("tauri-self-test: OK");
        app.exit(0);
    } else {
        println!("tauri-self-test: FAILED");
        app.exit(1);
    }
}
