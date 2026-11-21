import Modules from 'modules'

trace('MUSE_HOST boot\n')
try {
  Modules.importNow('muse-host-main')
} catch (error) {
  const name = ['Error', 'ReferenceError', 'TypeError', 'SyntaxError', 'RangeError'].includes(error?.name)
    ? error.name
    : 'Error'
  trace(`MUSE_HOST init_failed ${name}\n`)
  for (const id of [
    'guruguru-muse-mod',
    'piu/MC',
    'preference',
    'stackchan/voice/device',
    'embedded:network/interface/wifi',
  ]) {
    trace(`MUSE_HOST module_present ${id} ${Modules.has(id)}\n`)
  }
}
