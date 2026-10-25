// All pacing in one profile: tune here, not in two surfaces (plan §5.1). Every number is a
// duration in milliseconds unless its name says otherwise, or a probability.

export const TEMPO = Object.freeze({
  // Sleep only after 5–8 quiet minutes; any real state wakes her.
  sleepAfterMs: 6 * 60 * 1000,
  // The first free antic waits longer than the following ones.
  firstIdleMinMs: 45000,
  firstIdleMaxMs: 90000,
  idleMinMs: 90000,
  idleMaxMs: 240000,
  workingMinMs: 12000,
  workingMaxMs: 30000,
  // Hover: a held cursor earns a reaction; repeated entries are rare.
  hoverCooldownMs: 16000,
  hoverLineMs: 5000,
  // Give a phrase five seconds; longer text earns extra reading time.
  bubbleMs: 5000,
  bubbleMaxMs: 9000,
  bubbleCharMs: 90,
  bubbleCooldownMs: 12000,
  // The work pose stays a moment after the tool result, so short calls stay readable.
  toolHoldMinMs: 2000,
  toolHoldMs: 4000,
  // A snack follows a long continuous stretch of work, never a schedule (plan §5.2).
  mealWorkMinMs: 3 * 60 * 1000,
  mealWorkMaxMs: 5 * 60 * 1000,
  mealMs: 8000,
  mealMinShownMs: 2500,
  // Longer gaps between drawn frames mean the page was hidden: that time was not shown.
  mealRenderGapMs: 250,
  mealCooldownMinMs: 12 * 60 * 1000,
  mealCooldownMaxMs: 20 * 60 * 1000,
  mealLineChance: 0.3,
  // Angry-tool reaction: short, and never back to back.
  toolErrorMs: 1600,
  toolErrorCooldownMs: 5000,
  // Work is "still going" across the short gaps between turns; a long quiet resets it.
  workGapMs: 120 * 1000,
  // A wallet check closes a noticeable job; retries and reconnects never trigger it.
  remainReviewMs: 2600,
  reviewTailMs: 350,
  walletMs: 5000,
  walletCooldownMs: 7.5 * 60 * 1000,
  walletLineChance: 0.5,
})
