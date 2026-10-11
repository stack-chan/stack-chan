import('art-render-tests')
  .then(() => trace('@@STACKCHAN_TEST:PASS@@\n'))
  .catch((error) => {
    trace('@@STACKCHAN_TEST:FAIL@@\n')
    trace(`art render tests failed: ${error}\n${error.stack}\n`)
    throw error
  })
