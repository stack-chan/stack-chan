import { DogFace, SimpleFace } from 'behaviors/face'
import { Emoticon } from 'effects/emoticon'
import { MusicNotes } from 'effects/music-notes'
import { createEmotionWeights, Emotion, type EmotionWeights, type FaceState, writeEmotionTransition } from 'face-state'
import Instrumentation from 'instrumentation'
import type { FaceMotion } from 'motions/types'
import { Application, Container, type Content as PiuContent, Skin } from 'piu/MC'
import Timer from 'timer'

const TICK_MS = 33
const WARMUP_MS = 2000
const SAMPLE_MS = 1000
const SAMPLES_PER_SCENARIO = 30
const MISSED_TICK_THRESHOLD_MS = 50
const LOG_PREFIX = '[face-rendering-benchmark] '

const background = new Skin({ fill: '#000000' })

const instrumentation = Object.freeze({
  cpu0: Instrumentation.map('CPU 0'),
  cpu1: Instrumentation.map('CPU 1'),
  frames: Instrumentation.map('Frames Drawn'),
  pixels: Instrumentation.map('Pixels Drawn'),
  pocoDisplayList: Instrumentation.map('Poco Display List Used'),
  piuCommandList: Instrumentation.map('Piu Command List Used'),
  slots: Instrumentation.map('XS Slot Heap Used'),
  chunks: Instrumentation.map('XS Chunk Heap Used'),
  freeMemory: Instrumentation.map('System Free Memory'),
  garbageCollections: Instrumentation.map('XS Garbage Collection Count'),
})

function takeInstrumentationControl(this: unknown): void {
  native('xs_face_rendering_benchmark_take_instrumentation_control').call(this)
}

// The platform instrumentation reporter otherwise consumes and resets CPU and
// frame counters every second. This benchmark samples those counters directly.
takeInstrumentationControl()

type TickTracker = {
  lastTickMs: number
  maxGapMs: number
  missedTicks: number
}

type Scenario = {
  name: string
  create: (tracker: TickTracker) => PiuContent
}

type SampleBuffers = {
  cpu0: Uint32Array
  cpu1: Uint32Array
  frames: Uint32Array
  pixels: Uint32Array
  pocoDisplayListUsed: Uint32Array
  piuCommandListUsed: Uint32Array
  slotHeapUsed: Uint32Array
  chunkHeapUsed: Uint32Array
  systemFreeMemory: Uint32Array
  garbageCollections: Uint32Array
  maxTickGapMs: Uint32Array
  missedTicks: Uint32Array
}

function createSampleBuffers(): SampleBuffers {
  return {
    cpu0: new Uint32Array(SAMPLES_PER_SCENARIO),
    cpu1: new Uint32Array(SAMPLES_PER_SCENARIO),
    frames: new Uint32Array(SAMPLES_PER_SCENARIO),
    pixels: new Uint32Array(SAMPLES_PER_SCENARIO),
    pocoDisplayListUsed: new Uint32Array(SAMPLES_PER_SCENARIO),
    piuCommandListUsed: new Uint32Array(SAMPLES_PER_SCENARIO),
    slotHeapUsed: new Uint32Array(SAMPLES_PER_SCENARIO),
    chunkHeapUsed: new Uint32Array(SAMPLES_PER_SCENARIO),
    systemFreeMemory: new Uint32Array(SAMPLES_PER_SCENARIO),
    garbageCollections: new Uint32Array(SAMPLES_PER_SCENARIO),
    maxTickGapMs: new Uint32Array(SAMPLES_PER_SCENARIO),
    missedTicks: new Uint32Array(SAMPLES_PER_SCENARIO),
  }
}

function readInstrument(index: number | undefined): number {
  if (index === undefined) return 0
  return Instrumentation.get(index) ?? 0
}

function traceRecord(record: object): void {
  trace(`${LOG_PREFIX}${JSON.stringify(record)}\n`)
}

function resetTickWindow(tracker: TickTracker): void {
  tracker.lastTickMs = Date.now()
  tracker.maxGapMs = 0
  tracker.missedTicks = 0
}

function recordTick(tracker: TickTracker): void {
  const now = Date.now()
  if (tracker.lastTickMs !== 0) {
    const gapMs = now - tracker.lastTickMs
    if (gapMs > tracker.maxGapMs) tracker.maxGapMs = gapMs
    if (gapMs > MISSED_TICK_THRESHOLD_MS) {
      tracker.missedTicks += Math.max(1, Math.round(gapMs / TICK_MS) - 1)
    }
  }
  tracker.lastTickMs = now
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value)
}

function blinkOpen(elapsedMs: number): number {
  const phase = (elapsedMs % 800) / 800
  const distance = Math.abs(phase * 2 - 1)
  return 0.08 + distance * distance * 0.92
}

function mouthOpen(elapsedMs: number): number {
  const phase = (elapsedMs % 1200) / 1200
  return 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI)
}

function createTrackedMotion(
  tracker: TickTracker,
  update?: (elapsedMs: number, face: FaceState) => void,
): FaceMotion {
  let elapsedMs = 0
  return (tickMs, face) => {
    recordTick(tracker)
    elapsedMs += tickMs
    update?.(elapsedMs, face)
  }
}

function setBlink(elapsedMs: number, face: FaceState): void {
  const open = blinkOpen(elapsedMs)
  face.eyes.left.open = open
  face.eyes.right.open = open
}

function setBlinkAndMouth(elapsedMs: number, face: FaceState): void {
  setBlink(elapsedMs, face)
  face.mouth.open = mouthOpen(elapsedMs)
}

const angryWeights: Readonly<EmotionWeights> = Object.freeze(
  createEmotionWeights(Emotion.ANGRY),
)
const sadWeights: Readonly<EmotionWeights> = Object.freeze(
  createEmotionWeights(Emotion.SAD),
)

function setEmotionBlend(elapsedMs: number, face: FaceState): void {
  const cycleMs = elapsedMs % 2000
  const firstHalf = cycleMs < 1000
  const progress = smoothstep((cycleMs % 1000) / 1000)
  const target = firstHalf ? Emotion.SAD : Emotion.ANGRY
  face.emotion = target
  writeEmotionTransition(
    face,
    firstHalf ? angryWeights : sadWeights,
    target,
    progress,
  )
}

function createRoot(face: PiuContent, effects: PiuContent[] = []): PiuContent {
  return new Container(null, {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    skin: background,
    contents: [face, ...effects],
  })
}

const scenarios: readonly Scenario[] = Object.freeze([
  {
    name: 'idle',
    create: (tracker) =>
      createRoot(
        new SimpleFace({
          motions: [createTrackedMotion(tracker)],
          intervalMs: TICK_MS,
        }),
      ),
  },
  {
    name: 'continuous-blink',
    create: (tracker) =>
      createRoot(
        new SimpleFace({
          motions: [createTrackedMotion(tracker, setBlink)],
          intervalMs: TICK_MS,
        }),
      ),
  },
  {
    name: 'blink-mouth',
    create: (tracker) =>
      createRoot(
        new SimpleFace({
          motions: [createTrackedMotion(tracker, setBlinkAndMouth)],
          intervalMs: TICK_MS,
        }),
      ),
  },
  {
    name: 'emotion-blend',
    create: (tracker) =>
      createRoot(
        new SimpleFace({
          motions: [createTrackedMotion(tracker, setEmotionBlend)],
          intervalMs: TICK_MS,
        }),
      ),
  },
  {
    name: 'dog-blink-mouth',
    create: (tracker) =>
      createRoot(
        new DogFace({
          motions: [createTrackedMotion(tracker, setBlinkAndMouth)],
          intervalMs: TICK_MS,
        }),
      ),
  },
  {
    name: 'effects',
    create: (tracker) =>
      createRoot(
        new SimpleFace({
          motions: [createTrackedMotion(tracker)],
          intervalMs: TICK_MS,
        }),
        [new Emoticon({ key: 'tear', top: 95 }), new MusicNotes({})],
      ),
  },
])

const application = new Application(null, {
  displayListLength: 8192,
  skin: background,
  contents: [],
})

const tracker: TickTracker = {
  lastTickMs: 0,
  maxGapMs: 0,
  missedTicks: 0,
}
const samples = createSampleBuffers()

let scenarioIndex = 0
let sampleIndex = 0
let sampleTimer: Timer | undefined
let framesAtWindowStart = 0
let pixelsAtWindowStart = 0
let garbageCollectionsAtWindowStart = 0

function resetInstrumentWindow(): void {
  // CPU getters reset their own sampling windows.
  readInstrument(instrumentation.cpu0)
  readInstrument(instrumentation.cpu1)
  framesAtWindowStart = readInstrument(instrumentation.frames)
  pixelsAtWindowStart = readInstrument(instrumentation.pixels)
  garbageCollectionsAtWindowStart = readInstrument(
    instrumentation.garbageCollections,
  )
}

function counterDelta(current: number, previous: number): number {
  return Math.max(0, current - previous)
}

function startScenario(): void {
  const scenario = scenarios[scenarioIndex]
  sampleIndex = 0
  tracker.lastTickMs = 0
  tracker.maxGapMs = 0
  tracker.missedTicks = 0
  application.empty()
  application.add(scenario.create(tracker))
  traceRecord({
    type: 'scenario',
    scenario: scenario.name,
    warmupMs: WARMUP_MS,
    sampleMs: SAMPLE_MS,
    samples: SAMPLES_PER_SCENARIO,
    tickMs: TICK_MS,
  })
  Timer.set(() => {
    resetTickWindow(tracker)
    resetInstrumentWindow()
    sampleTimer = Timer.repeat(sampleScenario, SAMPLE_MS)
  }, WARMUP_MS)
}

function sampleScenario(): void {
  const scenario = scenarios[scenarioIndex]
  const frames = readInstrument(instrumentation.frames)
  const pixels = readInstrument(instrumentation.pixels)
  const garbageCollections = readInstrument(instrumentation.garbageCollections)
  samples.cpu0[sampleIndex] = readInstrument(instrumentation.cpu0)
  samples.cpu1[sampleIndex] = readInstrument(instrumentation.cpu1)
  samples.frames[sampleIndex] = counterDelta(frames, framesAtWindowStart)
  samples.pixels[sampleIndex] = counterDelta(pixels, pixelsAtWindowStart)
  samples.pocoDisplayListUsed[sampleIndex] = readInstrument(
    instrumentation.pocoDisplayList,
  )
  samples.piuCommandListUsed[sampleIndex] = readInstrument(
    instrumentation.piuCommandList,
  )
  samples.slotHeapUsed[sampleIndex] = readInstrument(instrumentation.slots)
  samples.chunkHeapUsed[sampleIndex] = readInstrument(instrumentation.chunks)
  samples.systemFreeMemory[sampleIndex] = readInstrument(
    instrumentation.freeMemory,
  )
  samples.garbageCollections[sampleIndex] = counterDelta(
    garbageCollections,
    garbageCollectionsAtWindowStart,
  )
  samples.maxTickGapMs[sampleIndex] = tracker.maxGapMs
  samples.missedTicks[sampleIndex] = tracker.missedTicks
  framesAtWindowStart = frames
  pixelsAtWindowStart = pixels
  garbageCollectionsAtWindowStart = garbageCollections
  sampleIndex += 1
  resetTickWindow(tracker)
  if (sampleIndex < SAMPLES_PER_SCENARIO) return

  Timer.clear(sampleTimer)
  sampleTimer = undefined
  application.empty()
  for (let index = 0; index < SAMPLES_PER_SCENARIO; index += 1) {
    traceRecord({
      type: 'sample',
      scenario: scenario.name,
      sample: index + 1,
      cpu0: samples.cpu0[index],
      cpu1: samples.cpu1[index],
      frames: samples.frames[index],
      pixels: samples.pixels[index],
      pocoDisplayListUsed: samples.pocoDisplayListUsed[index],
      piuCommandListUsed: samples.piuCommandListUsed[index],
      slotHeapUsed: samples.slotHeapUsed[index],
      chunkHeapUsed: samples.chunkHeapUsed[index],
      systemFreeMemory: samples.systemFreeMemory[index],
      garbageCollections: samples.garbageCollections[index],
      maxTickGapMs: samples.maxTickGapMs[index],
      missedTicks: samples.missedTicks[index],
    })
  }
  scenarioIndex = (scenarioIndex + 1) % scenarios.length
  Timer.set(startScenario, SAMPLE_MS)
}

traceRecord({
  type: 'run',
  scenarios: scenarios.length,
  samplesPerScenario: SAMPLES_PER_SCENARIO,
})
startScenario()
