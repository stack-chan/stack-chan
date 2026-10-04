import { createBackgroundFetch } from 'realtimeHttpDispatcher'
import NativeHttp from 'realtimeNativeHttp'
import Timer from 'timer'
export default createBackgroundFetch({
  createWorker: () => new NativeHttp(),
  schedule: (callback, delay) => Timer.set(callback, delay),
  cancel: (timer) => Timer.clear(timer),
})
