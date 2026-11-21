export const SAVE_LABEL = 'この端末にWiFiとMuse資格情報を保存'
export const CONNECT_LABEL = 'Museへ接続'

export function createSetupCoordinator({ onChange = () => {} } = {}) {
  let owner,
    generation,
    revision = 0,
    phase = 'empty',
    task,
    saved = false,
    closing
  function current(account, token) {
    try {
      return account.current(token) === true
    } catch {
      return false
    }
  }
  function snapshot() {
    return Object.freeze({
      phase,
      revision,
      provisionReady: phase === 'review',
      saved,
      actionLabel: phase === 'review' ? SAVE_LABEL : phase === 'saved' ? CONNECT_LABEL : undefined,
    })
  }
  function publish() {
    try {
      onChange(snapshot())
    } catch {}
  }
  function valid(expected, required) {
    if (phase === 'closed' || expected !== revision || phase !== required || !owner)
      throw new Error('approval_not_current')
    if (!current(owner, generation)) {
      phase = 'expired'
      ++revision
      publish()
      throw new Error('provision_expired')
    }
  }
  function run(expected, required, pending, completed, method, resultFlag) {
    valid(expected, required)
    const account = owner,
      token = generation
    phase = pending
    const active = () => expected === revision && owner === account && phase !== 'closed'
    const work = Promise.resolve()
      .then(() => {
        if (!active() || !current(account, token)) throw new Error('approval_not_current')
        return account[method](token)
      })
      .then((result) => {
        if (!active() || !current(account, token)) throw new Error('approval_not_current')
        if (result?.[resultFlag] !== true) throw new Error('operation_not_confirmed')
        if (completed === 'saved') saved = true
        phase = completed
        ++revision
        publish()
        return snapshot()
      })
      .catch(() => {
        if (active()) {
          phase = required
          publish()
        }
        throw new Error('setup_operation_failed')
      })
      .finally(() => {
        if (task === work) task = undefined
      })
    task = work
    publish()
    return work
  }
  return {
    snapshot,
    acceptProvision(account, token) {
      if (phase === 'closed' || task) throw new Error('setup_not_available')
      if (!account || !current(account, token)) throw new Error('provision_expired')
      if (owner === account && generation === token) return snapshot()
      try {
        owner?.close()
      } catch {
        throw new Error('setup_close_failed')
      }
      owner = account
      generation = token
      ++revision
      phase = 'review'
      saved = false
      publish()
      return snapshot()
    },
    acceptStored(account, token) {
      if (phase !== 'empty' || owner || task) throw new Error('setup_not_available')
      if (!account || !current(account, token)) throw new Error('provision_expired')
      owner = account
      generation = token
      ++revision
      phase = 'saved'
      saved = true
      publish()
      return snapshot()
    },
    approveSave(expectedRevision) {
      if (task && expectedRevision === revision && phase === 'saving') return task
      return run(expectedRevision, 'review', 'saving', 'saved', 'commitApproved', 'saved')
    },
    approveConnect(expectedRevision) {
      if (task && expectedRevision === revision && phase === 'connecting') return task
      return run(expectedRevision, 'saved', 'connecting', 'connected', 'connectApproved', 'connected')
    },
    connectionEnded() {
      if (phase !== 'connected') return snapshot()
      phase = 'saved'
      ++revision
      publish()
      return snapshot()
    },
    close() {
      if (phase === 'closed') return closing
      const account = owner
      owner = undefined
      generation = undefined
      ++revision
      phase = 'closed'
      task = undefined
      try {
        const result = account?.close()
        closing = Promise.resolve(result).catch(() => {
          throw new Error('setup_close_failed')
        })
        return closing
      } catch {
        throw new Error('setup_close_failed')
      } finally {
        publish()
      }
    },
  }
}
