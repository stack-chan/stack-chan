import('art-tests')
  .then(() => trace('ok\n'))
  .catch((error) => {
    trace(`art tests failed: ${error}\n${error.stack}\n`)
    throw error
  })
