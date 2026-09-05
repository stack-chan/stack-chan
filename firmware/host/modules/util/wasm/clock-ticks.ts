// Moddable 9.5's WASM Time.ticks is unimplemented. Use the browser's elapsed clock.
declare function native(name: 'xs_stackchan_clock_ticks'): () => number

export default function clockTicks(): number {
  return native('xs_stackchan_clock_ticks')()
}
