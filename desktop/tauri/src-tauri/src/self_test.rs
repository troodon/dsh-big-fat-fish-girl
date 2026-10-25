//! The offscreen end-to-end check (`--self-test`): the page must mount, report its
//! frame, move the window through the bridge and answer an invoke round-trip.

use std::time::Duration;

use bffg_shell_core::cell_pixel;
use tauri::{Manager, WebviewWindow};

use crate::click_through::{load_sheet_pixels, load_sheet_sources};
use crate::commands::reset_position;
use crate::state::{state_of, ALPHA_THRESHOLD};

pub fn self_test(window: WebviewWindow) {
    std::thread::spawn(move || {
        let app = window.app_handle().clone();
        // Poll instead of trusting one instant: the page mounts and reports asynchronously.
        let mut snapshot = { state_of(&app).lock().expect("shell state").view() };
        // Include a shell launched before the HTTP server is ready: native recovery
        // gets time to retry the initial navigation, not just an already loaded page.
        for _ in 0..150 {
            if snapshot.cell.is_some() && snapshot.pet.is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
            snapshot = state_of(&app).lock().expect("shell state").view();
        }
        let (Some(cell), Some(pet)) = (snapshot.cell, snapshot.pet) else {
            // Diagnose through the plugin's own HTTP origin: what does the page see, and
            // what does the shell answer to a frame call?
            let diagnostic = r#"
            (async () => {
              const report = (payload) => fetch('/big-fat-fish-girl/v1/preview/log', {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
              }).catch(() => {});
              const host = document.querySelector('[data-bffg-desktop]');
              await report({ phase: 'no-frame', shell: typeof window.__BFFG_SHELL__,
                frame: window.__BFFG_SHELL__ ? typeof window.__BFFG_SHELL__.frame : 'missing',
                pet: !!host, mood: host ? host.dataset.mood : null });
              try {
                const result = await window.__TAURI__.core.invoke('frame', {
                  sheet: 'base', row: 0, column: 0, columns: 8, rows: 11,
                  cellWidth: 256, cellHeight: 256,
                });
                await report({ phase: 'frame probe resolved', result });
              } catch (error) {
                await report({ phase: 'frame probe failed', error: String(error) });
              }
            })();
            "#;
            crate::diagnostics::report("run the shell diagnostic", window.eval(diagnostic));
            std::thread::sleep(Duration::from_millis(900));
            println!("tauri-self-test: FAILED — the page never reported a frame");
            app.exit(1);
            return;
        };
        if cell.cell_width != 256 || cell.cell_height != 256 {
            println!(
                "tauri-self-test: FAILED — runtime cell is {}x{}, expected 256x256",
                cell.cell_width, cell.cell_height
            );
            app.exit(1);
            return;
        }
        if let Ok(size) = window.inner_size() {
            let scale = window.scale_factor().unwrap_or(1.0);
            if (size.width as f64 / scale - 304.0).abs() > 1.0 || (size.height as f64 / scale - 292.0).abs() > 1.0 {
                println!(
                    "tauri-self-test: FAILED — window is {}x{}, expected 304x292 logical px",
                    size.width, size.height
                );
                app.exit(1);
                return;
            }
        }
        println!("tauri-self-test: frame sheet={:?} cell=({},{})", snapshot.sheet, cell.row, cell.column);

        // Direction 1: a page command must really move the OS window.
        let before = window.outer_position().expect("no window position");
        crate::diagnostics::report("move the window in the self-test", window.eval("window.__BFFG_SHELL__ && window.__BFFG_SHELL__.moveBy(24, 0)"));
        std::thread::sleep(Duration::from_millis(500));
        let after = window.outer_position().expect("no window position");
        let scale = window.scale_factor().unwrap_or(1.0);
        let moved_logical = (after.x - before.x) as f64 / scale;
        if (moved_logical - 24.0).abs() > 1.0 {
            println!(
                "tauri-self-test: FAILED — moveBy moved the window by {moved_logical:.1} logical px, expected 24"
            );
            app.exit(1);
            return;
        }
        println!("tauri-self-test: moveBy moved the window by {moved_logical:.1} logical px");

        // Reset must land inside the primary monitor, even if the window was dragged away.
        reset_position(window.clone());
        std::thread::sleep(Duration::from_millis(300));
        if let (Ok(position), Ok(size), Ok(Some(monitor))) = (
            window.outer_position(),
            window.outer_size(),
            window.primary_monitor(),
        ) {
            let area = monitor.size();
            let origin = monitor.position();
            let inside = position.x >= origin.x
                && position.y >= origin.y
                && position.x + size.width as i32 <= origin.x + area.width as i32
                && position.y + size.height as i32 <= origin.y + area.height as i32;
            if !inside {
                println!("tauri-self-test: FAILED — reset left the window outside the monitor");
                app.exit(1);
                return;
            }
            println!("tauri-self-test: reset parked the window inside the monitor");
        }

        // Alpha path: fetch and decode the current sheet, then sample the pet's centre.
        load_sheet_sources(&app);
        let sheet = snapshot.sheet.clone().unwrap_or_else(|| "base".to_string());
        let skin = snapshot.skin.clone().unwrap_or_default();
        load_sheet_pixels(&app, &skin, &sheet);
        // Page coordinates, as the page reports the pet: sampled a third down from the top.
        let centre_point = cell_pixel(
            &cell,
            pet,
            pet.x + pet.width / 2.0,
            pet.y + pet.height * 0.35,
        );
        let sampled = {
            let state = state_of(&app);
            let guard = state.lock().expect("shell state");
            guard.sheets.get(&format!("{skin}/{sheet}")).map(|atlas| {
                centre_point
                    .map(|(x, y)| atlas.is_opaque(x, y, ALPHA_THRESHOLD))
                    .unwrap_or(false)
            })
        };
        match sampled {
            Some(true) => println!("tauri-self-test: atlas '{sheet}' loaded, centre sample is opaque"),
            Some(false) => {
                println!("tauri-self-test: FAILED — centre sample was transparent");
                app.exit(1);
                return;
            }
            None => {
                println!("tauri-self-test: FAILED — atlas '{sheet}' did not load");
                app.exit(1);
                return;
            }
        }

        // Click-through, end to end in the real window: the pet's centre takes clicks, and a
        // point beside the pet, below its bubble, lets them through. Page coordinates, the same
        // space the click-through loop uses.
        let view = state_of(&app).lock().expect("shell state").view();
        let centre_hit = crate::click_through::decide_interactive(
            &view,
            &app,
            pet.x + pet.width / 2.0,
            pet.y + pet.height * 0.35,
        );
        let beside_hit = crate::click_through::decide_interactive(&view, &app, pet.x - 40.0, pet.y + pet.height * 0.9);
        if centre_hit && !beside_hit {
            println!("tauri-self-test: click-through: the pet takes clicks, the space beside it does not");
        } else {
            println!("tauri-self-test: FAILED — click-through: centre={centre_hit} beside={beside_hit}");
            app.exit(1);
            return;
        }

        // Direction 2: the bridge exists before the page scripts, and the page can reach
        // the shell back (invoke returns a value). The drag event channel is part of the
        // contract: without it the page can never take the native drag path.
        let probe = r#"
        (async () => {
          const host = document.querySelector('[data-bffg-desktop]');
          const pong = await window.__TAURI__.core.invoke('ping');
          let dragChannel = 'missing';
          try {
            const stop = await window.__BFFG_SHELL__.onDragMove(() => {});
            dragChannel = typeof stop === 'function' ? 'ok' : 'no-unlisten';
            if (typeof stop === 'function') stop();
          } catch (error) {
            dragChannel = 'failed: ' + String(error);
          }
          let dragTakeover = 'skipped';
          try {
            const started = await window.__BFFG_SHELL__.startDrag(777, 0, 0);
            await window.__BFFG_SHELL__.endDrag(777);
            dragTakeover = started === true ? 'ok' : 'refused';
          } catch (error) {
            dragTakeover = 'failed: ' + String(error);
          }
          window.__TAURI__.core.invoke('self_report', { payload: JSON.stringify({
            pet: !!host,
            mood: host ? host.dataset.mood : null,
            shell: typeof window.__BFFG_SHELL__,
            pong,
            dragChannel,
            dragTakeover,
          })});
        })();
        "#;
        crate::diagnostics::report("start the self-test probe", window.eval(probe));

        // Watchdog: a wedged page fails the test instead of hanging forever.
        std::thread::sleep(Duration::from_secs(8));
        println!("tauri-self-test: FAILED — no report from the page");
        app.exit(1);
    });
}

/// Whether the page's report proves what the self-test is for: the page mounted, the bridge
/// answers, and the drag channel is wired. A report that does not parse is a failure, and so
/// is text that merely mentions a check.
pub fn passed(payload: &str) -> bool {
    let Ok(report) = serde_json::from_str::<serde_json::Value>(payload) else {
        return false;
    };
    let text = |key: &str| report.get(key).and_then(|value| value.as_str());
    report.get("pet") == Some(&serde_json::Value::Bool(true))
        && text("pong") == Some("pong")
        && text("dragChannel") == Some("ok")
        && text("dragTakeover") == Some("ok")
}

#[cfg(test)]
mod tests {
    use super::passed;

    #[test]
    fn a_complete_report_passes() {
        assert!(passed(r#"{"pet":true,"pong":"pong","dragChannel":"ok","dragTakeover":"ok"}"#));
    }

    #[test]
    fn a_missing_or_failed_check_fails() {
        assert!(!passed(r#"{"pet":false,"pong":"pong","dragChannel":"ok","dragTakeover":"ok"}"#));
        assert!(!passed(r#"{"pet":true,"pong":"pong","dragChannel":"failed: boom","dragTakeover":"ok"}"#));
        assert!(!passed(r#"{"pet":true,"pong":"pong","dragChannel":"ok"}"#));
    }

    #[test]
    fn a_report_that_only_mentions_the_checks_is_not_a_pass() {
        assert!(!passed(r#"{"note":"\"pet\":true \"pong\":\"pong\" \"dragChannel\":\"ok\" \"dragTakeover\":\"ok\"","pet":false}"#));
        assert!(!passed(r#"not json "pet":true"#));
    }
}
