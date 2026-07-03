import { BeaconDataPacket } from 'beacon-packet'
import BLEServer from 'bleserver'
import { Bytes } from 'btutils'
import { speeches } from 'speeches_greeting'
import { randomBetween } from 'stackchan-util'
import { TTS as LocalTTS } from 'tts-local'

const keys = Object.keys(speeches)
const hellos = keys.filter((k) => k.startsWith('hello_'))
const byes = keys.filter((k) => k.startsWith('bye_'))

const COMPANY_ID = 0x004c
const UUID = new Bytes('CFFD85BB-67E0-9CD4-B2D0-BE5A7ECAC915'.replaceAll('-', ''), false)

class Advertiser extends BLEServer {
  onReady() {}
  onConnected(_connection) {
    this.stopAdvertising()
  }
  onDisconnected(_connection) {}
}

export function onContextCreated(robot) {
  let count = 0
  /**
   * @note A workaround due to the sample rate of the mod resource being fixed at 11025.
   * M5Stack CoreS3 cannot play at a sample rate of 11025, so we use a nearby valid common value.
   **/
  robot.audio.useTTS(new LocalTTS({ sampleRate: 11000 }))
  const dataPacket = new BeaconDataPacket(UUID, 0, 1, -40)
  const advertiser = new Advertiser()
  const sendCommand = (command) => {
    count += 1
    dataPacket.major = count
    dataPacket.minor = command
    advertiser.startAdvertising({
      advertisingData: {
        flags: 6,
        manufacturerSpecific: {
          identifier: COMPANY_ID,
          data: dataPacket.payload,
        },
      },
    })
  }

  const sayAndSend = async (message, command) => {
    await robot.audio.say(message)
    sendCommand(command)
  }

  robot.input.button.a.onEvent = (event) => {
    if (event.pressed) {
      const hello = hellos[Math.floor(randomBetween(0, hellos.length))]
      sayAndSend(hello, 1).catch((error) => trace(`hello failed: ${error}\n`))
    }
  }
  robot.input.button.b.onEvent = (event) => {
    if (event.pressed) {
      const bye = byes[Math.floor(randomBetween(0, byes.length))]
      sayAndSend(bye, 2).catch((error) => trace(`bye failed: ${error}\n`))
    }
  }
}
