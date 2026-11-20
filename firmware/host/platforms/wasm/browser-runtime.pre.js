// biome-ignore lint/complexity/useLiteralKeys: Emscripten module option names must survive minification.
const stackchanRuntime = Module['stackchanRuntime']

if (!stackchanRuntime) {
  throw new Error('stackchanRuntime is required')
}

stackchanRuntime.state ??= {}

// biome-ignore lint/correctness/noUnusedVariables: Moddable's generated display glue calls this binding.
const gxView = {
  onBufferChanged(...args) {
    return stackchanRuntime.view?.onBufferChanged(...args)
  },
  onFormatChanged(...args) {
    return stackchanRuntime.view?.onFormatChanged(...args)
  },
  onStart(...args) {
    return stackchanRuntime.view?.onStart(...args)
  },
  onStop(...args) {
    return stackchanRuntime.view?.onStop(...args)
  },
}
