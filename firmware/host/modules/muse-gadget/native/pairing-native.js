import Timer from 'timer'

export const pairingSelftest = native('xs_pairing_selftest')

const construct = native('xs_pairing_constructor')
const close = native('xs_pairing_close')
const info = native('xs_pairing_info')
const hello = native('xs_pairing_hello')
const finished = native('xs_pairing_finished')
const arm = native('xs_pairing_arm')
const confirm = native('xs_pairing_confirm')
const status = native('xs_pairing_status')
const current = native('xs_pairing_current')
const reset = native('xs_pairing_reset')
const receive = native('xs_pairing_receive')
const recordCurrent = native('xs_pairing_record_current')
const discard = native('xs_pairing_discard')
const generation = native('xs_pairing_generation')
const scanResult = native('xs_pairing_scan_result')
const accountConstruct = native('xs_account_constructor')
const accountCurrent = native('xs_account_current')
const accountCommit = native('xs_account_commit')
const accountConnect = native('xs_account_connect')
const accountClose = native('xs_account_close')
const accountPoll = native('xs_account_poll')
const accountCancel = native('xs_account_cancel')
const accountRestore = native('xs_account_restore')
const accountGeneration = native('xs_account_generation')
const restoreToken = Symbol()
const accountFailures = new Set([
  'account invalid',
  'account cancelled',
  'account approval required',
  'account storage failed',
  'account HTTP failed',
  'account access denied',
  'account refresh rejected',
  'account response invalid',
  'account busy',
  'account access expired',
  'account worker unavailable',
  'account owner expired',
  'account worker result unavailable',
  'account HTTP clock',
  'account HTTP input',
  'account HTTP privacy',
  'account HTTP allocation',
  'account HTTP configuration',
  'account HTTP cancelled',
  'account HTTP deadline',
  'account HTTP redirect',
  'account HTTP response limit',
  'account HTTP transport',
  'account HTTP unsupported transport',
  'account HTTP SDK unavailable',
  'account HTTP DNS',
  'account HTTP socket',
  'account HTTP connect',
  'account HTTP connect timeout',
  'account HTTP certificate',
  'account HTTP TLS handshake',
  'account HTTP TLS IO',
  'account HTTP TLS setup',
])
function accountFailure(error) {
  return new Error(accountFailures.has(error?.message) ? error.message : 'account preparation failed')
}

export class AccountSession extends Native('xs_account_destructor') {
  #pending
  #closed = false
  constructor(pairing, generation) {
    super()
    if (pairing === restoreToken) accountRestore.call(this)
    else accountConstruct.call(this, pairing, generation)
  }
  static restore() {
    return new AccountSession(restoreToken)
  }
  get generation() {
    return accountGeneration.call(this)
  }
  current(generation) {
    return accountCurrent.call(this, generation)
  }
  commitApproved(generation) {
    return accountCommit.call(this, generation)
  }
  connectApproved(generation) {
    if (this.#closed || this.#pending) return Promise.reject(new Error('account unavailable'))
    return new Promise((resolve, reject) => {
      const pending = { reject, timer: undefined }
      this.#pending = pending
      let started = false
      try {
        accountConnect.call(this, generation)
        started = true
        pending.timer = Timer.repeat(() => {
          if (this.#pending !== pending) return
          try {
            const result = accountPoll.call(this)
            if (!result) return
            Timer.clear(pending.timer)
            this.#pending = undefined
            resolve(result)
          } catch (error) {
            Timer.clear(pending.timer)
            this.#pending = undefined
            reject(accountFailure(error))
          }
        }, 25)
      } catch (error) {
        this.#pending = undefined
        if (started) {
          this.#closed = true
          accountClose.call(this)
        }
        reject(accountFailure(error))
      }
    })
  }
  cancel() {
    accountCancel.call(this)
  }
  close() {
    if (this.#closed) return
    this.#closed = true
    const pending = this.#pending
    this.#pending = undefined
    if (pending) {
      if (pending.timer !== undefined) Timer.clear(pending.timer)
      pending.reject(new Error('account closed'))
    }
    accountClose.call(this)
  }
}

export default class PairingNative extends Native('xs_pairing_destructor') {
  constructor({ nodeId, deviceId, mac, firmwareVersion }) {
    super()
    construct.call(this, nodeId, deviceId, mac, firmwareVersion)
  }
  close() {
    close.call(this)
  }
  info() {
    return info.call(this)
  }
  hello(json) {
    return hello.call(this, json)
  }
  finished(encryptedRecord) {
    return finished.call(this, encryptedRecord)
  }
  arm(generation) {
    return arm.call(this, generation)
  }
  confirm() {
    return confirm.call(this)
  }
  status(name, generation) {
    return status.call(this, name, generation)
  }
  current(generation) {
    return current.call(this, generation)
  }
  reset() {
    reset.call(this)
  }
  receive(json) {
    return receive.call(this, json)
  }
  recordCurrent(generation) {
    return recordCurrent.call(this, generation)
  }
  discard() {
    discard.call(this)
  }
  generation() {
    return generation.call(this)
  }
  scanResult(generation, networksJSON) {
    return scanResult.call(this, generation, networksJSON)
  }
}
