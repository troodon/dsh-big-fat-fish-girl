//! Failures the shell can survive are reported, not dropped: a window call the OS refused, a
//! script the page could not run. The shell carries on; the failure stays in its output.

use std::fmt::Display;

/// The line printed for a failed call, or None when the call succeeded. Pure, so the wording
/// is tested without a window.
pub fn failure_line<T, E: Display>(action: &str, result: &Result<T, E>) -> Option<String> {
    result
        .as_ref()
        .err()
        .map(|error| format!("shell: {action} failed: {error}"))
}

/// Report the outcome of a best-effort call. Success is silent; a failure is printed with the
/// action that failed, so the log says what did not happen.
pub fn report<T, E: Display>(action: &str, result: Result<T, E>) {
    if let Some(line) = failure_line(action, &result) {
        eprintln!("{line}");
    }
}

#[cfg(test)]
mod tests {
    use super::failure_line;

    #[test]
    fn a_failure_names_the_action_and_the_cause() {
        let failed: Result<(), &str> = Err("window is gone");
        assert_eq!(
            failure_line("move the window", &failed).as_deref(),
            Some("shell: move the window failed: window is gone"),
        );
    }

    #[test]
    fn a_success_prints_nothing() {
        let ok: Result<(), &str> = Ok(());
        assert_eq!(failure_line("move the window", &ok), None);
    }
}
