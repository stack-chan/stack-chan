#include "xsAll.h"
#include "xs.h"
#include "mc.xs.h"
#include "modSPI.h"
#include "driver/gpio.h"
#include "esp_rom_gpio.h"
#include "soc/gpio_sig_map.h"

// CoreS3 shares GPIO35 between LCD DC and SD MISO. Files/FAT own the card;
// the board owns only the synchronous bus hand-off, including lazy mounting.
void xs_stackchan_sdcard_begin(xsMachine *the)
{
	modSPIActivateConfiguration(NULL);
	esp_rom_gpio_connect_in_signal(GPIO_NUM_35, SPI3_Q_IN_IDX, 0);
	gpio_set_direction(GPIO_NUM_35, GPIO_MODE_INPUT);
}

void xs_stackchan_sdcard_end(xsMachine *the)
{
	gpio_set_direction(GPIO_NUM_35, GPIO_MODE_OUTPUT);
}

void xs_stackchan_sdcard_xs_version_range(xsMachine *the)
{
	uint8_t *bytes;
	xsResult = xsArrayBuffer(NULL, 4);
	bytes = xsToArrayBuffer(xsResult);
	bytes[0] = XS_MOD_COMPATIBLE_MAJOR_VERSION;
	bytes[1] = XS_MOD_COMPATIBLE_MINOR_VERSION;
	bytes[2] = XS_MAJOR_VERSION;
	bytes[3] = XS_MINOR_VERSION;
}
