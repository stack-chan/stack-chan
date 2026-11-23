#include "xsmc.h"
#include <stdint.h>

void xs_stackchan_pcm_magnitude_sum(xsMachine *the)
{
    const uint8_t *bytes;
    xsUnsignedValue length;
    xsIntegerValue offset = xsmcToInteger(xsArg(1));
    xsIntegerValue size = xsmcToInteger(xsArg(2));
    xsmcGetBufferReadable(xsArg(0), (void **)&bytes, &length);
    if ((offset < 0) || (size < 0) || (size & 1) ||
        ((xsUnsignedValue)offset > length) || ((xsUnsignedValue)size > length - (xsUnsignedValue)offset))
        xsRangeError("invalid PCM sample range");

    uint64_t magnitude = 0;
    bytes += offset;
    while (size > 0) {
        int32_t sample = bytes[0] + 256 * ((bytes[1] ^ 0x80) - 128);
        magnitude += (uint32_t)(sample < 0 ? -sample : sample);
        bytes += 2;
        size -= 2;
    }
    xsmcSetNumber(xsResult, (xsNumberValue)magnitude);
}
