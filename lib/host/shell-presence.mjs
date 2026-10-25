// Whether a desktop shell is showing the pet. While one is, the in-page overlay steps aside,
// so the character is never drawn twice. A shell that just dropped its connection keeps
// counting as present for a grace period: its page retries after 3 s, and the overlay must
// not flicker back in between.
export const SHELL_GRACE_MS = 15000

/**
 * @param options.shellStarted the plugin launched a shell itself; that counts as seen now
 * @param options.now clock, injectable for tests
 * @param options.graceMs how long a disconnected shell still counts as present
 */
export function createShellPresence({ shellStarted = false, now = () => Date.now(), graceMs = SHELL_GRACE_MS } = {}) {
  let desktopClients = 0
  let lastSeenAt = shellStarted ? now() : -Infinity
  let published = null

  const active = () => desktopClients > 0 || now() - lastSeenAt < graceMs

  return {
    active,
    open() {
      desktopClients += 1
      lastSeenAt = now()
    },
    close() {
      desktopClients = Math.max(0, desktopClients - 1)
      lastSeenAt = now()
    },
    /** The flag as a snapshot carries it; remembered so `changed()` can compare later. */
    publish() {
      published = active()
      return published
    },
    /** Whether the flag flipped since the last snapshot, e.g. the shell quit on its own. */
    changed() {
      return published !== null && published !== active()
    },
  }
}
