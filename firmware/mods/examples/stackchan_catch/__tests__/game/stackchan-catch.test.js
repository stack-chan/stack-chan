import definitions, { createGameState, movePlayer, StackchanCatchBehavior, startGame, updateGame } from 'miniapp'
import { assert, equal } from 'testing/assert'

equal(definitions.length, 1, 'the archive should register one CATCH game')
equal(definitions[0].id, 'sample.stackchan-catch', 'CATCH should have a stable id')

{
  const events = []
  const port = {
    width: 320,
    interval: 0,
    invalidate() {
      events.push('invalidate')
    },
    start() {
      events.push('start')
    },
    stop() {
      events.push('stop')
    },
  }
  const behavior = new StackchanCatchBehavior()
  behavior.onCreate(port)
  behavior.onDisplaying(port)
  equal(events.join(','), 'invalidate', 'displaying the title should not start the timer')
  behavior.onTouchBegan(port, 0, 160)
  equal(behavior.state.phase, 'playing', 'a center tap should start the game')
  equal(events.slice(-2).join(','), 'start,invalidate', 'starting should run and redraw the port')
  behavior.onTouchBegan(port, 0, 0)
  equal(behavior.state.player, 0, 'the left touch zone should move the player')
  behavior.onTouchBegan(port, 0, 319)
  equal(behavior.state.player, 1, 'the right touch zone should move the player')
  behavior.onUndisplaying(port)
  equal(events.at(-1), 'stop', 'undisplaying should always stop the timer')
  behavior.onDisplaying(port)
  equal(events.slice(-2).join(','), 'start,invalidate', 'redisplaying a running game should restart its timer')
}

{
  const state = createGameState()
  equal(state.phase, 'title', 'a new game should show its title')
  startGame(state)
  equal(state.phase, 'playing', 'start should enter the playing phase')
  equal(state.drops.filter((drop) => drop.active).length, 1, 'CATCH should start with one lead drop')

  movePlayer(state, -1)
  movePlayer(state, -1)
  equal(state.player, 0, 'left movement should clamp at the first lane')
  movePlayer(state, 1)
  movePlayer(state, 1)
  movePlayer(state, 1)
  equal(state.player, 2, 'right movement should clamp at the last lane')
}

{
  const textures = []
  const labels = []
  const port = {
    width: 320,
    height: 196,
    fillColor() {},
    drawString(label) {
      labels.push(label)
    },
    drawTexture(_texture, color, _x, _y, _sx, _sy, width, height) {
      textures.push({ color, width, height })
    },
  }
  const behavior = new StackchanCatchBehavior()
  behavior.onCreate(port)
  startGame(behavior.state)
  behavior.onDraw(port)
  equal(
    textures.filter(({ width, height }) => width === 48 && height === 48).length,
    1,
    'only the current player pose should be rendered',
  )
  equal(
    textures.filter(({ width, height }) => width === 24 && height === 24).length,
    1,
    'only the current drop pose should be rendered',
  )
  assert(
    labels.includes('LEFT') && labels.includes('START') && labels.includes('RIGHT'),
    'touch zones should be labeled',
  )
}

{
  const state = createGameState()
  startGame(state)
  equal(state.drops[0].speed, 'slow', 'the lead drop should start slowly')
  updateGame(state)
  equal(state.drops.filter(({ active }) => active).length, 2, 'a second drop should join after one tick')
  equal(state.drops[1].speed, 'fast', 'the later drop should fall faster')
  equal(state.drops[1].landingTick, 6, 'the later fast drop should be scheduled first')
  equal(state.drops[0].landingTick, 9, 'the earlier slow drop should land three ticks later')

  state.player = 1
  for (let tick = 1; tick < 6; tick += 1) updateGame(state)
  equal(state.score, 1, 'the later fast drop should be caught first')
  equal(state.drops[0].active, true, 'the earlier slow drop should still be falling')
  equal(state.drops.filter(({ active }) => active).length, 2, 'a replacement should join without waiting for a wave')

  state.player = 0
  for (let tick = 0; tick < 3; tick += 1) updateGame(state)
  equal(state.score, 2, 'the earlier slow drop should land three ticks after the fast drop')
  assert(
    state.drops.some(({ active }) => active),
    'the stream should continue while a drop is resolved',
  )
}

{
  const state = createGameState()
  startGame(state)
  state.score = 4
  const drop = state.drops[0]
  state.player = drop.lane
  drop.kind = 'screw'
  drop.step = 3
  drop.speed = 'fast'
  drop.ticksUntilAdvance = 1
  drop.landingTick = state.ticks + 2
  updateGame(state)
  equal(drop.step, 4, 'the final fixed drop pose should remain visible for one tick')
  equal(state.score, 4, 'the final pose should resolve on the following tick')
  updateGame(state)
  equal(state.score, 5, 'matching the final drop lane should score a catch')
  equal(state.tickInterval, 550, 'five points should increase the game speed')

  state.score = 1000
  const activeDrop = state.drops.find(({ active }) => active)
  activeDrop.kind = 'screw'
  activeDrop.step = 4
  activeDrop.speed = 'fast'
  activeDrop.ticksUntilAdvance = 1
  activeDrop.landingTick = state.ticks + 1
  state.player = activeDrop.lane
  updateGame(state)
  equal(state.tickInterval, 250, 'difficulty should stop at the minimum tick interval')
}

{
  const hitState = createGameState()
  startGame(hitState)
  hitState.drops[1].active = false
  const bomb = hitState.drops[0]
  bomb.kind = 'bomb'
  bomb.step = 4
  bomb.speed = 'fast'
  bomb.ticksUntilAdvance = 1
  bomb.landingTick = hitState.ticks + 1
  hitState.player = bomb.lane
  updateGame(hitState)
  equal(hitState.misses, 1, 'catching a bomb should add a miss')
  equal(hitState.score, 0, 'catching a bomb should not add score')

  const avoidState = createGameState()
  startGame(avoidState)
  avoidState.drops[1].active = false
  const avoidedBomb = avoidState.drops[0]
  avoidedBomb.kind = 'bomb'
  avoidedBomb.step = 4
  avoidedBomb.speed = 'fast'
  avoidedBomb.ticksUntilAdvance = 1
  avoidedBomb.landingTick = avoidState.ticks + 1
  avoidState.player = (avoidedBomb.lane + 1) % 3
  updateGame(avoidState)
  equal(avoidState.misses, 0, 'avoiding a bomb should not add a miss')
  equal(avoidState.score, 0, 'avoiding a bomb should not add score')
}

{
  const state = createGameState()
  startGame(state)
  let landingCount = 0
  let lastLandingTick = -100
  let maxActiveDrops = 0
  let minActiveDrops = 2
  const speeds = new Set()
  for (let tick = 0; tick < 180; tick += 1) {
    const landingDrops = state.drops.filter(
      ({ active, step, ticksUntilAdvance }) => active && step === 4 && ticksUntilAdvance === 1,
    )
    assert(landingDrops.length <= 1, 'the stream should never land two objects on the same tick')
    if (landingDrops.length === 1) {
      const landing = landingDrops[0]
      state.player = landing.kind === 'bomb' ? (landing.lane + 1) % 3 : landing.lane
    }
    updateGame(state)
    const activeDrops = state.drops.filter(({ active }) => active)
    maxActiveDrops = Math.max(maxActiveDrops, activeDrops.length)
    minActiveDrops = Math.min(minActiveDrops, activeDrops.length)
    for (const activeDrop of activeDrops) speeds.add(activeDrop.speed)
    if (landingDrops.length === 1) {
      assert(state.ticks - lastLandingTick >= 3, 'the stream should leave at least three ticks between landings')
      lastLandingTick = state.ticks
      landingCount += 1
    }
  }
  equal(maxActiveDrops, 2, 'the stream should use two simultaneous falling objects')
  equal(minActiveDrops, 1, 'the stream should never pause with an empty screen')
  assert(speeds.has('fast') && speeds.has('steady') && speeds.has('slow'), 'the stream should vary falling speed')
  assert(landingCount >= 30, 'the continuous stream should keep a brisk tempo')
  equal(state.phase, 'playing', 'safe continuous spawning should remain playable')
}

{
  const state = createGameState()
  startGame(state)
  for (let miss = 1; miss <= 3; miss += 1) {
    const drop = state.drops[0]
    drop.active = true
    drop.kind = 'screw'
    drop.step = 4
    drop.speed = 'fast'
    drop.ticksUntilAdvance = 1
    drop.landingTick = state.ticks + 1
    state.drops[1].active = false
    state.player = (drop.lane + 1) % 3
    updateGame(state)
    equal(state.misses, miss, `miss ${miss} should light one indicator`)
  }
  equal(state.phase, 'gameover', 'the third miss should end the game')
  assert(
    state.drops.every((drop) => !drop.active || drop.step === 4),
    'game over should not spawn another drop',
  )

  startGame(state)
  equal(state.phase, 'playing', 'retry should restart the game')
  equal(state.score, 0, 'retry should reset the score')
  equal(state.misses, 0, 'retry should reset the miss indicators')
  equal(state.tickInterval, 600, 'retry should reset the speed')
}

trace('ok\n')
