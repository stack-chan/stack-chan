import {openStreamingOutput as openOutput} from 'stackchan/voice/cores3-pcm-output'
import {createSpeechEvents} from 'gemini-worker-events'
import Time from 'time'
import Timer from 'timer'

const wait = ms => new Promise(resolve => Timer.set(resolve, Math.max(1, ms)))
const event = value => new Uint8Array(ArrayBuffer.fromString('data: '+JSON.stringify(value)+'\n\n'))
async function replay(rate, stressed) {
  trace('MUSE_RATE_OUTPUT_OPEN ' + [rate, Number(stressed)].join(' ') + '\n')
  const output = openOutput(rate, 0, 17920, () => {}, 3)
  try {
  trace('MUSE_RATE_OUTPUT_READY\n')
  const pcm = new Uint8Array(rate * 80 * 2 / 1000)
  const frame = event({event_type:'step.delta',delta:{type:'audio',mime_type:'audio/l16;rate='+rate+';channels=1',data:pcm.toBase64()}})
  const terminal = event({event_type:'interaction.completed',interaction:{status:'completed'}})
  let firstQueue=-1, maxFeedMs=0, totalFeedMs=0, writeStart=0, maxQueueMs=0
  const parser = createSpeechEvents({sampleRate:rate,onPcm:async bytes=>{
    await output.write(bytes)
    if (firstQueue<0) firstQueue=Time.ticks
    maxQueueMs=Math.max(maxQueueMs,Time.ticks-writeStart)
  }})
  const started=Time.ticks
  trace('MUSE_RATE_BEGIN '+[rate,Number(stressed)].join(' ')+'\n')
    for(let i=0;i<80;i++){
      const due=i*80+(stressed&&i>=20&&i<26?440:0)
      const delay=due-(Time.ticks-started)
      if (delay>0) await wait(delay)
      writeStart=Time.ticks
      for(let j=0;j<frame.length;j+=1024) await parser.feed(frame.subarray(j,j+1024))
      const elapsed=Time.ticks-writeStart
      maxFeedMs=Math.max(maxFeedMs,elapsed)
      totalFeedMs+=elapsed
    }
    await parser.feed(terminal)
    await parser.finish()
    await output.drain()
    trace('MUSE_RATE_END '+[rate,Number(stressed),firstQueue-started,maxQueueMs,maxFeedMs,totalFeedMs,parser.metrics.pcmBytes].join(' ')+'\n')
  } finally { output.close() }
}
let armed = false

export function arm({ active, onDone }) {
  if (armed) return false
  armed = true
  trace('MUSE_RATE_ARMED\n')
  Timer.set(() => {
    if (!active()) {
      trace('MUSE_RATE_SKIPPED\n')
      return
    }
    trace('MUSE_RATE_START\n')
    void (async () => {
      for (const stress of [false, true]) for (const rate of [24000, 16000]) {
        if (!active()) throw Object.assign(new Error(), { code: 'fixture_interrupted' })
        await replay(rate, stress)
        await wait(500)
      }
      trace('MUSE_RATE_DONE\n')
      onDone?.()
    })().catch(() => trace('MUSE_RATE_FAILED\n'))
  }, 1500)
  return true
}
