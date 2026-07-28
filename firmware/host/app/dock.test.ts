import assert from 'node:assert/strict'
import test from 'node:test'
import {
  STACKCHAN_DOCK_MODULE,
  type StackchanDock,
  type StackchanDockModules,
  type StackchanDockRuntime,
  startStackchanDock,
} from './dock.js'

class FakeModules implements StackchanDockModules {
  constructor(readonly module?: unknown) {}

  has(specifier: string): boolean {
    return specifier === STACKCHAN_DOCK_MODULE && this.module !== undefined
  }

  importNow(specifier: string): unknown {
    assert.equal(specifier, STACKCHAN_DOCK_MODULE)
    return this.module
  }
}

test('an unconfigured Stackchan Dock is optional', () => {
  assert.equal(startStackchanDock(new FakeModules()), undefined)
})

test('the configured Stackchan Dock starts and returns its runtime', () => {
  const runtime = fakeRuntime()
  const dock: StackchanDock = { start: () => runtime }

  assert.equal(startStackchanDock(new FakeModules(dock)), runtime)
})

test('a Dock may be present but disabled by its own configuration', () => {
  const dock: StackchanDock = { start: () => undefined }

  assert.equal(startStackchanDock(new FakeModules(dock)), undefined)
})

test('invalid Dock exports and runtimes fail during startup', () => {
  assert.throws(() => startStackchanDock(new FakeModules({})), /does not export a StackchanDock/)
  assert.throws(
    () => startStackchanDock(new FakeModules({ start: () => ({ close() {} }) })),
    /returned an invalid runtime/,
  )
})

function fakeRuntime(): StackchanDockRuntime {
  return {
    onContextCreated() {},
    close() {},
  }
}
