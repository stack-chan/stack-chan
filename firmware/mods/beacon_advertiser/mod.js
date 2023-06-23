import BLEServer from 'bleserver'
import { speeches } from 'speeches_greeting'
import { randomBetween } from 'stackchan-util'
import { Bytes } from 'btutils'
import { BeaconDataPacket } from 'beacon-packet'
import { TTS as LocalTTS } from 'tts-local'

const keys = Object.keys(speeches)
const hellos = keys.filter((k) => k.startsWith('hello_'))
const byes = keys.filter((k) => k.startsWith('bye_'))

const COMPANY_ID = 0x004c
const UUID = new Bytes('CFFD85BB-67E0-9CD4-B2D0-BE5A7ECAC915'.replaceAll('-', ''), false)

class Advertiser extends BLEServer {
  onReady() {}
  onConnected(connection) {
    this.stopAdvertising()
  }
  onDisconnected(connection) {}
}

export function onRobotCreated(robot) {
  let count = 0
  /**
   * @note A workaround due to the sample rate of the mod resource being fixed at 11025.
   * M5Stack CoreS3 cannot play at a sample rate of 11025, so we use a nearby valid common value.
   **/
  robot.useTTS(new LocalTTS({ sampleRate: 11000 }))
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

  robot.button.a.onChanged = async function () {
    if (this.read()) {
      const hello = hellos[Math.floor(randomBetween(0, hellos.length))]
      await robot.say(hello)
      sendCommand(1)
    }
  }
  robot.button.b.onChanged = async function () {
    if (this.read()) {
      const bye = byes[Math.floor(randomBetween(0, byes.length))]
      await robot.say(bye)
      sendCommand(2)
    }
  }
}
