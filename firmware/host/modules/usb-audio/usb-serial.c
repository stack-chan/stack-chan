#include "xsmc.h"
#include "xsHost.h"
#include "driver/usb_serial_jtag.h"

static uint8_t gUsbSerialOpen = 0;

void xs_stackchan_usb_serial_open(xsMachine *the)
{
	if (gUsbSerialOpen)
		return;
	usb_serial_jtag_driver_config_t config = {
		.rx_buffer_size = 16 * 1024,
		.tx_buffer_size = 16 * 1024,
	};
	if (ESP_OK != usb_serial_jtag_driver_install(&config))
		xsUnknownError("USB serial driver installation failed");
	gUsbSerialOpen = 1;
}

void xs_stackchan_usb_serial_read(xsMachine *the)
{
	uint8_t *target;
	xsUnsignedValue length;
	if (!gUsbSerialOpen)
		xsUnknownError("USB serial is closed");
	xsmcGetBufferWritable(xsArg(0), (void **)&target, &length);
	int count = usb_serial_jtag_read_bytes(target, length, 0);
	xsmcSetInteger(xsResult, count > 0 ? count : 0);
}

void xs_stackchan_usb_serial_write(xsMachine *the)
{
	uint8_t *source;
	xsUnsignedValue length;
	if (!gUsbSerialOpen)
		xsUnknownError("USB serial is closed");
	xsmcGetBufferReadable(xsArg(0), (void **)&source, &length);
	int count = usb_serial_jtag_write_bytes(source, length, 0);
	xsmcSetInteger(xsResult, count > 0 ? count : 0);
}

void xs_stackchan_usb_crc32(xsMachine *the)
{
	uint8_t *source;
	xsUnsignedValue length;
	xsmcGetBufferReadable(xsArg(0), (void **)&source, &length);
	if (xsmcArgc > 1) {
		xsIntegerValue requested = xsmcToInteger(xsArg(1));
		if ((requested < 0) || ((xsUnsignedValue)requested > length))
			xsRangeError("invalid CRC32 length");
		length = (xsUnsignedValue)requested;
	}

	uint32_t crc = 0xFFFFFFFF;
	while (length--) {
		crc ^= *source++;
		for (uint8_t bit = 0; bit < 8; bit++)
			crc = (crc >> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
	}
	xsmcSetNumber(xsResult, (xsNumberValue)(crc ^ 0xFFFFFFFF));
}

void xs_stackchan_usb_serial_close(xsMachine *the)
{
	if (!gUsbSerialOpen)
		return;
	usb_serial_jtag_driver_uninstall();
	gUsbSerialOpen = 0;
}
