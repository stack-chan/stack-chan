import { AccountSession } from 'muse-pairing-native'
import { isConnectionDiagnostic } from 'muse-setup/conversation-owner'
import { createSetupConversationRuntime } from 'muse-setup/conversation-runtime'
import metadata from 'muse-setup-metadata'
import Timer from 'timer'

const report = (value) => {
  if (isConnectionDiagnostic(value)) trace(`MUSE_CONNECT ${value}\n`)
}
Timer.set(async () => {
  let owner, account
  trace('MUSE_PROBE start\n')
  try {
    account = AccountSession.restore()
    const runtime = createSetupConversationRuntime(
      () => {},
      () => {},
      report,
      { volume: 0 },
    )
    owner = runtime.wrap(account, metadata())
    const result = await owner.connectApproved(account.generation)
    trace(result?.connected === true ? 'MUSE_PROBE connected\n' : 'MUSE_PROBE failed\n')
  } catch {
    trace('MUSE_PROBE failed\n')
  } finally {
    try {
      if (owner) await owner.close()
      else account?.close()
    } catch {
      trace('MUSE_PROBE close_failed\n')
    }
    trace('MUSE_PROBE closed\n')
  }
}, 1000)
