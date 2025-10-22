import { runRenderingTests } from 'test-face-rendering'

trace('Starting import test step 1\n')

try {
  trace('Testing renderer-base import...\n')
  const result = runRenderingTests()
  trace(`Rendering tests result: ${result}\n`)
} catch (error) {
  trace(`Sync import error: ${error}\n`)
}

export default new Application(null, {
  skin: new Skin({ fill: 'silver' }),
})
