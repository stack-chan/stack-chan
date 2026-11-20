// SDK System has no WASM host implementation. The browser restarts after XS returns.
let requested = false

export default Object.freeze({
  restart(): void {
    if (requested) return
    requested = true
    trace('[system] restart\n')
  },
})
