import type { MiniAppDefinition } from 'capabilities'
import 'piu/MC'
import type { Port as PiuPort, Texture as PiuTexture } from 'piu/MC'

export type PlayerPosition = 0 | 1 | 2
export type DropLane = 0 | 1 | 2
export type DropStep = 0 | 1 | 2 | 3 | 4
export type DropKind = 'screw' | 'm5stack' | 'bubble' | 'bomb'
export type DropSpeed = 'fast' | 'steady' | 'slow'
export type GamePhase = 'title' | 'playing' | 'gameover'

export interface Drop {
  lane: DropLane
  step: DropStep
  kind: DropKind
  active: boolean
  speed: DropSpeed
  ticksUntilAdvance: number
  landingTick: number
}

export interface GameState {
  phase: GamePhase
  player: PlayerPosition
  drops: Drop[]
  score: number
  misses: number
  tickInterval: number
  ticks: number
  spawnIndex: number
  lastLandingTick: number
}

const INITIAL_TICK_INTERVAL_MS = 600
const MIN_TICK_INTERVAL_MS = 250
const SPEED_UP_EVERY_SCORE = 5
const SPEED_UP_STEP_MS = 50
const MIN_LANDING_GAP_TICKS = 3

const PLAYER_SIZE = 48
const ITEM_SIZE = 24
const MISS_SIZE = 12
const PLAYER_Y = 125
const CONTROL_Y = 178
const LANE_CENTERS = Object.freeze([52, 160, 268] as const)
const DROP_Y = Object.freeze([31, 50, 69, 88, 107] as const)

interface DropSpec {
  lane: DropLane
  kind: DropKind
  speed: DropSpeed
}

const STEP_DELAYS: Readonly<Record<DropSpeed, readonly number[]>> = Object.freeze({
  fast: Object.freeze([1, 1, 1, 1, 1]),
  steady: Object.freeze([1, 1, 2, 1, 1]),
  slow: Object.freeze([2, 2, 2, 2, 1]),
})

const DROP_SEQUENCE: readonly DropSpec[] = Object.freeze([
  { lane: 0, kind: 'screw', speed: 'slow' },
  { lane: 1, kind: 'bubble', speed: 'fast' },
  { lane: 2, kind: 'bomb', speed: 'steady' },
  { lane: 0, kind: 'm5stack', speed: 'fast' },
  { lane: 1, kind: 'screw', speed: 'steady' },
  { lane: 2, kind: 'bomb', speed: 'fast' },
  { lane: 0, kind: 'bubble', speed: 'steady' },
  { lane: 2, kind: 'm5stack', speed: 'fast' },
  { lane: 1, kind: 'bomb', speed: 'steady' },
  { lane: 0, kind: 'screw', speed: 'fast' },
  { lane: 2, kind: 'bubble', speed: 'steady' },
  { lane: 1, kind: 'm5stack', speed: 'fast' },
])

const COLOR_BACKGROUND = '#d8deb7'
const COLOR_GHOST = '#b7be99'
const COLOR_INK = '#343a31'

const PLAYER_TEXTURE_NAMES = Object.freeze(['player-left.png', 'player-center.png', 'player-right.png'] as const)
const ITEM_TEXTURE_NAMES = Object.freeze({
  bomb: 'bomb.png',
  bubble: 'bubble.png',
  m5stack: 'm5stack.png',
  screw: 'screw.png',
})
type MoveDirection = -1 | 1

const background = new Skin({ fill: COLOR_BACKGROUND })
const hudStyle = new Style({ font: 'k8x12-12', horizontal: 'left', vertical: 'middle' })
const panelStyle = new Style({ font: 'k8x12-24', horizontal: 'center', vertical: 'middle' })
const panelHintStyle = new Style({ font: 'k8x12-12', horizontal: 'center', vertical: 'middle' })
const controlStyle = new Style({ font: 'k8x12-12', horizontal: 'center', vertical: 'middle' })
const playerTextures: Array<PiuTexture | undefined> = [undefined, undefined, undefined]
const itemTextures: Partial<Record<DropKind, PiuTexture>> = {}
let missTexture: PiuTexture | undefined

function inactiveDrop(): Drop {
  return {
    lane: 1,
    step: 0,
    kind: 'screw',
    active: false,
    speed: 'fast',
    ticksUntilAdvance: 1,
    landingTick: 0,
  }
}

function fallDuration(speed: DropSpeed): number {
  return STEP_DELAYS[speed].reduce((total, delay) => total + delay, 0)
}

function canSpawnDrop(state: GameState, spec: DropSpec): boolean {
  const landingTick = state.ticks + fallDuration(spec.speed)
  if (landingTick - state.lastLandingTick < MIN_LANDING_GAP_TICKS) return false
  for (const drop of state.drops) {
    if (!drop.active) continue
    if (Math.abs(drop.landingTick - landingTick) < MIN_LANDING_GAP_TICKS) return false
  }
  return true
}

function spawnNextDrop(state: GameState, force = false): boolean {
  if (state.drops.every((drop) => drop.active)) return false
  const spec = DROP_SEQUENCE[state.spawnIndex % DROP_SEQUENCE.length]
  if (!force && !canSpawnDrop(state, spec)) return false
  const index = state.drops[0].active ? 1 : 0
  const delays = STEP_DELAYS[spec.speed]
  state.drops[index] = {
    lane: spec.lane,
    step: 0,
    kind: spec.kind,
    active: true,
    speed: spec.speed,
    ticksUntilAdvance: delays[0],
    landingTick: state.ticks + fallDuration(spec.speed),
  }
  state.spawnIndex += 1
  return true
}

export function createGameState(): GameState {
  return {
    phase: 'title',
    player: 1,
    drops: [inactiveDrop(), inactiveDrop()],
    score: 0,
    misses: 0,
    tickInterval: INITIAL_TICK_INTERVAL_MS,
    ticks: 0,
    spawnIndex: 0,
    lastLandingTick: -MIN_LANDING_GAP_TICKS,
  }
}

export function startGame(state: GameState): void {
  state.phase = 'playing'
  state.player = 1
  state.drops = [inactiveDrop(), inactiveDrop()]
  state.score = 0
  state.misses = 0
  state.tickInterval = INITIAL_TICK_INTERVAL_MS
  state.ticks = 0
  state.spawnIndex = 0
  state.lastLandingTick = -MIN_LANDING_GAP_TICKS
  spawnNextDrop(state, true)
}

export function movePlayer(state: GameState, direction: MoveDirection): void {
  const next = state.player + direction
  state.player = Math.max(0, Math.min(2, next)) as PlayerPosition
}

function advanceDrops(state: GameState): readonly boolean[] {
  const landed = [false, false]
  for (let index = 0; index < state.drops.length; index += 1) {
    const drop = state.drops[index]
    if (!drop.active) continue
    drop.ticksUntilAdvance -= 1
    if (drop.ticksUntilAdvance > 0) continue
    if (drop.step === 4) landed[index] = true
    else {
      drop.step = (drop.step + 1) as DropStep
      drop.ticksUntilAdvance = STEP_DELAYS[drop.speed][drop.step]
    }
  }
  return landed
}

function resolveCatchOrMiss(state: GameState, landed: readonly boolean[]): void {
  for (let index = 0; index < state.drops.length; index += 1) {
    const drop = state.drops[index]
    if (!landed[index] || !drop.active || drop.step !== 4) continue
    drop.active = false
    state.lastLandingTick = state.ticks
    if (drop.kind === 'bomb') {
      if (drop.lane === state.player) state.misses += 1
    } else if (drop.lane === state.player) state.score += 1
    else state.misses += 1
    if (state.misses >= 3) {
      state.phase = 'gameover'
      return
    }
  }
}

function spawnDropsIfNeeded(state: GameState): void {
  const activeCount = state.drops.filter((drop) => drop.active).length
  if (activeCount >= 2) return
  spawnNextDrop(state, activeCount === 0)
}

function increaseDifficulty(state: GameState): void {
  const speedUps = Math.floor(state.score / SPEED_UP_EVERY_SCORE)
  state.tickInterval = Math.max(MIN_TICK_INTERVAL_MS, INITIAL_TICK_INTERVAL_MS - speedUps * SPEED_UP_STEP_MS)
}

export function updateGame(state: GameState): void {
  if (state.phase !== 'playing') return
  state.ticks += 1
  const landed = advanceDrops(state)
  resolveCatchOrMiss(state, landed)
  if (state.phase !== 'playing') return
  spawnDropsIfNeeded(state)
  increaseDifficulty(state)
}

function getPlayerTexture(position: PlayerPosition): PiuTexture {
  playerTextures[position] ??= new Texture(PLAYER_TEXTURE_NAMES[position])
  return playerTextures[position]
}

function getItemTexture(kind: DropKind): PiuTexture {
  itemTextures[kind] ??= new Texture(ITEM_TEXTURE_NAMES[kind])
  return itemTextures[kind]
}

function getMissTexture(): PiuTexture {
  missTexture ??= new Texture('miss.png')
  return missTexture
}

export class StackchanCatchBehavior extends Behavior {
  #state = createGameState()

  get state(): GameState {
    return this.#state
  }

  onCreate(_port: PiuPort): void {
    this.#state = createGameState()
  }

  onDisplaying(port: PiuPort): void {
    port.interval = this.#state.tickInterval
    if (this.#state.phase === 'playing') port.start()
    port.invalidate()
  }

  onUndisplaying(port: PiuPort): void {
    port.stop()
  }

  onTouchBegan(port: PiuPort, _id: number, x: number): void {
    const third = port.width / 3
    if (this.#state.phase === 'playing') {
      if (x < third) movePlayer(this.#state, -1)
      else if (x >= third * 2) movePlayer(this.#state, 1)
      else return
      port.invalidate()
      return
    }

    if (x < third || x >= third * 2) return
    startGame(this.#state)
    port.interval = this.#state.tickInterval
    port.start()
    port.invalidate()
  }

  onTouchEnded(): void {}

  onTimeChanged(port: PiuPort): void {
    updateGame(this.#state)
    port.interval = this.#state.tickInterval
    if (this.#state.phase === 'gameover') port.stop()
    port.invalidate()
  }

  onDraw(port: PiuPort): void {
    port.fillColor(COLOR_BACKGROUND, 0, 0, port.width, port.height)
    this.#drawFrame(port)
    this.#drawHud(port)
    this.#drawDrops(port)
    this.#drawPlayer(port)
    this.#drawControls(port)
    if (this.#state.phase === 'title') this.#drawTitle(port)
    else if (this.#state.phase === 'gameover') this.#drawGameOver(port)
  }

  #drawFrame(port: PiuPort): void {
    port.fillColor(COLOR_INK, 4, 3, port.width - 8, 2)
    port.fillColor(COLOR_INK, 4, port.height - 5, port.width - 8, 2)
    port.fillColor(COLOR_GHOST, 4, 5, 2, port.height - 10)
    port.fillColor(COLOR_GHOST, port.width - 6, 5, 2, port.height - 10)
    for (const center of LANE_CENTERS) {
      port.fillColor(COLOR_GHOST, center - 1, 31, 2, 94)
    }
  }

  #drawHud(port: PiuPort): void {
    const score = (this.#state.score % 1000).toString().padStart(3, '0')
    port.drawString(`SCORE ${score}`, hudStyle, COLOR_INK, 10, 6, 94, 22)
    port.drawString('CATCH', hudStyle, COLOR_INK, 125, 6, 64, 22)
    port.drawString('MISS', hudStyle, COLOR_INK, 211, 6, 42, 22)
    for (let index = 0; index < 3; index += 1) {
      const color = index < this.#state.misses ? COLOR_INK : COLOR_GHOST
      port.drawTexture(getMissTexture(), color, 260 + index * 16, 8, 0, 0, MISS_SIZE, MISS_SIZE)
    }
  }

  #drawDrops(port: PiuPort): void {
    for (const drop of this.#state.drops) {
      if (!drop.active) continue
      const texture = getItemTexture(drop.kind)
      const left = LANE_CENTERS[drop.lane] - ITEM_SIZE / 2
      for (const top of DROP_Y) {
        port.fillColor(COLOR_GHOST, LANE_CENTERS[drop.lane] - 6, top + 11, 12, 2)
      }
      port.drawTexture(texture, COLOR_INK, left, DROP_Y[drop.step], 0, 0, ITEM_SIZE, ITEM_SIZE)
      if (drop.kind === 'bomb') {
        port.drawString('!', controlStyle, COLOR_INK, left - 9, DROP_Y[drop.step], 8, ITEM_SIZE)
      }
    }
  }

  #drawPlayer(port: PiuPort): void {
    for (let position = 0; position < 3; position += 1) {
      const typedPosition = position as PlayerPosition
      port.fillColor(COLOR_GHOST, LANE_CENTERS[typedPosition] - 18, PLAYER_Y + PLAYER_SIZE + 1, 36, 2)
    }
    const position = this.#state.player
    port.drawTexture(
      getPlayerTexture(position),
      COLOR_INK,
      LANE_CENTERS[position] - PLAYER_SIZE / 2,
      PLAYER_Y,
      0,
      0,
      PLAYER_SIZE,
      PLAYER_SIZE,
    )
    port.fillColor(COLOR_INK, LANE_CENTERS[position] - 18, PLAYER_Y + PLAYER_SIZE + 1, 36, 2)
  }

  #drawControls(port: PiuPort): void {
    const playing = this.#state.phase === 'playing'
    drawControl(port, 8, 96, 'LEFT', playing)
    drawControl(port, 112, 96, 'START', !playing)
    drawControl(port, 216, 96, 'RIGHT', playing)
  }

  #drawTitle(port: PiuPort): void {
    drawPanel(port, 82, 61, 156, 60)
    port.drawString('CATCH', panelStyle, COLOR_INK, 85, 66, 150, 30)
    port.drawString('TAP CENTER', panelHintStyle, COLOR_INK, 85, 95, 150, 18)
  }

  #drawGameOver(port: PiuPort): void {
    drawPanel(port, 66, 54, 188, 78)
    port.drawString('GAME OVER', panelStyle, COLOR_INK, 69, 61, 182, 34)
    port.drawString('TAP CENTER', panelHintStyle, COLOR_INK, 69, 104, 182, 18)
  }
}

function drawPanel(port: PiuPort, x: number, y: number, width: number, height: number): void {
  port.fillColor(COLOR_BACKGROUND, x, y, width, height)
  port.fillColor(COLOR_INK, x, y, width, 3)
  port.fillColor(COLOR_INK, x, y + height - 3, width, 3)
  port.fillColor(COLOR_INK, x, y, 3, height)
  port.fillColor(COLOR_INK, x + width - 3, y, 3, height)
}

function drawControl(port: PiuPort, x: number, width: number, label: string, enabled: boolean): void {
  const color = enabled ? COLOR_INK : COLOR_GHOST
  port.fillColor(color, x, CONTROL_Y, width, 1)
  port.fillColor(color, x, CONTROL_Y + 14, width, 1)
  port.fillColor(color, x, CONTROL_Y, 1, 15)
  port.fillColor(color, x + width - 1, CONTROL_Y, 1, 15)
  port.drawString(label, controlStyle, color, x + 1, CONTROL_Y, width - 2, 15)
}

const definition: MiniAppDefinition = Object.freeze({
  id: 'sample.stackchan-catch',
  title: 'ｽﾀｯｸﾁｬﾝ CATCH',
  icon: 'play',
  create() {
    return new Container(null, {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      skin: background,
      contents: [
        new Port(null, {
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          active: true,
          Behavior: StackchanCatchBehavior,
        }),
      ],
    })
  },
})

export default Object.freeze([definition])
