//! Finding Harness on loopback and building the page URL.

use std::time::Duration;

use bffg_shell_core::discover_candidates;

/// Harness's long-standing loopback port, probed first when no URL is given.
pub const DEFAULT_PORT: u16 = 19387;
/// How far around the default port to look for a Harness started elsewhere.
const DISCOVER_RADIUS: u16 = 12;

/// Whether a Harness with this plugin is serving on the port right now.
fn probe_port(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{port}/big-fat-fish-girl/v1/state");
    matches!(ureq::get(&url).timeout(Duration::from_millis(250)).call(), Ok(response) if response.status() == 200)
}

/// The standalone shell does not require `--url`: it finds the running Harness itself.
pub fn discover_base() -> Option<String> {
    for port in discover_candidates(DEFAULT_PORT, DISCOVER_RADIUS) {
        if probe_port(port) {
            return Some(format!("http://127.0.0.1:{port}"));
        }
    }
    None
}

pub fn desktop_url(base: &str) -> String {
    format!("{base}/big-fat-fish-girl/v1/desktop")
}

/// The page to load on startup or after Reconnect: a pinned URL (`--url`/`BFFG_URL`)
/// stays pinned, otherwise discovery probes the ring around the default port.
///
/// The plugin passes `--url` because Harness 0.2.1 binds an OS-assigned loopback port
/// that no fixed-port probe can find; discovery remains for a by-hand start.
pub fn page_target(pinned: Option<&str>) -> Option<String> {
    match pinned {
        Some(url) => Some(url.to_string()),
        None => discover_base().map(|base| desktop_url(&base)),
    }
}

/// `--url <page>`, `--url=<page>`, a bare http argument, or nothing.
pub fn url_arg(args: &[String]) -> Option<String> {
    for (index, arg) in args.iter().enumerate() {
        if let Some(value) = arg.strip_prefix("--url=") {
            return Some(value.to_string());
        }
        if arg == "--url" {
            return args.get(index + 1).cloned();
        }
    }
    args.iter().find(|arg| arg.starts_with("http")).cloned()
}

#[cfg(test)]
mod tests {
    use super::{page_target, url_arg};

    #[test]
    fn a_pinned_page_url_stays_pinned() {
        let pinned = "http://127.0.0.1:50543/big-fat-fish-girl/v1/desktop";
        assert_eq!(page_target(Some(pinned)).as_deref(), Some(pinned));
    }

    #[test]
    fn the_url_argument_accepts_both_spellings_and_a_bare_http_url() {
        let spaced = vec!["--url".to_string(), "http://127.0.0.1:50543/x".to_string()];
        assert_eq!(url_arg(&spaced).as_deref(), Some("http://127.0.0.1:50543/x"));
        let joined = vec!["--url=http://127.0.0.1:50543/x".to_string()];
        assert_eq!(url_arg(&joined).as_deref(), Some("http://127.0.0.1:50543/x"));
        let bare = vec!["http://127.0.0.1:50543/x".to_string()];
        assert_eq!(url_arg(&bare).as_deref(), Some("http://127.0.0.1:50543/x"));
        assert_eq!(url_arg(&[]), None);
    }
}
