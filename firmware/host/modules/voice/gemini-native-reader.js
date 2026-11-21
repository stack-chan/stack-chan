class NativeReader @ "xs_gemini_native_reader_destructor" {
  constructor(endpoint, apiKey, body, timeoutMs) @ "xs_gemini_native_reader_constructor";
  read(buffer) @ "xs_gemini_native_reader_read";
  diagnostic() @ "xs_gemini_native_reader_diagnostic";
  transportDiagnostic() @ "xs_gemini_native_reader_transport_diagnostic";
  close() @ "xs_gemini_native_reader_close";
}
export default NativeReader
