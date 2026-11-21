import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

let source = readFileSync(new URL('../pairing-native.js', import.meta.url), 'utf8')
source =
  source
    .replace("import Timer from 'timer'", '')
    .replace('export const pairingSelftest', 'const pairingSelftest')
    .replace('export class AccountSession', 'class AccountSession')
    .replace('export default class PairingNative', 'class PairingNative') +
  '\nglobalThis.AccountSession=AccountSession;'
let callback,
  clearCount = 0,
  closeCount = 0,
  startCount = 0,
  pollCount = 0,
  cancelled = false,
  ready = false,
  timerFail = false
let restoreError,
  restores = 0
let pollError
const methods = {
  xs_account_constructor() {
    this.open = true
  },
  xs_account_restore() {
    restores++
    if (restoreError) throw Error(restoreError)
    this.open = true
    this.restoredGeneration = 2147483649
  },
  xs_account_generation() {
    return this.restoredGeneration ?? 7
  },
  xs_account_current() {
    return this.open
  },
  xs_account_connect() {
    startCount++
    if (!this.open) throw Error('closed')
  },
  xs_account_poll() {
    pollCount++
    if (pollError) throw Error(pollError)
    if (cancelled) throw Error('cancelled')
    return ready ? { prepared: true } : false
  },
  xs_account_cancel() {
    cancelled = true
  },
  xs_account_close() {
    this.open = false
    closeCount++
  },
}
const context = vm.createContext({
  Native: () => class {},
  native: (name) => methods[name] ?? (() => {}),
  Timer: {
    repeat(fn, ms) {
      assert.equal(ms, 25)
      if (timerFail) throw Error('timer allocation')
      callback = fn
      return 1
    },
    clear(id) {
      assert.equal(id, 1)
      clearCount++
    },
  },
})
vm.runInContext(source, context)
const Account = context.AccountSession
let owner = new Account({}, 7)
let promise = owner.connectApproved(7)
await assert.rejects(owner.connectApproved(7), /unavailable/)
callback()
assert.equal(pollCount, 1)
ready = true
callback()
assert.equal((await promise).prepared, true)
assert.equal(owner.current(7), true)
owner.close()
owner.close()
assert.equal(closeCount, 1)
await assert.rejects(owner.connectApproved(7), /unavailable/)
ready = false
owner = new Account({}, 7)
promise = owner.connectApproved(7)
const oldCallback = callback
owner.close()
await assert.rejects(promise, /closed/)
const previous = pollCount
oldCallback()
assert.equal(pollCount, previous)
owner = new Account({}, 7)
promise = owner.connectApproved(7)
owner.cancel()
callback()
await assert.rejects(promise, /preparation failed/)
owner.close()
cancelled = false
timerFail = true
owner = new Account({}, 7)
await assert.rejects(owner.connectApproved(7), /preparation failed/)
assert.equal(owner.current(7), false)
assert.equal(startCount, 4)
assert.equal(closeCount, 4)
assert.equal(clearCount, 3)
owner = Account.restore()
assert.equal(owner.generation, 2147483649)
assert.equal(owner.current(owner.generation), true)
assert.equal(startCount, 4)
owner.close()
for (const code of ['account record absent', 'account record invalid', 'account store unavailable']) {
  restoreError = code
  assert.throws(() => Account.restore(), new RegExp(code))
}
assert.equal(restores, 4)
timerFail = false
for (const [input, expected] of [
  ['account HTTP deadline', 'account HTTP deadline'],
  ['account HTTP DNS', 'account HTTP DNS'],
  ['account HTTP socket', 'account HTTP socket'],
  ['account HTTP connect', 'account HTTP connect'],
  ['account HTTP connect timeout', 'account HTTP connect timeout'],
  ['account HTTP certificate', 'account HTTP certificate'],
  ['account HTTP TLS handshake', 'account HTTP TLS handshake'],
  ['account HTTP TLS IO', 'account HTTP TLS IO'],
  ['account HTTP TLS setup', 'account HTTP TLS setup'],
  ['account response invalid', 'account response invalid'],
  ['PRIVATE_SYNTHETIC_ERROR_BODY', 'account preparation failed'],
]) {
  pollError = input
  owner = new Account({}, 7)
  promise = owner.connectApproved(7)
  callback()
  await assert.rejects(promise, (error) => error.message === expected)
  owner.close()
}
console.log('MUSE_ACCOUNT_JS_BINDING_MOCK_PASS')
