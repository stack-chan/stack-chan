import { createFaceContext } from 'piu-renderer-base'
import { createBlinkBehavior, createBreathBehavior, createSaccadeBehavior } from 'piu-face-behaviors'

export function testBlinkBehavior(): boolean {
  trace('Testing BlinkBehavior...\n')

  const blinkBehavior = createBlinkBehavior({
    openMin: 100,
    openMax: 200,
    closeMin: 50,
    closeMax: 100,
  })

  const faceContext = createFaceContext()
  const initialEyeOpen = faceContext.eyes.left.open

  // Test initial state
  if (initialEyeOpen !== 1) {
    trace('FAIL: Initial eye open should be 1\n')
    return false
  }

  // Run behavior for several ticks
  for (let i = 0; i < 10; i++) {
    blinkBehavior.modify(faceContext, 16)
  }

  // Eyes should still be affected by the behavior
  const eyeOpenAfter = faceContext.eyes.left.open
  if (eyeOpenAfter < 0 || eyeOpenAfter > 1) {
    trace(`FAIL: Eye open value out of range: ${eyeOpenAfter}\n`)
    return false
  }

  // Both eyes should have same value
  if (faceContext.eyes.left.open !== faceContext.eyes.right.open) {
    trace('FAIL: Left and right eyes should have same open value\n')
    return false
  }

  trace('PASS: BlinkBehavior test\n')
  return true
}

export function testBreathBehavior(): boolean {
  trace('Testing BreathBehavior...\n')

  const breathBehavior = createBreathBehavior({ duration: 1000 })
  const faceContext = createFaceContext()

  // Initial breath should be 1
  if (faceContext.breath !== 1) {
    trace('FAIL: Initial breath should be 1\n')
    return false
  }

  // Run for half cycle (500ms)
  for (let i = 0; i < 31; i++) {
    // 31 * 16 = 496ms ≈ 500ms
    breathBehavior.modify(faceContext, 16)
  }

  // Breath should have changed
  if (faceContext.breath === 1) {
    trace('FAIL: Breath should have changed after time\n')
    return false
  }

  // Breath should be in valid range (quantized but should be between -1 and 1)
  if (faceContext.breath < -1 || faceContext.breath > 1) {
    trace(`FAIL: Breath value out of range: ${faceContext.breath}\n`)
    return false
  }

  trace('PASS: BreathBehavior test\n')
  return true
}

export function testSaccadeBehavior(): boolean {
  trace('Testing SaccadeBehavior...\n')

  const saccadeBehavior = createSaccadeBehavior({
    updateMin: 50,
    updateMax: 100,
    gain: 0.5,
  })

  const faceContext = createFaceContext()
  const initialGazeX = faceContext.eyes.left.gazeX
  const initialGazeY = faceContext.eyes.left.gazeY

  // Initial gaze should be 0
  if (initialGazeX !== 0 || initialGazeY !== 0) {
    trace('FAIL: Initial gaze should be 0\n')
    return false
  }

  // Run behavior for enough time to trigger saccade
  for (let i = 0; i < 10; i++) {
    // 10 * 16 = 160ms, should trigger at least one saccade
    saccadeBehavior.modify(faceContext, 16)
  }

  // Gaze should have changed (eventually)
  const gazeXAfter = faceContext.eyes.left.gazeX
  const gazeYAfter = faceContext.eyes.left.gazeY

  // Both eyes should have same gaze values
  if (
    faceContext.eyes.left.gazeX !== faceContext.eyes.right.gazeX ||
    faceContext.eyes.left.gazeY !== faceContext.eyes.right.gazeY
  ) {
    trace('FAIL: Left and right eyes should have same gaze values\n')
    return false
  }

  // Values should be reasonable (within gain * reasonable random range)
  if (Math.abs(gazeXAfter) > 5 || Math.abs(gazeYAfter) > 5) {
    trace(`FAIL: Gaze values too extreme: X=${gazeXAfter}, Y=${gazeYAfter}\n`)
    return false
  }

  trace('PASS: SaccadeBehavior test\n')
  return true
}

export function runBehaviorTests(): boolean {
  trace('=== Running Face Behavior Tests ===\n')

  let allPassed = true

  allPassed = testBlinkBehavior() && allPassed
  allPassed = testBreathBehavior() && allPassed
  allPassed = testSaccadeBehavior() && allPassed

  if (allPassed) {
    trace('=== All Behavior Tests PASSED ===\n')
  } else {
    trace('=== Some Behavior Tests FAILED ===\n')
  }

  return allPassed
}
