/** Attempt each owned cleanup, preserving the first failure for the caller. */
export function closeResources(cleanups) {
  let failed = false
  let failure
  for (const close of cleanups) {
    try {
      close()
    } catch (error) {
      if (!failed) failure = error
      failed = true
    }
  }
  if (failed) throw failure
}

/** Quitting XS does not cancel promises already handed to browser media APIs. */
export function stopRuntimeCamera(runtime) {
  if (runtime.state.cameraStart) runtime.state.cameraStart.active = false
  runtime.state.cameraCapture = undefined
  runtime.host?.Camera?.stop()
}
