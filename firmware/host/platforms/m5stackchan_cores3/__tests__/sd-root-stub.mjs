export default function openSDRoot() {
  const state = globalThis.sdTest
  state.mounts += 1
  if (state.mounts === 1) throw new Error('no SD card')
  return state.files
}
