import { AppController } from 'app-controller'
import { ChatStatusBar } from 'chat-status-bar'
import Instrumentation from 'instrumentation'
import {
  Application,
  Container,
  type Content as PiuContent,
  Port,
  type Port as PiuPort,
  Skin,
} from 'piu/MC'
import Timer from 'timer'

const DEPTHS = Object.freeze([0, 4, 8, 16] as const)
const SAMPLE_MS = 5000
const WARMUP_MS = 500
const background = new Skin({ fill: '#101214' })

const instrumentation = Object.freeze({
  frames: Instrumentation.map('Frames Drawn'),
  pixels: Instrumentation.map('Pixels Drawn'),
  commands: Instrumentation.map('Piu Command List Used'),
  slots: Instrumentation.map('XS Slot Heap Used'),
  chunks: Instrumentation.map('XS Chunk Heap Used'),
})

function readInstrument(index: number | undefined): number {
  return Instrumentation.get(index) ?? 0
}

class AnimatedPortBehavior extends Behavior {
  x = 20
  direction = 1

  onDisplaying(port: PiuPort): void {
    port.interval = 16
    port.start()
  }

  onUndisplaying(port: PiuPort): void {
    port.stop()
  }

  onTimeChanged(port: PiuPort): void {
    this.x += this.direction * 3
    if (this.x <= 20 || this.x >= port.width - 20) this.direction *= -1
    port.invalidate()
  }

  onDraw(port: PiuPort): void {
    port.fillColor('#101214', 0, 0, port.width, port.height)
    port.fillColor('#42bde8', this.x - 16, Math.floor(port.height / 2) - 16, 32, 32)
  }
}

function createLayeredContent(depth: number): Container {
  let content: PiuContent = new Port(null, {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    Behavior: AnimatedPortBehavior,
  })
  for (let index = 0; index < depth; index += 1) {
    content = new Container(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      clip: true,
      contents: [content],
    })
  }
  return new Container(null, {
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    skin: background,
    contents: [content],
  })
}

const application = new Application(
  {
    face: new Container(null, { left: 60, top: 60, width: 200, height: 120, skin: background }),
    appBar: new ChatStatusBar(),
  },
  { displayListLength: 4096, contents: [], Behavior: AppController },
)
const controller = application.behavior as AppController

for (const depth of DEPTHS) {
  controller.miniApps.register({
    id: `benchmark.depth-${depth}`,
    title: `Depth ${depth}`,
    create: () => createLayeredContent(depth),
  })
}

let caseIndex = 0

function runCase(): void {
  const depth = DEPTHS[caseIndex]
  controller.launchMiniApp(`benchmark.depth-${depth}`)
  Timer.set(() => {
    const startedAt = Date.now()
    const startFrames = readInstrument(instrumentation.frames)
    const startPixels = readInstrument(instrumentation.pixels)
    Timer.set(() => {
      const elapsedMs = Math.max(1, Date.now() - startedAt)
      const frames = readInstrument(instrumentation.frames) - startFrames
      const pixels = readInstrument(instrumentation.pixels) - startPixels
      trace(
        `[mini-app-benchmark] ${JSON.stringify({
          depth,
          elapsedMs,
          frames,
          framesPerSecond: (frames * 1000) / elapsedMs,
          pixels,
          commandListUsed: readInstrument(instrumentation.commands),
          slotHeapUsed: readInstrument(instrumentation.slots),
          chunkHeapUsed: readInstrument(instrumentation.chunks),
        })}\n`,
      )
      caseIndex = (caseIndex + 1) % DEPTHS.length
      runCase()
    }, SAMPLE_MS)
  }, WARMUP_MS)
}

runCase()
