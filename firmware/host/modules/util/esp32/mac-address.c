#include "xsPlatform.h"
#include "xs.h"
#include "mc.xs.h"
#include "esp_err.h"
#include "esp_system.h"

void xs_get_mac_address(xsMachine* the) {
    uint8_t macaddr[6];

    int32_t err = esp_efuse_mac_get_default(macaddr);
    if (err) xsUnknownError("failed to get mac address");

    char *out;
    xsResult = xsStringBuffer(NULL, 18);
    out = xsToString(xsResult);
    twoHex(macaddr[0], out); out += 2; *out++ = ':';
    twoHex(macaddr[1], out); out += 2; *out++ = ':';
    twoHex(macaddr[2], out); out += 2; *out++ = ':';
    twoHex(macaddr[3], out); out += 2; *out++ = ':';
    twoHex(macaddr[4], out); out += 2; *out++ = ':';
    twoHex(macaddr[5], out); out += 2; *out++ = 0;
}
