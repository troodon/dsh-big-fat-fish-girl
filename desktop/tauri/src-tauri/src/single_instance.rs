//! Windows single-instance guard. The Local namespace scopes the mutex to this desktop session.

use std::io;
use std::ptr;

use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, SetLastError, ERROR_ALREADY_EXISTS, HANDLE,
};
use windows_sys::Win32::System::Threading::CreateMutexW;

const MUTEX_NAME: &str = r"Local\dev.bffg.shell";

/// Holds the named mutex handle open for the full application lifetime.
pub struct InstanceGuard {
    handle: HANDLE,
}

impl Drop for InstanceGuard {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.handle);
        }
    }
}

/// Return `None` when another shell already holds the session-wide name open.
pub fn acquire() -> io::Result<Option<InstanceGuard>> {
    acquire_named(MUTEX_NAME)
}

fn acquire_named(name: &str) -> io::Result<Option<InstanceGuard>> {
    let name: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe { SetLastError(0) };
    let handle = unsafe { CreateMutexW(ptr::null(), 0, name.as_ptr()) };
    if handle.is_null() {
        return Err(io::Error::last_os_error());
    }
    // Capture this immediately: it describes the CreateMutexW call, not CloseHandle.
    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        unsafe {
            CloseHandle(handle);
        }
        return Ok(None);
    }
    Ok(Some(InstanceGuard { handle }))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::acquire_named;

    fn unique_name() -> String {
        static NEXT_ID: AtomicU64 = AtomicU64::new(0);
        format!(
            r"Local\dev.bffg.shell.test.{}.{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        )
    }

    #[test]
    fn duplicate_acquisition_is_rejected_and_release_allows_reacquisition() {
        let name = unique_name();
        let first = acquire_named(&name)
            .expect("create the test mutex")
            .expect("the unique test mutex should be new");
        assert!(acquire_named(&name)
            .expect("open the existing test mutex")
            .is_none());

        drop(first);

        assert!(acquire_named(&name)
            .expect("recreate the released test mutex")
            .is_some());
    }
}
