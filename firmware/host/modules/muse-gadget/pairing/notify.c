#include "xsmc.h"
#include "xsHost.h"
#include "host/ble_hs.h"

void xs_muse_pairing_notify(xsMachine *the) {
  int connection = xsmcToInteger(xsArg(0));
  int handle = xsmcToInteger(xsArg(1));
  xsUnsignedValue length = xsmcGetArrayBufferLength(xsArg(2));
  if (connection < 0 || connection > 65534 || handle <= 0 || handle > 65535 || length > 160)
    xsRangeError("invalid notification");
  struct os_mbuf *packet = ble_hs_mbuf_from_flat(xsmcToArrayBuffer(xsArg(2)), length);
  if (!packet) xsUnknownError("notification allocation failed");
  /* NimBLE consumes the packet on both success and error. */
  int result = ble_gatts_notify_custom((uint16_t)connection, (uint16_t)handle, packet);
  if (result) xsUnknownError("notification rejected");
  xsmcSetBoolean(xsResult, 1);
}
