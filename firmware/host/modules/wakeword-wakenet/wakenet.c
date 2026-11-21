// SPDX-License-Identifier: Apache-2.0

#include "xsHost.h"
#include "xsmc.h"
#include "esp_heap_caps.h"
#include "esp_rom_crc.h"
#include "esp_wn_models.h"
#include "model_path.h"
#include "model-format.h"
#include "pcm-framer.h"
#include <stdatomic.h>
#include <stdlib.h>

extern const void *mcGetResource(void *machine, const char *path, size_t *size);

typedef struct {
	const esp_wn_iface_t *iface;
	srmodel_list_t *models;
	model_iface_data_t *detector;
	size_t frameSamples;
	size_t used;
	int16_t *frame;
} WakeNet;

/* The pinned vendor loader owns a process-wide registry. The opted-in host
 * has no other ESP-SR users. A second VM or object must not replace it. */
static atomic_bool wakeRegistryOwned;
/* Guarded by wakeRegistryOwned; the built-in resource is immutable. */
static bool wakeAssetChecked;

void xs_stackchan_wakenet_delete(void *data)
{
	WakeNet *wake = data;
	if (!wake) return;
	if (wake->detector) wake->iface->destroy(wake->detector);
	if (wake->models) srmodel_host_deinit(wake->models);
	free(wake->frame);
	free(wake);
	atomic_store(&wakeRegistryOwned, false);
}

void xs_stackchan_wakenet_start(xsMachine *the)
{
	if (xsmcGetHostData(xsThis)) return;

	size_t size = 0;
	/* Use just the generated host resources, bypassing the XS archive/MOD
	 * lookup used by new Resource(). The model is immutable for app life. */
	const uint8_t *model = mcGetResource(the, WAKE_MODEL_RESOURCE, &size);
	if (!wakeModelValid(model, size)) xsUnknownError("invalid built-in WakeNet model");

	/* srmodel_load has unchecked metadata allocations. Reserve a generous
	 * availability floor before invoking it; it is not an OOM guarantee. */
	if (heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT) < 4096)
		xsUnknownError("insufficient memory for WakeNet model");
	bool expected = false;
	if (!atomic_compare_exchange_strong(&wakeRegistryOwned, &expected, true))
		xsUnknownError("WakeNet is already in use");
	if (get_static_srmodels()) {
		atomic_store(&wakeRegistryOwned, false);
		xsUnknownError("ESP-SR model registry is already in use");
	}
	/* The packager pins SHA-256. Also reject accidental corruption of the
	 * immutable coefficient bytes before the first runtime load. */
	if (!wakeAssetChecked && esp_rom_crc32_le(0, model, size) != WAKE_MODEL_CRC32) {
		atomic_store(&wakeRegistryOwned, false);
		xsUnknownError("invalid built-in WakeNet model checksum");
	}
	wakeAssetChecked = true;

	WakeNet *wake = calloc(1, sizeof(*wake));
	if (!wake) {
		atomic_store(&wakeRegistryOwned, false);
		xsUnknownError("no memory for WakeNet");
	}
	const char *error = "WakeNet could not load the built-in model";
	wake->models = srmodel_load(model);
	if (!wake->models || wake->models->num != 1 ||
		strcmp(wake->models->model_name[0], WAKE_MODEL_NAME))
		goto fail;

	const char *name = wake->models->model_name[0];
	wake->iface = esp_wn_handle_from_name(name);
	if (!wake->iface || !wake->iface->create || !wake->iface->destroy ||
		!wake->iface->get_samp_rate || !wake->iface->get_channel_num ||
		!wake->iface->get_samp_chunksize || !wake->iface->detect || !wake->iface->clean)
		goto fail;

	wake->detector = wake->iface->create(name, DET_MODE_90);
	if (!wake->detector) goto fail;
	int samples = wake->iface->get_samp_chunksize(wake->detector);
	if (wake->iface->get_samp_rate(wake->detector) != WAKE_MODEL_RATE ||
		wake->iface->get_channel_num(wake->detector) != 1 ||
		samples < 1 || samples > WAKE_MAX_CHUNK_SAMPLES) {
		error = "unsupported WakeNet PCM geometry";
		goto fail;
	}
	wake->frameSamples = samples;
	wake->frame = malloc(wake->frameSamples * sizeof(*wake->frame));
	if (!wake->frame) {
		error = "no memory for WakeNet PCM frame";
		goto fail;
	}
	xsmcSetHostData(xsThis, wake);
	return;

fail:
	xs_stackchan_wakenet_delete(wake);
	xsUnknownError("%s", error);
}

static WakeNet *wakeActive(xsMachine *the)
{
	WakeNet *wake = xsmcGetHostData(xsThis);
	if (!wake) xsUnknownError("WakeNet is not started");
	return wake;
}

void xs_stackchan_wakenet_chunk_samples(xsMachine *the)
{
	xsmcSetInteger(xsResult, wakeActive(the)->frameSamples);
}

static bool wakeDetectFrame(void *context, int16_t *samples)
{
	WakeNet *wake = context;
	return wake->iface->detect(wake->detector, samples) == WAKENET_DETECTED;
}

void xs_stackchan_wakenet_detect(xsMachine *the)
{
	WakeNet *wake = wakeActive(the);
	if (!xsmcArgc) xsTypeError("WakeNet expects a PCM buffer");
	const uint8_t *input;
	xsUnsignedValue bytes;
	xsmcGetBufferReadable(xsArg(0), (void **)&input, &bytes);
	if ((bytes & 1u) || bytes > WAKE_MAX_INPUT_BYTES)
		xsRangeError("invalid WakeNet PCM buffer length");
	xsmcSetBoolean(xsResult,
		wakeFeed(wake->frame, wake->frameSamples, &wake->used, input, bytes / 2, wakeDetectFrame, wake));
}

void xs_stackchan_wakenet_reset(xsMachine *the)
{
	WakeNet *wake = wakeActive(the);
	wake->used = 0;
	wake->iface->clean(wake->detector);
}

void xs_stackchan_wakenet_close(xsMachine *the)
{
	WakeNet *wake = xsmcGetHostData(xsThis);
	if (!wake) return;
	xsmcSetHostData(xsThis, NULL);
	xs_stackchan_wakenet_delete(wake);
}
