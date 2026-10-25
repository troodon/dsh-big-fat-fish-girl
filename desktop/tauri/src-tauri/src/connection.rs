//! Retry the initial document when Harness was not ready at shell startup.
//!
//! SSE can reconnect only after the desktop page has mounted. A failed first HTTP
//! navigation leaves an empty WebView, so the native side must retry that document.
//! The retries are bounded: a page that loads but never mounts is reported and left alone,
//! and "Reconnect" in the shell menu starts a new attempt.

use std::time::Duration;

use tauri::{Manager, Url, WebviewWindow};

use crate::diagnostics;
use crate::discovery::{desktop_url, discover_base};
use crate::state::state_of;

/// How often the shell asks whether Harness is answering while it waits for it.
const PROBE_EVERY: Duration = Duration::from_secs(3);

/// How many loads of the page may pass without the page reporting in before the shell stops.
pub const MAX_NAVIGATIONS: u32 = 10;

/// The pause after the `navigations`-th load that did not get the page to report: 3 s, then
/// doubling, capped at one minute.
pub fn navigation_backoff(navigations: u32) -> Duration {
    let seconds = 3u64.saturating_mul(1u64 << navigations.min(5));
    Duration::from_secs(seconds.min(60))
}

/// A new document must not reuse rectangles or atlas URLs from the previous server.
pub fn navigate(window: &WebviewWindow, target: Url) {
    {
        let state = state_of(window.app_handle());
        let mut guard = state.lock().expect("shell state");
        guard.origin = target.origin().ascii_serialization();
        guard.cell = None;
        guard.sheet = None;
        guard.skin = None;
        guard.pet = None;
        guard.bubble.clear();
        guard.sheets.clear();
        guard.sources.clear();
        guard.dragging = false;
        guard.drag_origin = None;
        guard.move_remainder = (0.0, 0.0);
    }
    diagnostics::report("load the desktop page", window.navigate(target));
}

/// Stops as soon as the mounted page reports its hit rectangles. Image decoding
/// can finish later; a healthy page owns its own transport and needs no native poll.
pub fn recover_initial_page(window: WebviewWindow, initial_url: Url, allow_discovery: bool) {
    let app = window.app_handle().clone();
    let generation = {
        let state = state_of(&app);
        let mut guard = state.lock().expect("shell state");
        guard.connection_generation += 1;
        guard.connection_generation
    };
    std::thread::spawn(move || {
        let mut navigations: u32 = 0;
        let mut waiting_reported = false;
        let mut pause = PROBE_EVERY;
        loop {
            std::thread::sleep(pause);
            if app.get_webview_window("pet").is_none() {
                return;
            }
            let needs_document = || {
                let state = state_of(&app);
                let guard = state.lock().expect("shell state");
                guard.connection_generation == generation && guard.pet.is_none()
            };
            if !needs_document() {
                return;
            }
            let Some(target) = target_for(allow_discovery, &initial_url) else {
                // Harness (or the pinned server) is not answering yet: keep asking, and say so once.
                if !waiting_reported {
                    waiting_reported = true;
                    println!("shell: waiting for Harness to answer; the desktop page loads when it does");
                }
                pause = PROBE_EVERY;
                continue;
            };
            // Mounting may have finished while the readiness probe was in flight.
            if !needs_document() {
                return;
            }
            if navigations >= MAX_NAVIGATIONS {
                eprintln!(
                    "shell: the desktop page loaded {MAX_NAVIGATIONS} times and never reported in; \
                     the shell stopped reloading it. Use Reconnect in the shell menu to try again."
                );
                return;
            }
            navigations += 1;
            println!("shell: retrying desktop page at {target} (load {navigations} of {MAX_NAVIGATIONS})");
            navigate(&window, target);
            pause = navigation_backoff(navigations);
        }
    });
}

/// Where the next load should point, or None while that target is not answering.
fn target_for(allow_discovery: bool, initial_url: &Url) -> Option<Url> {
    if allow_discovery {
        let base = discover_base()?;
        desktop_url(&base).parse().ok()
    } else {
        // An explicit URL remains pinned, including a development server on a different port.
        // Never silently move it to another Harness profile.
        let state_url = format!(
            "{}/big-fat-fish-girl/v1/state",
            initial_url.origin().ascii_serialization()
        );
        let answering = matches!(
            ureq::get(&state_url).timeout(Duration::from_millis(250)).call(),
            Ok(response) if response.status() == 200
        );
        answering.then(|| initial_url.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::{navigation_backoff, MAX_NAVIGATIONS};
    use std::time::Duration;

    #[test]
    fn the_pause_doubles_from_three_seconds_and_stops_at_a_minute() {
        assert_eq!(navigation_backoff(0), Duration::from_secs(3));
        assert_eq!(navigation_backoff(1), Duration::from_secs(6));
        assert_eq!(navigation_backoff(4), Duration::from_secs(48));
        assert_eq!(navigation_backoff(5), Duration::from_secs(60));
        assert_eq!(navigation_backoff(u32::MAX), Duration::from_secs(60));
    }

    #[test]
    fn the_retries_are_bounded_to_a_quarter_hour() {
        let total: u64 = (0..MAX_NAVIGATIONS).map(|n| navigation_backoff(n).as_secs()).sum();
        assert!(total < 15 * 60, "the shell gives up within a quarter hour, not never");
    }
}
