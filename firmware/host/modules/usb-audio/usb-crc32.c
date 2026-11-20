#include "xsmc.h"

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
