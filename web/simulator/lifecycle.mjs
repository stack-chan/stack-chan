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

/** Start both audio transitions and await every owner, even if one fails. */
export async function transitionRuntimeAudio(host, method) {
  const transitions = [host?.AudioIn, host?.AudioOut].map((bridge) => {
    try {
      return Promise.resolve(bridge?.[method]?.())
    } catch (error) {
      return Promise.reject(error)
    }
  })
  const results = await Promise.allSettled(transitions)
  const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason)
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, `Audio ${method} failed`)
}

/** Quitting XS does not cancel promises already handed to browser media APIs. */
export function stopRuntimeCamera(runtime) {
  if (runtime.state.cameraStart) runtime.state.cameraStart.active = false
  runtime.state.cameraCapture = undefined
  runtime.host?.Camera?.stop()
}
