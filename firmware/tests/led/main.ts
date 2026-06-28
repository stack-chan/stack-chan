import Led from 'led'

// M5Stack + M5Go bottom
const ledConfig = { pin: 15, length: 10 }
const led = new Led(ledConfig)

led.on(255, 0, 0)
led.off()
led.blink(255, 255, 0, 1000)
led.off()
trace('ok\n')
