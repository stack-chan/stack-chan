import AudioIO from 'stackchanXiaozhiAudioIOBase'
import StackAudioIO from 'StackChanChatAudioIO'
import AudioIn from 'embedded:io/audio/in'
import AudioOut from 'embedded:io/audio/out'
import Worker from 'worker'
import { equal } from 'testing/assert'
import Timer from 'timer'

async function run() {
  for (const turnControl of ['fullDuplex', 'invalid']) {
    let rejected = false
    try {
      new AudioIO({ turnControl })
    } catch {
      rejected = true
    }
    equal(rejected, true, 'unsupported mode rejected')
  }
  equal(Worker.instances.length, 0, 'rejection creates no worker')
  equal(AudioIn.instances.length, 0, 'rejection creates no input')

  const transitions = []
  const levels = []
  const calls = []
  const audio = new StackAudioIO({
    specifier: 'xiaozhiV1',
    turnControl: 'downlink',
    onOutputTurnStarted: (turn) => transitions.push(`start:${turn.id}`),
    onOutputTurnEnded: (turn) => transitions.push(`end:${turn.id}`),
    onOutputLevelChanged: (level) => levels.push(level),
    onFunctionCall: (call) => calls.push(call),
  })
  equal(audio.inputBuffer, undefined, 'downlink has no input PCM buffer')
  equal(audio.worker !== undefined, true, 'production factory installs a Worker')
  equal(Worker.instances[0].messages[0].pcmRing, undefined, 'production worker has no capture ring')
  equal(Worker.instances[0].messages[0].turnControl, 'downlink', 'worker receives turnControl')
  equal(AudioIn.instances.length, 0, 'downlink never opens AudioIn')
  audio.connect()
  audio.connected()
  equal(audio.state, AudioIO.CONNECTED, 'downlink waits without starting a microphone turn')
  new Int16Array(audio.outputBuffer, 0, 960).fill(1000)
  audio.listen({ turnId: 1 })
  audio.receiveAudio({ offset: 0, size: 960 })
  audio.speak({ turnId: 1, endByte: 960 })
  audio.listen({ turnId: 2 })
  audio.receiveFunctionCall({ turnId: 2, call: 'second-turn-tool', name: 'pose', parameters: {} })
  audio.receiveAudio({ offset: 960, size: 960 })
  audio.speak({ turnId: 2, endByte: 1920 })
  equal(levels.length, 0, 'receiving frames does not publish future mouth levels')
  const output = AudioOut.instances[0]
  output.tick(1920)
  equal(audio.playedBytes, 960, 'one write cannot cross a pending turn boundary')
  equal(transitions.join(','), 'start:1', 'first turn has not drained at submission')
  equal(calls.length, 0, 'future turn tools do not run over the current turn')
  output.tick()
  equal(transitions.join(','), 'start:1,end:1,start:2', 'queued turns start after the preceding drain')
  equal(calls.join(','), 'second-turn-tool', 'tools are dispatched after their own turn starts')
  output.tick()
  output.tick()
  equal(transitions.join(','), 'start:1,end:1,start:2,end:2', 'turn ends preserve FIFO identity')
  equal(audio.state, AudioIO.CONNECTED, 'downlink stays connected after playback')
  equal(AudioIn.instances.length, 0, 'drain never creates an input')
  audio.close()

  let release
  let staleContext
  const delayed = new AudioIO({
    turnControl: 'downlink',
    onOutputTurnStarted: (turn) => {
      staleContext = turn
      return new Promise((resolve) => {
        release = resolve
      })
    },
  })
  delayed.connect()
  delayed.connected()
  delayed.listen({ turnId: 1 })
  const outputCount = AudioOut.instances.length
  delayed.close()
  release()
  await Promise.resolve()
  equal(staleContext.isCurrent(), false, 'close invalidates an unfinished start hook')
  equal(AudioOut.instances.length, outputCount, 'late start completion cannot reopen AudioOut')
  equal(Atomics.load(delayed.barrier, 0), -1, 'close wakes the producer with a cancellation sentinel')

  const legacy = new AudioIO({})
  equal(AudioIn.instances.length, 1, 'halfDuplex remains the default')
  legacy.close()
  trace('ok\n')
  Timer.set(() => {}, 1000)
}
run().catch((error) => {
  trace(`FAIL: ${error}\n`)
  throw error
})
