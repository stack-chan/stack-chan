import BLEServer from 'bleserver'
import { speeches } from 'speeches_greeting'
import { randomBetween } from 'stackchan-util'
import { Bytes } from 'btutils'
import { BeaconDataPacket } from 'beacon_packet'

const keys = Object.keys(speeches)
const hellos = keys.filter((k) => k.startsWith('hello_'))
const byes = keys.filter((k) => k.startsWith('bye_'))

const COMPANY_ID = 0x004c
const UUID = new Bytes('CFFD85BB-67E0-9CD4-B2D0-BE5A7ECAC915'.replaceAll('-', ''), false)

let count = 0
const dataPacket = new BeaconDataPacket(UUID, 0, 1, -40)
class Advertiser extends BLEServer {
  onReady() {}
  onConnected(connection) {
    this.stopAdvertising()
  }
  onDisconnected(connection) {}
}

function sendCommand(command) {
  count++
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

let advertiser = new Advertiser()

export function onRobotCreated(robot) {
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
