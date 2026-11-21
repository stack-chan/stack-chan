import { readFileSync } from 'node:fs'
import { evaluateVoicePerformance } from './lib/voice-performance-gate.mjs'

const [capture, specification, ...extra] = process.argv.slice(2)
if (!capture || !specification || extra.length) {
  console.error('Usage: node scripts/check-voice-performance.mjs <capture.log> <spec.json>')
  process.exitCode = 2
} else {
  try {
    const result = evaluateVoicePerformance(
      readFileSync(capture, 'utf8'),
      JSON.parse(readFileSync(specification, 'utf8')),
    )
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = result.passed ? 0 : 1
  } catch (error) {
    console.error(error.message)
    process.exitCode = 2
  }
}
