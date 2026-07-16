import Timer from 'timer'

const readHostButton = native('xs_stackchan_wasm_button_read')
const POLL_INTERVAL_MS = 16

class WasmButton {
  #index
  #lastValue

  onChanged = () => {}

  constructor(index) {
    this.#index = index
    this.#lastValue = this.read()
    Timer.repeat(() => {
      const value = this.read()
      if (value === this.#lastValue) return
      this.#lastValue = value
      this.onChanged()
    }, POLL_INTERVAL_MS)
  }

  read() {
    return readHostButton(this.#index)
  }
}

export function installWasmButtons() {
  // Match the normalized Moddable Button contract used by real targets:
  // read() is 1 while pressed and 0 while released. The native function
  // crosses the XS/WebAssembly boundary and reads the browser Host.Button
  // bridge. Installation is deferred until runtime because native functions
  // are unavailable while xsl evaluates preloadable module code.
  globalThis.button = {
    a: new WasmButton(0),
    b: new WasmButton(1),
    c: new WasmButton(2),
  }
}
