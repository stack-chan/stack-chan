import { directModelOptions } from 'stackchanOpenAIRealtimeModel'
import 'stackchanOpenAIRealtime'
import { serverModelOptions } from 'stackchanServerOpenAIRealtimeModel'
import 'stackchanServerOpenAIRealtime'
import { equal } from 'testing/assert'
import Timer from 'timer'

trace('=== realtime-worker-entrypoints test ===\n')

equal(directModelOptions?.inputSampleRate, 8000, 'direct worker should instantiate the direct Realtime model')
equal(serverModelOptions?.inputSampleRate, 8000, 'server worker should instantiate the server-backed Realtime model')

trace('ok\n')
Timer.set(() => {}, 1000)
