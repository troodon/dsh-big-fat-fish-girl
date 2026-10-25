// Interface strings, English. All locale dictionaries share the same keys; tests enforce parity.
export const UI_EN = Object.freeze({
  // Native desktop menu (macOS): the page passes these to the shell.
  menuReconnect: 'Reconnect',
  menuReset: 'Reset position',
  menuHide: 'Hide for this run',
  menuQuit: 'Quit',
  // Settings section (rendered inside Harness's own Settings panel).
  settingsIntro: 'Changes apply immediately.',
  size: 'Size',
  opacity: 'Opacity',
  reducedMotion: 'Reduce motion',
  hover: 'React to hover',
  randomActs: 'Random antics',
  meal: 'Snacks',
  wallet: 'Wallet',
  wander: 'Wandering',
  autoStartShell: 'Start with Harness',
  locale: 'Bubble language',
  skin: 'Skin',
  loading: 'Reading settings…',
  unavailable: 'Settings are unavailable: the host does not store configuration.',
  retry: 'Retry',
  // Compact bubble over the pinned task: counts of its active helpers.
  teamTitle: 'Helpers: {summary}',
  teamActive: '{count} working',
  teamWaiting: '{count} waiting',
  teamCompleted: '{count} done',
  teamErrors: '{count} with errors',
  // Tooltip on the wallet bubble: real token counts, never a fabricated balance.
  usageTitle: 'Last job: {total} tokens ({input} in / {output} out)',
})
