// Integration fixture for the private XS/C/browser boundary, not a public SDK lesson.
import Microphone from 'microphone'
import Speaker from 'speaker'
import Timer from 'timer'

const report = (message) => trace(`[recording-test] ${message}\n`)
export function onLaunch() {
  return true
}
export async function onContextCreated(robot) {
  const microphone = new Microphone()
  const speaker = new Speaker()
  for (let cycle = 0; cycle < 3; cycle++) {
    const buffer = await microphone.record(300)
    let sum = 0
    for (const byte of new Uint8Array(buffer)) sum = (sum + byte) >>> 0
    report(
      `recorded ${JSON.stringify({ bytes: buffer.byteLength, sum, mimeType: buffer.mimeType, filename: buffer.filename })}`,
    )
    if (!(await speaker.play(buffer))) throw new Error('Recorded audio did not play')
  }
  const cancelled = microphone.record(15_000).then(
    () => {
      throw new Error('Cancelled recording succeeded')
    },
    (error) => {
      if (error.code !== 'CANCELLED') throw error
    },
  )
  Timer.set(() => {
    Promise.resolve(microphone.stop()).catch((error) => report(`FAIL ${error}`))
  }, 100)
  await cancelled
  report('cancelled')
  report('microphone close begin')
  await microphone.close()
  await new Microphone().close()
  report('microphone close end')
  robot.input.button.a.onEvent = (event) => {
    if (!event.pressed) return
    const input = new Microphone()
    input.record(15_000).then(
      () => report('long recording completed'),
      (error) => report(`long recording ${error.code}`),
    )
    report('long recording started')
  }
  report('ready')
}
