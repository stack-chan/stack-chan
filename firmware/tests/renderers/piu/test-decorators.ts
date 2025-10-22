import { PiuHeartDecorator, PiuBalloonDecorator, PiuSweatDecorator, PiuAngerDecorator } from 'piu-decorators'
import { createFaceContext } from 'piu-renderer-base'

export function testHeartDecorator(): boolean {
  trace('Testing PiuHeartDecorator...\n')

  try {
    const heart = new PiuHeartDecorator({ x: 50, y: 50, width: 40, height: 40 })

    // Test initial state
    if (!heart) {
      trace('FAIL: Heart decorator should be created\n')
      return false
    }

    // Test face context update
    const testContext = createFaceContext()
    testContext.theme.primary = [0xff, 0x00, 0x00] // Red

    heart.onFaceContextChanged(testContext)

    trace('PASS: HeartDecorator test\n')
    return true
  } catch (error) {
    trace(`FAIL: HeartDecorator error: ${error}\n`)
    return false
  }
}

export function testBalloonDecorator(): boolean {
  trace('Testing PiuBalloonDecorator...\n')

  try {
    const balloon = new PiuBalloonDecorator({
      left: 10,
      top: 10,
      width: 100,
      height: 50,
    })

    if (!balloon) {
      trace('FAIL: Balloon decorator should be created\n')
      return false
    }

    // Test different positioning
    const balloon2 = new PiuBalloonDecorator({
      right: 10,
      bottom: 10,
      width: 80,
      height: 40,
    })

    if (!balloon2) {
      trace('FAIL: Balloon decorator with right/bottom positioning should be created\n')
      return false
    }

    // Test context update
    const testContext = createFaceContext()
    testContext.theme.primary = [0x00, 0xff, 0x00] // Green
    testContext.theme.secondary = [0x00, 0x00, 0xff] // Blue

    balloon.onFaceContextChanged(testContext)
    balloon2.onFaceContextChanged(testContext)

    trace('PASS: BalloonDecorator test\n')
    return true
  } catch (error) {
    trace(`FAIL: BalloonDecorator error: ${error}\n`)
    return false
  }
}

export function testSweatDecorator(): boolean {
  trace('Testing PiuSweatDecorator...\n')

  try {
    const sweat = new PiuSweatDecorator({ x: 30, y: 30 })

    if (!sweat) {
      trace('FAIL: Sweat decorator should be created\n')
      return false
    }

    // Test context update
    const testContext = createFaceContext()
    testContext.theme.primary = [0x87, 0xce, 0xeb] // Sky blue

    sweat.onFaceContextChanged(testContext)

    trace('PASS: SweatDecorator test\n')
    return true
  } catch (error) {
    trace(`FAIL: SweatDecorator error: ${error}\n`)
    return false
  }
}

export function testAngerDecorator(): boolean {
  trace('Testing PiuAngerDecorator...\n')

  try {
    const anger = new PiuAngerDecorator({ x: 20, y: 20, width: 50, height: 50 })

    if (!anger) {
      trace('FAIL: Anger decorator should be created\n')
      return false
    }

    // Test context update
    const testContext = createFaceContext()
    testContext.theme.primary = [0xff, 0x45, 0x00] // Orange red

    anger.onFaceContextChanged(testContext)

    trace('PASS: AngerDecorator test\n')
    return true
  } catch (error) {
    trace(`FAIL: AngerDecorator error: ${error}\n`)
    return false
  }
}

export function testDecoratorThemeUpdate(): boolean {
  trace('Testing decorator theme updates...\n')

  try {
    const heart = new PiuHeartDecorator({ x: 0, y: 0 })
    const balloon = new PiuBalloonDecorator({ left: 0, top: 0, width: 50, height: 30 })

    // Test theme changes
    const contexts = [
      { primary: [0xff, 0x00, 0x00], secondary: [0x00, 0x00, 0x00] }, // Red/Black
      { primary: [0x00, 0xff, 0x00], secondary: [0xff, 0xff, 0xff] }, // Green/White
      { primary: [0x00, 0x00, 0xff], secondary: [0xff, 0xff, 0x00] }, // Blue/Yellow
    ]

    for (let i = 0; i < contexts.length; i++) {
      const testContext = createFaceContext()
      testContext.theme.primary = contexts[i].primary as [number, number, number]
      testContext.theme.secondary = contexts[i].secondary as [number, number, number]

      heart.onFaceContextChanged(testContext)
      balloon.onFaceContextChanged(testContext)

      trace(`Theme ${i + 1} applied successfully\n`)
    }

    trace('PASS: Decorator theme update test\n')
    return true
  } catch (error) {
    trace(`FAIL: Decorator theme update error: ${error}\n`)
    return false
  }
}

export function runDecoratorTests(): boolean {
  trace('=== Running Decorator Tests ===\n')

  let allPassed = true

  allPassed = testHeartDecorator() && allPassed
  allPassed = testBalloonDecorator() && allPassed
  allPassed = testSweatDecorator() && allPassed
  allPassed = testAngerDecorator() && allPassed
  allPassed = testDecoratorThemeUpdate() && allPassed

  if (allPassed) {
    trace('=== All Decorator Tests PASSED ===\n')
  } else {
    trace('=== Some Decorator Tests FAILED ===\n')
  }

  return allPassed
}
