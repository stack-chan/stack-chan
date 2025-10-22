import { PiuRendererBase, createFaceContext } from 'piu-renderer-base'
import { Emotion } from 'renderer-base'

export function testRendererBasic(): boolean {
  trace('Testing PiuRendererBase basic functionality...\n')

  const renderer = new PiuRendererBase(null, {})

  // Test initial state
  const initialContext = renderer.getFaceContext()
  if (!initialContext) {
    trace('FAIL: Initial context should exist\n')
    return false
  }

  if (initialContext.emotion !== Emotion.NEUTRAL) {
    trace('FAIL: Initial emotion should be NEUTRAL\n')
    return false
  }

  if (initialContext.eyes.left.open !== 1 || initialContext.eyes.right.open !== 1) {
    trace('FAIL: Initial eyes should be open\n')
    return false
  }

  if (initialContext.mouth.open !== 0) {
    trace('FAIL: Initial mouth should be closed\n')
    return false
  }

  trace('PASS: PiuRendererBase basic test\n')
  return true
}

export function testContextUpdate(): boolean {
  trace('Testing context update...\n')

  const renderer = new PiuRendererBase(null, {})
  const testContext = createFaceContext()

  // Modify test context
  testContext.emotion = Emotion.HAPPY
  testContext.mouth.open = 0.8
  testContext.eyes.left.gazeX = 0.5
  testContext.theme.primary = [0xff, 0x00, 0x00] // Red

  // Update renderer
  renderer.update(testContext)

  // Get updated context
  const updatedContext = renderer.getFaceContext()

  // Context should be updated (note: behaviors might modify values)
  if (updatedContext.emotion !== Emotion.HAPPY) {
    trace('FAIL: Emotion should be updated to HAPPY\n')
    return false
  }

  // Primary color should be updated
  const [r, g, b] = updatedContext.theme.primary
  if (r !== 0xff || g !== 0x00 || b !== 0x00) {
    trace(`FAIL: Primary color should be red, got [${r}, ${g}, ${b}]\n`)
    return false
  }

  trace('PASS: Context update test\n')
  return true
}

export function testBehaviorIntegration(): boolean {
  trace('Testing behavior integration...\n')

  const renderer = new PiuRendererBase(null, {})

  // Create a simple test behavior
  const testBehavior = {
    modify(faceContext, _tick) {
      faceContext.mouth.open = 0.5 // Always set mouth to half open
    },
  }

  renderer.addBehavior(testBehavior)

  const testContext = createFaceContext()
  testContext.mouth.open = 0 // Start with closed mouth

  renderer.update(testContext)

  const updatedContext = renderer.getFaceContext()

  // Mouth should be modified by behavior
  if (updatedContext.mouth.open !== 0.5) {
    trace(`FAIL: Mouth should be 0.5, got ${updatedContext.mouth.open}\n`)
    return false
  }

  // Remove behavior
  renderer.removeBehavior(testBehavior)

  // Update again
  testContext.mouth.open = 0.8
  renderer.update(testContext)

  const finalContext = renderer.getFaceContext()

  // Without behavior, mouth should be as set (0.8)
  if (finalContext.mouth.open !== 0.8) {
    trace(`FAIL: After removing behavior, mouth should be 0.8, got ${finalContext.mouth.open}\n`)
    return false
  }

  trace('PASS: Behavior integration test\n')
  return true
}

export function testEmotionStates(): boolean {
  trace('Testing emotion states...\n')

  const renderer = new PiuRendererBase(null, {})
  const emotions = [Emotion.NEUTRAL, Emotion.HAPPY, Emotion.SAD, Emotion.ANGRY, Emotion.SLEEPY]

  for (const emotion of emotions) {
    const testContext = createFaceContext()
    testContext.emotion = emotion

    renderer.update(testContext)
    const updatedContext = renderer.getFaceContext()

    if (updatedContext.emotion !== emotion) {
      trace(`FAIL: Emotion ${emotion} not preserved\n`)
      return false
    }
  }

  trace('PASS: Emotion states test\n')
  return true
}

export function runRenderingTests(): boolean {
  trace('=== Running Face Rendering Tests ===\n')

  let allPassed = true

  allPassed = testRendererBasic() && allPassed
  allPassed = testContextUpdate() && allPassed
  allPassed = testBehaviorIntegration() && allPassed
  allPassed = testEmotionStates() && allPassed

  if (allPassed) {
    trace('=== All Rendering Tests PASSED ===\n')
  } else {
    trace('=== Some Rendering Tests FAILED ===\n')
  }

  return allPassed
}
