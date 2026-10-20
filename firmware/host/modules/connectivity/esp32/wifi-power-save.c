#include "xsmc.h"
#include <string.h>
#include "esp_wifi.h"

void xs_stackchan_set_wifi_power_save(xsMachine *the)
{
    const char *name = xsmcToString(xsArg(0));
    wifi_ps_type_t mode, actual;
    if (!strcmp(name, "none")) mode = WIFI_PS_NONE;
    else if (!strcmp(name, "min-modem")) mode = WIFI_PS_MIN_MODEM;
    else xsRangeError("invalid Wi-Fi power save mode");
    if (ESP_OK != esp_wifi_set_ps(mode))
        xsUnknownError("failed to set Wi-Fi power save");
    if (ESP_OK != esp_wifi_get_ps(&actual) || actual != mode)
        xsUnknownError("Wi-Fi power save readback mismatch");
}

void xs_stackchan_get_wifi_power_save(xsMachine *the)
{
    wifi_ps_type_t mode;
    if (ESP_OK != esp_wifi_get_ps(&mode))
        xsUnknownError("failed to get Wi-Fi power save");
    if (mode == WIFI_PS_NONE) xsResult = xsString("none");
    else if (mode == WIFI_PS_MIN_MODEM) xsResult = xsString("min-modem");
    else xsUnknownError("unexpected Wi-Fi power save mode");
}
