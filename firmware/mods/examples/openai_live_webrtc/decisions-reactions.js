import { Emotion } from 'face-state'

const INPUT_TRANSCRIPT = 'session.input_transcript.delta'
const OUTPUT_TRANSCRIPT = 'session.output_transcript.delta'
const EXPRESSION = Object.freeze({
  neutral: Emotion.NEUTRAL,
  happy: Emotion.HAPPY,
  sad: Emotion.SAD,
  concerned: Emotion.DOUBTFUL,
})
const TRANSCRIPT_HISTORY = 64
const NOD_STEP_MS = 180
const NOD_PITCH_RADIANS = 0.12
const NOD_INTERVAL_MS = 1500

function trigger(eventType, context) {
  return {
    type: 'decisions',
    event_type: eventType,
    decisions: {
      questions: [
        {
          type: 'choice',
          name: 'expression',
          instructions: `Choose the robot's expression ${context}. Use neutral unless the words clearly call for a reaction.`,
          choices: Object.keys(EXPRESSION).map((value) => ({ value })),
        },
        {
          type: 'choice',
          name: 'gesture',
          instructions: `Choose nod only for a clear moment of acknowledgment ${context}. Otherwise choose none.`,
          choices: [{ value: 'none' }, { value: 'nod' }],
        },
      ],
    },
  }
}

export function createDecisionsReactions(robot, wait) {
  const directions = new Map([
    [INPUT_TRANSCRIPT, { transcript: new Map(), latest: undefined }],
    [OUTPUT_TRANSCRIPT, { transcript: new Map(), latest: undefined }],
  ])
  let sequence = 0
  let latestDirection
  let emotion
  let generation = 0
  let nodding
  let lastNodAt = -Infinity

  function setEmotion(next) {
    if (next === emotion) return
    try {
      robot.face?.setEmotion(next)
      emotion = next
    } catch {}
  }

  async function nod() {
    const motion = robot.motion
    if (!motion?.withTemporaryTorque || Date.now() - lastNodAt < NOD_INTERVAL_MS) return
    const body = motion.pose?.body
    if (
      !body?.position ||
      !body.rotation ||
      ![body.position.x, body.position.y, body.position.z, body.rotation.y, body.rotation.p, body.rotation.r].every(
        Number.isFinite,
      )
    )
      return
    const position = { ...body.position }
    const rotation = { ...body.rotation }
    const current = generation
    lastNodAt = Date.now()
    await motion.withTemporaryTorque(async (setPose) => {
      if (current !== generation) return
      try {
        await setPose({ position, rotation: { ...rotation, p: rotation.p + NOD_PITCH_RADIANS } }, NOD_STEP_MS / 1000)
        await wait(NOD_STEP_MS)
      } finally {
        await setPose({ position, rotation }, NOD_STEP_MS / 1000)
        await wait(NOD_STEP_MS)
      }
    })
  }

  return {
    triggers: [
      trigger(INPUT_TRANSCRIPT, 'while listening to the user'),
      trigger(OUTPUT_TRANSCRIPT, 'while speaking to the user'),
    ],
    receive(message) {
      if (!message || typeof message !== 'object') return
      const source = directions.get(message.type)
      if (source) {
        const id = message.event_id
        if (
          typeof id !== 'string' ||
          !id ||
          id.length > 256 ||
          !Number.isFinite(message.end_ms) ||
          source.transcript.has(id)
        )
          return
        source.transcript.set(id, { end: message.end_ms, sequence: ++sequence })
        latestDirection = source
        if (source.transcript.size > TRANSCRIPT_HISTORY) source.transcript.delete(source.transcript.keys().next().value)
        return
      }

      if (
        message.type !== 'decision.event' ||
        message.delegation_id !== null ||
        typeof message.trigger_id !== 'string' ||
        !message.trigger_id ||
        message.event?.type !== 'decision.completed'
      )
        return
      const direction = directions.get(message.source_event_type)
      const fragment = direction?.transcript.get(message.source_event_id)
      const latest = direction?.latest
      if (
        !fragment ||
        direction !== latestDirection ||
        (latest && (fragment.end < latest.end || (fragment.end === latest.end && fragment.sequence <= latest.sequence)))
      )
        return

      const answers = message.event.decision?.answers
      if (!Array.isArray(answers)) return
      const expression = answers.find((answer) => answer?.type === 'choice' && answer.name === 'expression')?.choice
      const gesture = answers.find((answer) => answer?.type === 'choice' && answer.name === 'gesture')?.choice
      const hasExpression = typeof expression === 'string' && Object.hasOwn(EXPRESSION, expression)
      if (!hasExpression && gesture !== 'nod' && gesture !== 'none') return

      direction.latest = fragment
      if (hasExpression) setEmotion(EXPRESSION[expression])
      if (gesture === 'nod' && !nodding) {
        nodding = nod()
          .catch(() => {})
          .finally(() => {
            nodding = undefined
          })
      }
    },
    reset() {
      generation++
      for (const direction of directions.values()) {
        direction.transcript.clear()
        direction.latest = undefined
      }
      sequence = 0
      latestDirection = undefined
      if (emotion !== undefined) setEmotion(Emotion.NEUTRAL)
      emotion = undefined
      return nodding
    },
  }
}
