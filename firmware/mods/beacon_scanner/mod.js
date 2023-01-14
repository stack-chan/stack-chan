import BLEClient from 'bleclient'
import { speeches } from 'speeches_greeting'
import { randomBetween } from 'stackchan-util'
import { uuid } from 'btutils'
import { BeaconDataPacket } from 'beacon_packet'

const keys = Object.keys(speeches)
const hellos = keys.filter((k) => k.startsWith('hello_'))
const byes = keys.filter((k) => k.startsWith('bye_'))

const COMPANY_ID = 0x004c
const UUID = uuid`CFFD85BB-67E0-9CD4-B2D0-BE5A7ECAC915`

class Scanner extends BLEClient {
  constructor() {
    super()
    this.count = undefined
  }
  onReady() {
    this.startScanning({ duplicates: true })
  }
  onDiscovered(device) {
    let manufacturerSpecific = device.scanResponse.manufacturerSpecific
    if (!manufacturerSpecific || COMPANY_ID != manufacturerSpecific.identifier) {
      return
    }
    const { success, reason, value: dataPacket } = BeaconDataPacket.parse(manufacturerSpecific.data)
    if (!success) {
      trace(reason + '\n')
      return
    }
    trace(`${dataPacket.uuid}, ${dataPacket.major}, ${dataPacket.minor}, ${dataPacket.txPower}`)
    if (!UUID.equals(dataPacket.uuid)) {
      return
    }
    const count = dataPacket.major
    if (count !== this.count) {
      this.count = count
      this.handleData?.(dataPacket)
    }
  }
}

export function onRobotCreated(robot) {
  let scanner = new Scanner()
  scanner.handleData = (dataPacket) => {
    const { major: count, minor: command } = dataPacket
    trace(`got: ${count}, ${command}\n`)
    if (command === 1) {
      const hello = hellos[Math.floor(randomBetween(0, hellos.length))]
      robot.say(hello)
    } else if (command === 2) {
      const bye = byes[Math.floor(randomBetween(0, byes.length))]
      robot.say(bye)
    }
  }
}
