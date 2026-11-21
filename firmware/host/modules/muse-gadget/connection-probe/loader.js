import Modules from 'modules'

trace('MUSE_PROBE loader\n')
try {
  Modules.importNow('muse-note-probe-main')
} catch (error) {
  const name = ['Error', 'ReferenceError', 'TypeError', 'SyntaxError', 'RangeError'].includes(error?.constructor?.name)
    ? error.constructor.name
    : 'unknown'
  trace(`MUSE_PROBE import_${name}\n`)
  const description = String(error)
  for (const id of [
    'chat-turn',
    'muse-note',
    'muse-chat',
    'AbortController',
    'muse-account',
    'muse-audio',
    'conversation-runtime',
  ]) {
    if (description.includes(id)) trace(`MUSE_PROBE missing_${id}\n`)
  }
}
