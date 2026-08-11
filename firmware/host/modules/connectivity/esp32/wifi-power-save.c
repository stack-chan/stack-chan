#include "xsmc.h"
#include "esp_wifi.h"

void xs_stackchan_disable_wifi_power_save(xsMachine *the)
{
	if (ESP_OK != esp_wifi_set_ps(WIFI_PS_NONE))
		xsUnknownError("failed to disable Wi-Fi power save");
}
