export interface WakeConversationScope {
  /** False after cancellation or supersession. A late successful open still needs to be closed. */
  isCurrent(): boolean
}

export interface WakeConversationLease {
  /** Fulfill only after the underlying audio owner has actually relinquished its lease. */
  close(): void | Promise<void>
}

/** Explicit attestation: the adapter did not acquire exclusive audio ownership. */
export interface WakeDetectorUnavailable {
  status: 'unavailable'
  ownership: 'not-acquired'
}

type WakeDetectorOpen = WakeConversationLease | WakeDetectorUnavailable

export interface WakeConversationAdapters {
  /**
   * The local detector owns audio until positive close. Neither callback carries samples.
   * onFault disarms this detector generation and respects any outstanding ownership;
   * report unknown acquisition/close outcomes by rejecting, not as unavailable.
   */
  openDetector(
    onWake: () => void,
    scope: WakeConversationScope,
    onFault: () => void,
  ): WakeDetectorOpen | Promise<WakeDetectorOpen>
  /**
   * onEnded signals that this particular session should stop. A completed
   * session may rearm the detector; a provider error disarms it.
   * It does not establish that audio was released; the coordinator still calls and awaits close.
   * Return the closeable handle at dispatch, not once a provider connects or network
   * readiness settles. This lets stop close a connecting session. If the adapter
   * defers the handle, its own open must settle on cancellation using the scope.
   * Reject only for an ownership fault; ordinary provider failure uses onEnded.
   */
  startConversation(
    onEnded: (outcome: 'completed' | 'error') => void,
    scope: WakeConversationScope,
  ): WakeConversationLease | Promise<WakeConversationLease>
}

export type WakeConversationStatus =
  | 'disabled'
  | 'opening-detector'
  | 'listening'
  | 'closing-detector'
  | 'starting-conversation'
  | 'conversing'
  | 'closing-conversation'
  | 'fault'
  | 'shutdown'

/**
 * Reconcile one owned audio lease at a time. Request methods take effect immediately,
 * and their promises settle after the current handoffs quiesce. Inspect status/failure
 * for the sticky fault outcome; commands never implicitly retry a faulted operation.
 */
export function createWakeConversation(adapters: WakeConversationAdapters) {
  type Intent = { source: 'wake' | 'manual' }
  type Owned = { lease: WakeConversationLease; policy: object }
  let enabled = false
  let disposed = false
  let failed = false
  let failure: unknown
  let status: WakeConversationStatus = 'disabled'
  let setupPolicy = {}
  let request: Intent | undefined
  let detector: Owned | undefined
  let session: Owned | undefined
  let running: Promise<void> | undefined

  const operational = () => !disposed && !failed
  const wantsDetector = (policy: object) => operational() && enabled && !request && setupPolicy === policy
  const wantsSession = (intent: Intent) => operational() && request === intent

  function schedule() {
    // Assign before any adapter can invoke its callback (even inline inside open).
    running ??= Promise.resolve().then(drive)
    return running
  }
  function validate(lease: WakeConversationLease) {
    if (typeof lease?.close !== 'function') throw new Error('Audio owner did not return a closeable lease')
    return lease
  }
  async function drive() {
    try {
      while (true) {
        if (detector && !wantsDetector(detector.policy)) {
          status = 'closing-detector'
          const closing = detector
          detector = undefined
          await closing.lease.close()
          if (setupPolicy === closing.policy) setupPolicy = {}
        } else if (session && (!request || session.policy !== request || !operational())) {
          status = 'closing-conversation'
          const closing = session
          session = undefined
          await closing.lease.close()
        } else if (disposed) {
          status = failed ? 'fault' : 'shutdown'
          return
        } else if (failed) {
          return
        } else if (session) {
          status = 'conversing'
          return
        } else if (detector) {
          status = 'listening'
          return
        } else if (request) {
          status = 'starting-conversation'
          const intent = request
          const onEnded = (outcome: 'completed' | 'error') => {
            if (!wantsSession(intent)) return
            if (outcome !== 'completed') enabled = false
            request = undefined
            void schedule()
          }
          const lease = validate(await adapters.startConversation(onEnded, { isCurrent: () => wantsSession(intent) }))
          session = { lease, policy: intent }
        } else if (enabled) {
          status = 'opening-detector'
          const policy = {}
          setupPolicy = policy
          const onWake = () => {
            if (!wantsDetector(policy)) return
            request = { source: 'wake' }
            void schedule()
          }
          const onFault = () => {
            // Also cancel a wake queued by this generation while its close is pending.
            // A later explicit manual request may proceed only after positive release.
            if (!operational() || setupPolicy !== policy) return
            setupPolicy = {}
            enabled = false
            if (request?.source === 'wake') request = undefined
            void schedule()
          }
          const opened = await adapters.openDetector(onWake, { isCurrent: () => wantsDetector(policy) }, onFault)
          if ('status' in opened) {
            if (opened.status !== 'unavailable' || opened.ownership !== 'not-acquired' || 'close' in opened) {
              throw new Error('Invalid detector ownership attestation')
            }
            onFault()
          } else {
            detector = { lease: validate(opened), policy }
          }
        } else {
          status = 'disabled'
          return
        }
      }
    } catch (cause) {
      // Even rejection from a superseded open can leave ownership ambiguous.
      failed = true
      failure = cause
      status = 'fault'
    } finally {
      running = undefined
    }
  }

  return {
    /** Effective opt-in, not a statement that a detector currently holds the lease. */
    get wakeEnabled() {
      return operational() && enabled
    },
    get status() {
      return status
    },
    get failure() {
      return failure
    },
    whenIdle: () => running ?? Promise.resolve(),
    enable() {
      if (operational()) enabled = true
      return schedule()
    },
    disable() {
      if (enabled) setupPolicy = {}
      enabled = false
      // An already-open conversation is not implicitly interrupted.
      if (request?.source === 'wake' && session?.policy !== request) request = undefined
      return schedule()
    },
    startManually() {
      if (operational()) {
        // Preserve an in-flight or completed session, but rescue a queued wake from disable.
        if (request) request.source = 'manual'
        else request = { source: 'manual' }
      }
      return schedule()
    },
    stop() {
      enabled = false
      setupPolicy = {}
      request = undefined
      return schedule()
    },
    shutdown() {
      disposed = true
      enabled = false
      setupPolicy = {}
      request = undefined
      return schedule()
    },
  }
}
