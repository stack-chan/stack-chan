import AXP2101 from "embedded:peripheral/Power/axp2101";
import baseSetup from "m5stack-cores3/setup-target";

function patchStackChanPower() {
	const axp2101 = new AXP2101({
		address: 0x34,
		sensor: { ...device.I2C.internal, io: device.io.SMBus },
	});

	let data = axp2101.readByte(0x90);
	axp2101.writeByte(0x90, data | 0b10110100);
	axp2101.writeByte(0x97, 0b11110 - 2);
	axp2101.writeByte(0x69, 0b00110101);
	axp2101.writeByte(0x30, 0b111111);
	axp2101.writeByte(0x90, 0xbf);
	axp2101.writeByte(0x94, 33 - 5);
	axp2101.writeByte(0x95, 33 - 5);
	axp2101.writeByte(0x27, 0x00);

	const charge = axp2101.readByte(0x62);
	axp2101.writeByte(0x62, (charge & 0xe0) | 13);
	trace("[m5stackchan] patched CoreS3 AXP2101 power rails\n");
}

export default function (done) {
	baseSetup(() => {
		try {
			patchStackChanPower();
		} catch (error) {
			trace(`[m5stackchan] AXP2101 power patch failed: ${error}\n`);
		}
		done?.();
	});
}
