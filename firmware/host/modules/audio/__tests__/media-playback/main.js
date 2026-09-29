trace('loading media tests\n')
import('media-tests').catch((error) => {
  trace(`load failed: ${error}\n${error.stack}\n`)
})
