// Phrase pools, English. All locale dictionaries share the same keys; tests enforce parity.
export const EN = Object.freeze({
  welcome: [
    'Starting',
    'On it',
  ],
  // No "do not distract me" and no "almost there": the plan bans hurrying and shooing (§6.1).
  working: [
    'Working…',
    'Digging into details',
    'This one is serious',
    'Staying focused 🫧',
  ],
  // Waiting is the recognisable anchor: one phrase, no rotation (plan §6.1).
  waiting: [
    'Waiting for you',
  ],
  done: [
    'Done! ✨',
    'Finished!',
    'Take a look',
    'All set, go check',
  ],
  failed: [
    'I need your help',
    'Could not continue',
  ],
  limited: [
    'Stopped at the limit',
  ],
  reading: [
    'Reading…',
    'Let me look…',
  ],
  // Meals and the wallet are silent by default; this is a rare line, not a rotation.
  meal: [
    'A quick bite',
  ],
  wallet: [
    'Checking token usage',
  ],
  // Answering on the keyboard and editing a file are different jobs with different words.
  writing: [
    'Writing the answer…',
    'Typing carefully',
  ],
  editing: [
    'Editing the file…',
    'Working on the document',
  ],
  searching: [
    'Searching…',
    'Where is it?',
  ],
  commanding: [
    'Running a command…',
    'Off we go',
  ],
  browsing: [
    'Looking it up…',
    'Checking the web',
  ],
  asking: [
    'Calling you…',
    'I need you here',
  ],
  delegating: [
    'Delegating…',
    'Sent a helper',
  ],
  planning: [
    'Planning…',
    'Step by step',
  ],
  using: [
    'Reaching for a tool…',
    'Using my hands',
  ],
  sleeping: [
    '💤',
    'Zzz…',
    'Dreaming of fish',
  ],
  idle: [
    'Right here',
    'I am around',
  ],
  // No tickling: hovering is a polite reaction, not a physical joke.
  hover: [
    'Hee-hee!',
    'Hi there!',
    'You found me!',
  ],
})
