/** Synchronous streaming decoder. Run in a Worker; input is produced by another Worker. */
export default function decodeScaledJPEG(input, state, pixels) {
  return native('xs_jpeg_scaled_decode').call(null, input, state, pixels)
}

/** Heap totals for device measurements; excludes simulator process memory. */
export function memoryUsage() {
  return native('xs_jpeg_memory_usage').call(null)
}

/** Native HTTP/TLS producer for the shared ring. Returns a redirect or completed transfer metrics. */
export function downloadArtwork(url, input, state) {
  return native('xs_jpeg_download').call(null, url, input, state)
}

/** Stop automatic instrument sampling before a disposable native Worker starts. */
export function prepareWorker() {
  return native('xs_jpeg_prepare_worker').call(null)
}
