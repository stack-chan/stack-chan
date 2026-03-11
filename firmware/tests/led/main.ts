import Led from 'led'
import { asyncWait } from 'stackchan-util'

// M5Stack + M5Go bottom
const ledConfig = { pin: 15, length: 10 }
const led = new Led(ledConfig)

led.on(255, 0, 0)
await asyncWait(500)
led.on(0, 255, 0)
await asyncWait(500)
led.on(0, 0, 255)
await asyncWait(500)
led.off()
await asyncWait(1000)

led.on(255, 255, 255, 1000)
await asyncWait(2000)

led.blink(255, 255, 0, 1000)
await asyncWait(5000)

led.rainbow()
