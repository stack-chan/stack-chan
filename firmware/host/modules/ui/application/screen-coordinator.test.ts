import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ScreenCoordinator, ScreenKind, type ScreenState } from './screen-coordinator.js'

test('ScreenCoordinator starts in Face foreground state', () => {
  const coordinator = new ScreenCoordinator()

  assert.equal(coordinator.kind, ScreenKind.Face)
  assert.equal(coordinator.isFaceForeground, true)
  assert.equal(coordinator.appId, null)
  assert.equal(coordinator.title, null)
  assert.equal(coordinator.sessionId, 0)
  assert.equal(Object.isFrozen(coordinator.state), true)
  assert.deepEqual(coordinator.handleBackAction(), { action: 'none' })
})

test('ScreenCoordinator manages launcher, mini-app sessions, and stale exit guards', () => {
  const coordinator = new ScreenCoordinator()
  const events: Array<{ next: ScreenState; previous: ScreenState }> = []
  const unsubscribe = coordinator.subscribe((next, previous) => {
    events.push({ next, previous })
  })

  assert.equal(coordinator.openMiniAppLauncher(), true)
  assert.equal(coordinator.openMiniAppLauncher(), false)
  assert.equal(coordinator.kind, ScreenKind.MiniAppLauncher)
  assert.equal(coordinator.isFaceForeground, false)
  assert.equal(coordinator.title, 'ミニアプリ')

  const firstSession = coordinator.enterMiniApp('app.timer', 'Timer')
  assert.equal(firstSession, 1)
  assert.equal(coordinator.kind, ScreenKind.MiniAppRunning)
  assert.equal(coordinator.appId, 'app.timer')
  assert.equal(coordinator.title, 'Timer')
  assert.equal(coordinator.sessionId, 1)
  assert.equal(coordinator.isFaceForeground, false)

  assert.equal(coordinator.exitMiniApp(999), false)
  assert.equal(coordinator.kind, ScreenKind.MiniAppRunning)

  const secondSession = coordinator.enterMiniApp('app.clock', 'Clock')
  assert.equal(secondSession, 2)
  assert.equal(coordinator.exitMiniApp(firstSession), false)
  assert.equal(coordinator.exitMiniApp(secondSession), true)
  assert.equal(coordinator.kind, ScreenKind.Face)
  assert.equal(coordinator.isFaceForeground, true)
  assert.equal(coordinator.appId, null)
  assert.equal(coordinator.title, null)
  assert.equal(coordinator.sessionId, 0)
  assert.equal(coordinator.exitMiniApp(), false)

  unsubscribe()
  assert.equal(coordinator.enterSystemView('Camera'), true)
  assert.equal(events.length, 4)
  assert.equal(events[0].previous.kind, ScreenKind.Face)
  assert.equal(events[0].next.kind, ScreenKind.MiniAppLauncher)
  assert.equal(events[3].previous.kind, ScreenKind.MiniAppRunning)
  assert.equal(events[3].next.kind, ScreenKind.Face)
})

test('ScreenCoordinator handles back actions and system views idempotently', () => {
  const coordinator = new ScreenCoordinator()

  assert.equal(coordinator.openMiniAppLauncher('Apps'), true)
  assert.deepEqual(coordinator.handleBackAction(), { action: 'return-to-face' })
  assert.equal(coordinator.isFaceForeground, true)
  assert.equal(coordinator.returnToFace(), false)

  const sessionId = coordinator.enterMiniApp('app.demo', 'Demo')
  assert.deepEqual(coordinator.handleBackAction(), {
    action: 'exit-mini-app',
    appId: 'app.demo',
    sessionId,
  })
  assert.equal(coordinator.isFaceForeground, true)

  assert.equal(coordinator.enterSystemView('Camera Preview'), true)
  assert.equal(coordinator.enterSystemView('Camera Preview'), false)
  assert.equal(coordinator.kind, ScreenKind.SystemView)
  assert.equal(coordinator.title, 'Camera Preview')
  assert.equal(coordinator.isFaceForeground, false)

  assert.deepEqual(coordinator.handleBackAction(), { action: 'return-to-face' })
  assert.equal(coordinator.kind, ScreenKind.Face)
  assert.equal(coordinator.isFaceForeground, true)
})
