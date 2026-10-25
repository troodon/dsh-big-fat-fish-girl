//! Cursor polling: sheet download/decoding and the click-through decision.

use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use bffg_shell_core::walk::walk_range;
use bffg_shell_core::{cell_pixel, drag_target, AtlasPixels};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow};

use crate::state::{state_of, NativeDragDelta, ShellView, ALPHA_THRESHOLD};

/// Harness answers on loopback; a hung answer must not freeze the cursor loop for good.
const HARNESS_TIMEOUT: Duration = Duration::from_millis(1500);
/// The page hears the walkway and the real window origin about once a second.
const SYNC_TICKS: u32 = 30;
/// A move this large, while nobody drags, was a reset or another app: strolling moves the
/// window a few pixels per frame.
const EXTERNAL_MOVE_PX: f64 = 48.0;

/// The cursor loop runs 30 times a second; a refused pass-through is reported once, not 30 times.
static CURSOR_REFUSED: AtomicBool = AtomicBool::new(false);

fn report_cursor_refusal(result: tauri::Result<()>) {
    if result.is_err() && !CURSOR_REFUSED.swap(true, Ordering::Relaxed) {
        crate::diagnostics::report("let clicks through the transparent pixels", result);
    }
}

/// Fetch the manifest once and remember where each sheet lives on the harness origin.
pub fn load_sheet_sources(app: &AppHandle) {
    let state = state_of(app);
    let (origin, have_sources) = {
        let guard = state.lock().expect("shell state");
        (guard.origin.clone(), !guard.sources.is_empty())
    };
    if origin.is_empty() || have_sources {
        return;
    }
    let Ok(response) = ureq::get(&format!("{origin}/big-fat-fish-girl/v1/manifest")).timeout(HARNESS_TIMEOUT).call() else {
        return;
    };
    let Ok(value) = response.into_json::<serde_json::Value>() else { return };
    let mut sources = HashMap::new();
    if let Some(sheets) = value.get("sheets").and_then(|value| value.as_object()) {
        for (id, sheet) in sheets {
            if let Some(url) = sheet.get("url").and_then(|value| value.as_str()) {
                sources.insert(id.clone(), url.to_string());
            } else if let Some(file) = sheet.get("file").and_then(|value| value.as_str()) {
                sources.insert(id.clone(), format!("/big-fat-fish-girl/v1/sheet/{file}"));
            }
        }
    }
    state_of(app).lock().expect("shell state").sources = sources;
}

/// The cache key of one sheet within one skin; different skins never alias.
fn sheet_key(skin: &str, sheet: &str) -> String {
    format!("{skin}/{sheet}")
}

/// Load and decode one sheet's RGBA pixels (palette PNGs are expanded).
pub fn load_sheet_pixels(app: &AppHandle, skin: &str, sheet: &str) {
    let state = state_of(app);
    let key = sheet_key(skin, sheet);
    let (origin, path) = {
        let guard = state.lock().expect("shell state");
        if guard.sheets.contains_key(&key) {
            return;
        }
        (guard.origin.clone(), guard.sources.get(sheet).cloned())
    };
    let Some(path) = path else { return };
    let Ok(response) = ureq::get(&format!("{origin}{path}")).timeout(HARNESS_TIMEOUT).call() else { return };
    let mut bytes = Vec::new();
    if response.into_reader().take(32 * 1024 * 1024).read_to_end(&mut bytes).is_err() {
        return;
    }
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let Ok(mut reader) = decoder.read_info() else { return };
    let mut buffer = vec![0u8; reader.output_buffer_size()];
    let Ok(output) = reader.next_frame(&mut buffer) else { return };
    let pixels = match output.color_type {
        png::ColorType::Rgba => buffer,
        png::ColorType::Rgb => {
            let mut rgba = Vec::with_capacity(buffer.len() / 3 * 4);
            for chunk in buffer.chunks_exact(3) {
                rgba.extend_from_slice(&[chunk[0], chunk[1], chunk[2], 255]);
            }
            rgba
        }
        _ => return,
    };
    if let Some(atlas) = AtlasPixels::from_rgba(output.width, output.height, pixels) {
        state_of(app)
            .lock()
            .expect("shell state")
            .sheets
            .insert(key, atlas);
    }
}

/// Tell the page how far the window may walk: the monitor's width minus the window itself.
fn sync_walkway(window: &WebviewWindow, scale: f64) {
    let Ok(Some(monitor)) = window.current_monitor() else { return };
    let Ok(size) = window.outer_size() else { return };
    let (min, max) = walk_range(monitor.position().x, monitor.size().width, size.width, scale);
    crate::diagnostics::report("send the walkway to the page", window.eval(format!(
        "window.__BFFG_DESKTOP_CMD__ && window.__BFFG_DESKTOP_CMD__.setBounds({{ minX: {min}, maxX: {max} }})"
    )));
}

/// Tell the page where the window really stands, so its strolling counts from there.
fn sync_position(window: &WebviewWindow, position: PhysicalPosition<i32>, scale: f64) {
    crate::diagnostics::report("send the window position to the page", window.eval(format!(
        "window.__BFFG_DESKTOP_CMD__ && window.__BFFG_DESKTOP_CMD__.setPosition({})",
        position.x as f64 / scale
    )));
}

/// One hit-test decision for a cursor position in page coordinates (CSS px, top-left).
pub(crate) fn decide_interactive(view: &ShellView, app: &AppHandle, local_x: f64, local_y: f64) -> bool {
    if let Some(pet) = view.pet {
        if pet.contains(local_x, local_y) {
            let (Some(cell), Some(sheet), Some(skin)) = (view.cell, view.sheet.as_deref(), view.skin.as_deref()) else {
                // Without a reported frame, stay interactive rather than dead.
                return true;
            };
            load_sheet_sources(app);
            load_sheet_pixels(app, skin, sheet);
            let state = state_of(app);
            let guard = state.lock().expect("shell state");
            let Some(atlas) = guard.sheets.get(&sheet_key(skin, sheet)) else { return true };
            return cell_pixel(&cell, pet, local_x, local_y)
                .map(|(x, y)| atlas.is_opaque(x, y, ALPHA_THRESHOLD))
                .unwrap_or(true);
        }
    }
    view.bubble.iter().any(|rect| rect.contains(local_x, local_y))
}

/// 30 Hz: ignore mouse events unless the cursor is over the pet, its bubble or a menu.
/// The decision comes from the global cursor position, because a window that ignores
/// events can never receive the event that would bring it back.
pub fn start_click_through(app: AppHandle) {
    let mut ticks: u32 = 0;
    let mut was_dragging = false;
    let mut last_native: Option<PhysicalPosition<i32>> = None;
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(33));
        let Some(window) = app.get_webview_window("pet") else { continue };
        let (Ok(cursor), Ok(position), Ok(scale)) = (
            window.cursor_position(),
            window.outer_position(),
            window.scale_factor(),
        ) else {
            continue;
        };
        let drag_origin = { state_of(&app).lock().expect("shell state").drag_origin };
        let dragging = drag_origin.is_some();
        ticks = ticks.wrapping_add(1);
        if ticks % SYNC_TICKS == 0 {
            sync_walkway(&window, scale);
        }
        // Strolling moves the window through the page's own count. A drag or a reset moves it
        // behind the page's back, so the page is told the new origin once that move is over.
        let moved_behind_page = last_native.is_some_and(|last: PhysicalPosition<i32>| {
            ((position.x - last.x) as f64).hypot((position.y - last.y) as f64) / scale > EXTERNAL_MOVE_PX
        });
        if (was_dragging && !dragging) || (!dragging && moved_behind_page) {
            sync_position(&window, position, scale);
        }
        was_dragging = dragging;
        last_native = Some(position);
        if let Some(mut drag) = drag_origin {
            let dx = cursor.x - drag.last_cursor.x;
            let (x, y) = drag_target(
                (drag.window.x, drag.window.y),
                (drag.cursor.x, drag.cursor.y),
                (cursor.x, cursor.y),
            );
            if (x, y) != (position.x, position.y) {
                crate::diagnostics::report("move the window during a drag", window.set_position(PhysicalPosition::new(x, y)));
            }
            drag.last_cursor = cursor;
            {
                let shell_state = state_of(&app);
                let mut state = shell_state.lock().expect("shell state");
                if state
                    .drag_origin
                    .is_some_and(|active| active.session == drag.session)
                {
                    state.drag_origin = Some(drag);
                }
            }
            if dx.abs() >= 0.5 {
                crate::diagnostics::report("send the drag delta to the page", app.emit_to(
                    "pet",
                    "native-drag-move",
                    NativeDragDelta {
                        session: drag.session,
                        dx,
                    },
                ));
            }
            report_cursor_refusal(window.set_ignore_cursor_events(false));
            continue;
        }
        let view = { state_of(&app).lock().expect("shell state").view() };
        if view.dragging {
            report_cursor_refusal(window.set_ignore_cursor_events(false));
            continue;
        }
        let local_x = (cursor.x - position.x as f64) / scale;
        let local_y = (cursor.y - position.y as f64) / scale;
        let interactive = decide_interactive(&view, &app, local_x, local_y);
        report_cursor_refusal(window.set_ignore_cursor_events(!interactive));
    });
}
