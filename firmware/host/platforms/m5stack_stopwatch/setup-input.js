function createButton(Button) {
  const button = new Button()
  let onChanged
  const adapter = {
    read: () => button.pressed,
    get onChanged() {
      return onChanged
    },
    set onChanged(callback) {
      onChanged = callback
      button.onChanged = () => onChanged?.call(adapter)
    },
  }
  return adapter
}

export default function setupInput(done) {
  const { peripheral } = globalThis.device
  globalThis.button = {
    a: createButton(peripheral.button.A),
    b: createButton(peripheral.button.B),
  }
  done?.()
}
