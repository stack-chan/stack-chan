// Keep the bootstrap free of static dependencies: the SDK async main loader
// discards import rejection, so the diagnostic must report body load failures.
trace('@@STACKCHAN_TEST:START@@\n')

export default async function main() {
  try {
    const { default: run } = await import('media-before-transport-body')
    await run()
  } catch (error) {
    trace(`${String(error)}\n`)
    if (error?.stack) trace(`${error.stack}\n`)
    trace('@@STACKCHAN_TEST:FAIL@@\n')
  }
}
