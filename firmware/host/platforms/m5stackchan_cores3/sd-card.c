#include "xsAll.h"
#include "xs.h"
#include "mc.xs.h"
#include "modSPI.h"

#include "driver/gpio.h"
#include "driver/sdspi_host.h"
#include "esp_rom_gpio.h"
#include "esp_vfs_fat.h"
#include "soc/gpio_sig_map.h"

#include <dirent.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

#define MOD_MOUNT_POINT "/sdcard"
#define MOD_DIRECTORY MOD_MOUNT_POINT "/mods"
#define MOD_FILENAME_MAX 68

static sdmmc_card_t *gCard = NULL;

static void beginCardAccess(void)
{
	modSPIActivateConfiguration(NULL);
	// CoreS3 shares GPIO35 between LCD DC and SD MISO.
	esp_rom_gpio_connect_in_signal(GPIO_NUM_35, SPI3_Q_IN_IDX, 0);
	gpio_set_direction(GPIO_NUM_35, GPIO_MODE_INPUT);
}

static void endCardAccess(void)
{
	gpio_set_direction(GPIO_NUM_35, GPIO_MODE_OUTPUT);
}

static void failCardAccess(xsMachine *the, const char *message)
{
	endCardAccess();
	xsUnknownError("%s", message);
}

static uint8_t ensureMounted(void)
{
	if (gCard)
		return 1;

	sdmmc_host_t host = SDSPI_HOST_DEFAULT();
	host.slot = SPI3_HOST;
	sdspi_device_config_t device = SDSPI_DEVICE_CONFIG_DEFAULT();
	device.host_id = SPI3_HOST;
	device.gpio_cs = GPIO_NUM_4;
	esp_vfs_fat_sdmmc_mount_config_t mount = {
		.format_if_mount_failed = false,
		.max_files = 1,
		.allocation_unit_size = 0,
	};

	// ponytail: keep the read-only card mounted for this boot; add unmount/hot-plug only when runtime swapping is required.
	return ESP_OK == esp_vfs_fat_sdspi_mount(MOD_MOUNT_POINT, &host, &device, &mount, &gCard);
}

static uint8_t isModFilename(const char *name)
{
	size_t length = strlen(name);
	if ((length < 5) || (length > MOD_FILENAME_MAX) || strcmp(name + length - 4, ".xsa"))
		return 0;

	for (size_t index = 0; index < length - 4; index++) {
		char c = name[index];
		if (!(((c >= 'a') && (c <= 'z')) || ((c >= 'A') && (c <= 'Z')) || ((c >= '0') && (c <= '9')) || (c == '_') || (c == '-')))
			return 0;
	}
	return 1;
}

static uint8_t makeModPath(const char *name, char *path, size_t pathSize)
{
	int length;
	if (!isModFilename(name))
		return 0;
	length = snprintf(path, pathSize, "%s/%s", MOD_DIRECTORY, name);
	return (length > 0) && ((size_t)length < pathSize);
}

void xs_stackchan_sdcard_list(xsMachine *the)
{
	DIR *directory;
	struct dirent *entry;
	xsVars(1);

	beginCardAccess();
	if (!ensureMounted())
		failCardAccess(the, "SD card mount failed");
	directory = opendir(MOD_DIRECTORY);
	if (!directory)
		failCardAccess(the, "MOD directory open failed");

	xsResult = xsNewArray(0);
	while ((entry = readdir(directory))) {
		char path[sizeof(MOD_DIRECTORY) + MOD_FILENAME_MAX + 1];
		struct stat info;
		if (!makeModPath(entry->d_name, path, sizeof(path)) || stat(path, &info) || !S_ISREG(info.st_mode))
			continue;
		xsVar(0) = xsString(entry->d_name);
		xsCall1(xsResult, xsID_push, xsVar(0));
	}
	closedir(directory);
	endCardAccess();
}

void xs_stackchan_sdcard_read(xsMachine *the)
{
	char path[sizeof(MOD_DIRECTORY) + MOD_FILENAME_MAX + 1];
	char *name = xsToString(xsArg(0));
	int maximumBytes = xsToInteger(xsArg(1));
	FILE *file;
	long byteLength;
	void *buffer;

	if ((maximumBytes <= 0) || !makeModPath(name, path, sizeof(path)))
		xsUnknownError("invalid MOD filename or size");
	beginCardAccess();
	if (!ensureMounted())
		failCardAccess(the, "SD card mount failed");
	file = fopen(path, "rb");
	if (!file)
		failCardAccess(the, "MOD file open failed");

	if (fseek(file, 0, SEEK_END) || ((byteLength = ftell(file)) <= 0) || (byteLength > maximumBytes) || fseek(file, 0, SEEK_SET)) {
		fclose(file);
		failCardAccess(the, "MOD file size is invalid");
	}
	xsResult = xsArrayBuffer(NULL, byteLength);
	buffer = xsToArrayBuffer(xsResult);
	if (fread(buffer, 1, byteLength, file) != (size_t)byteLength) {
		fclose(file);
		failCardAccess(the, "MOD file read failed");
	}
	fclose(file);
	endCardAccess();
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
