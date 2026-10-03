import('art-render-tests')
  .then(() => trace('ok\n'))
  .catch((error) => {
    trace(`art render tests failed: ${error}\n${error.stack}\n`)
    throw error
  })
