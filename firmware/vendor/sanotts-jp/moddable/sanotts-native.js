class NativeSanoTTS @ "xs_sano_destructor" {
  constructor() @ "xs_sano_constructor"
  start(kana) @ "xs_sano_start"
  read(buffer) @ "xs_sano_read"
  get available() @ "xs_sano_available"
  get done() @ "xs_sano_done"
  stop() @ "xs_sano_stop"
  close() @ "xs_sano_close"
}
Object.freeze(NativeSanoTTS.prototype)
export default NativeSanoTTS
