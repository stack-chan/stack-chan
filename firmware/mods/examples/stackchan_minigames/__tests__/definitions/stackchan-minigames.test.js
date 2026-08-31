import definitions from 'miniapp'
import { equal } from 'testing/assert'

equal(definitions.length, 2, 'one archive should register two mini games')
equal(definitions[0].id, 'sample.stackchan-jump', 'the first game should be Stack-chan JUMP')
equal(definitions[1].id, 'sample.stackchan-catch', 'the second game should be Stack-chan CATCH')

trace('ok\n')
