/*
 * Copyright (c) 2016-2020  Moddable Tech, Inc.
 *
 *   This file is part of the Moddable SDK.
 * 
 *   This work is licensed under the
 *       Creative Commons Attribution 4.0 International License.
 *   To view a copy of this license, visit
 *       <http://creativecommons.org/licenses/by/4.0>.
 *   or send a letter to Creative Commons, PO Box 1866,
 *   Mountain View, CA 94042, USA.
 *
 */


import BLEClient from "bleclient";
import { speeches } from 'speeches_greeting'
import { randomBetween } from 'stackchan-util'
import { uuid, Bytes } from 'btutils'

const keys = Object.keys(speeches)
const hellos = keys.filter(k => k.startsWith('hello_'))
const byes = keys.filter(k => k.startsWith('bye_'))

const COMPANY_ID = 0x004c;
const UUID = uuid`CFFD85BB-67E0-9CD4-B2D0-BE5A7ECAC915`
const arr = new Uint8Array(UUID)

class Scanner extends BLEClient {
	constructor() {
		super()
		this.count = undefined
	}
	onReady() {
		this.startScanning({ duplicates:true });
	}
	onDiscovered(device) {
		let manufacturerSpecific = device.scanResponse.manufacturerSpecific;
		if (!manufacturerSpecific || (COMPANY_ID != manufacturerSpecific.identifier)) {
			return
		}
		const data = manufacturerSpecific.data;
		const beaconUUID = data.slice(2, 2 + 16)
		trace(Array.from(data.slice(2, 18)).map(x => x.toString(16).padStart(2, '0')).join(', ') + '\n')
		for (let x = 0; x < 16; x++) {
			if (arr[x] !== beaconUUID[15 - x]) {
				return
			}
		}
		const count = (data[18] << 2) + data[19]
		const command = (data[20] << 2) + data[21]
		if (count !== this.count) {
			this.count = count
			this.onDataGot(count, command)
		}
	}
}

export function onRobotCreated(robot) {
	let scanner = new Scanner;
	scanner.onDataGot = (count, command) => {
		trace(`got: ${count}, ${command}\n`)
		if (command === 0) {
			const hello = hellos[Math.floor(randomBetween(0, hellos.length))]
			robot.say(hello)
		} else if (command === 1) {
			const bye = byes[Math.floor(randomBetween(0, byes.length))]
			robot.say(bye)
		}
	}
}
