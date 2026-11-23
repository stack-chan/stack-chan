import { createHostMuseConversation } from 'muse-host-session'
import { createPairingPeripheral } from 'muse-pairing/peripheral'
import PairingNative, { AccountSession } from 'muse-pairing-native'
import { createPairingController } from 'muse-setup/pairing-controller'
import metadata from 'muse-setup-metadata'
import Preference from 'preference'
import { createConversationPipeline } from 'stackchan/voice/pipeline'
import { createVoiceScope } from 'stackchan/voice/scope'
import Time from 'time'

export function createMuseConversationControl({ microphone, speaker, volume, onEvent, onState }) {
  let active
  let pairing
  let closing
  let shutdown
  let state = { phase: 'idle' }

  function update(phase, extra) {
    state = { phase, ...extra }
    try {
      onState?.(state)
    } catch {}
  }

  function diagnostic(phase, values = []) {
    trace(`MUSE_HOST ${Time.ticks} ${phase} ${values.join(' ')}\n`)
  }

  function checkIdle() {
    if (shutdown || active || pairing || closing) throw new Error('Muse conversation busy')
  }

  function end() {
    if (closing) return closing
    const session = active
    if (!session) return Promise.resolve()
    active = undefined
    update('ending')
    closing = Promise.resolve().then(async () => {
      try {
        session.scope.abort()
        await session.pipeline?.close({ mode: 'abort', timeoutMs: 10000 })
      } finally {
        session.account.close()
        session.scope.dispose()
        closing = undefined
        update(session.error ? 'failed' : 'idle', { error: session.error })
      }
    })
    return closing
  }

  async function start() {
    checkIdle()
    const identity = metadata()
    if (!identity.setupComplete) {
      update('unpaired', { sdkReady: identity.sdkReady })
      return false
    }
    const apiKey = Preference.get('ai', 'geminiToken')
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      update('failed', { error: 'gemini_key_missing' })
      return false
    }
    const scope = createVoiceScope()
    const account = AccountSession.restore()
    const session = { account, scope, pipeline: undefined, error: undefined }
    active = session
    update('connecting')
    try {
      const result = await account.connectApproved(account.generation)
      if (active !== session) return false
      if (result?.prepared !== true) throw new Error('Muse account unavailable')
      session.pipeline = createConversationPipeline({
        microphone,
        speaker,
        conversation: createHostMuseConversation(account, identity.nodeId, apiKey.trim(), diagnostic),
        mediaBudget: { maxBufferedMs: 500, maxBufferedBytes: 49152 },
        microphoneMuted: true,
        onEvent(event) {
          if (active !== session) return
          if (event.type === 'turn.started') update('thinking')
          else if (event.type === 'output.level' && event.value > 0 && state.phase === 'thinking') {
            diagnostic('first_pcm_level')
            update('speaking')
          } else if (
            event.type === 'turn.ended' ||
            (event.type === 'input.transcript' && event.value.final && !event.value.text.trim())
          )
            update('ready')
          if (event.type === 'error') {
            diagnostic('error', [event.code])
            if (event.fatal) {
              session.error = event.code
              void end().catch(() => {})
            } else update('ready')
          }
          onEvent?.(event)
        },
      })
      session.pipeline.setVolume(volume)
      await session.pipeline.start(scope)
      if (active !== session) return false
      update('ready')
      return true
    } catch {
      if (active !== session) return false
      session.error = 'connection_failed'
      diagnostic(session.error)
      await end()
      return false
    }
  }

  async function stopPairing() {
    const setup = pairing
    if (!setup) return
    setup.stopping ??= setup.controller.close().finally(() => {
      if (pairing === setup) pairing = undefined
    })
    await setup.stopping
  }

  return {
    snapshot: () => state,
    start,
    async setTalking(pressed) {
      const session = active
      if (!session?.pipeline || state.phase !== (pressed ? 'ready' : 'listening')) return false
      update(pressed ? 'listening' : 'thinking')
      diagnostic(pressed ? 'pressed' : 'released')
      try {
        await session.pipeline.setMicrophoneMuted(!pressed)
        return active === session
      } catch {
        if (active === session) update('ready')
        return false
      }
    },
    end,
    async startPairing() {
      if (pairing && (state.phase === 'failed' || state.phase === 'unpaired')) await stopPairing()
      checkIdle()
      const identity = metadata()
      if (!identity.sdkReady) {
        update('unpaired', { sdkReady: false })
        return false
      }
      const setup = { account: undefined, generation: undefined, controller: undefined }
      pairing = setup
      setup.controller = createPairingController({
        identity,
        setupComplete: false,
        createNative: (args) => new PairingNative(args),
        createPeripheral: createPairingPeripheral,
        createAccount: (native, generation) => new AccountSession(native, generation),
        coordinator: {
          acceptProvision(account, generation) {
            setup.account = account
            setup.generation = generation
          },
          close() {
            setup.account?.close()
          },
        },
        onChange({ phase, name }) {
          if (pairing !== setup || phase === 'closed') return
          if (phase === 'confirm' || phase === 'review') update(phase, { name })
          else if (phase === 'failed' || phase === 'disconnected') update('failed', { error: 'pairing_failed' })
          else update('pairing', { name })
        },
      })
      setup.controller.start()
      return true
    },
    async confirmPairing() {
      return (await pairing?.controller.confirmPhysical()) ?? false
    },
    async savePairing() {
      const setup = pairing
      if (state.phase !== 'review' || !setup?.account?.current(setup.generation)) return false
      update('pairing', { name: state.name })
      try {
        if (setup.account.commitApproved(setup.generation)?.saved !== true) throw new Error('Muse account not saved')
      } catch {
        await setup.controller.reportProgress('error_storage')
        if (pairing === setup && !setup.stopping) update('failed', { error: 'pairing_save_failed' })
        return false
      }
      try {
        await setup.controller.reportProgress('wifi_connected')
        if (pairing !== setup || setup.stopping) return false
        const result = await setup.account.connectApproved(setup.generation)
        if (pairing !== setup || setup.stopping) return false
        if (result?.prepared !== true) throw new Error('Muse account unavailable')
        await setup.controller.reportProgress('auth_ok')
        if (pairing !== setup || setup.stopping) return false
        await stopPairing()
        update('idle')
        return true
      } catch {
        if (pairing === setup && !setup.stopping) {
          await setup.controller.reportProgress('auth_failed')
          if (pairing === setup && !setup.stopping) {
            await stopPairing()
            update('failed', { error: 'pairing_auth_failed' })
          }
        }
        return false
      }
    },
    async cancelPairing() {
      if (pairing) {
        await stopPairing()
        update('idle')
      }
    },
    close() {
      shutdown ??= Promise.resolve().then(async () => {
        await Promise.all([end(), stopPairing()])
      })
      return shutdown
    },
  }
}
