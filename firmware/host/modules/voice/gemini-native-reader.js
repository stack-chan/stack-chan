const open = native('xs_gemini_native_reader_constructor')
const read = native('xs_gemini_native_reader_read')
const diagnostic = native('xs_gemini_native_reader_diagnostic')
const transportDiagnostic = native('xs_gemini_native_reader_transport_diagnostic')
const close = native('xs_gemini_native_reader_close')

export default class NativeReader extends Native('xs_gemini_native_reader_destructor') {
  constructor(endpoint, apiKey, body, timeoutMs) {
    super()
    open.call(this, endpoint, apiKey, body, timeoutMs)
  }
  read(buffer) {
    return read.call(this, buffer)
  }
  diagnostic() {
    return diagnostic.call(this)
  }
  transportDiagnostic() {
    return transportDiagnostic.call(this)
  }
  close() {
    close.call(this)
  }
}
