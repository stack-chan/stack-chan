/*
 * Copyright (c) 2026 Shinya Ishikawa
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

#include "xsmc.h"

#include "driver/i2c_master.h"

#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

#define STACKCHAN_CORES3_AMP_ADDRESS 0x36
#define STACKCHAN_CORES3_AMP_VOLUME_REGISTER 0x0c
#define STACKCHAN_CORES3_AMP_I2C_HZ 400000
#define STACKCHAN_CORES3_AMP_I2C_TIMEOUT_MS 100

void xs_audio_duplex_test_read_amp_volume_register(xsMachine *the)
{
	i2c_master_bus_handle_t bus = NULL;
	i2c_master_dev_handle_t device = NULL;
	i2c_device_config_t config = {
		.dev_addr_length = I2C_ADDR_BIT_LEN_7,
		.device_address = STACKCHAN_CORES3_AMP_ADDRESS,
		.scl_speed_hz = STACKCHAN_CORES3_AMP_I2C_HZ,
	};
	uint8_t registerAddress = STACKCHAN_CORES3_AMP_VOLUME_REGISTER;
	uint8_t response[2];
	esp_err_t result;

	(void)the;
	result = i2c_master_get_bus_handle(I2C_NUM_0, &bus);
	if (result != ESP_OK)
		xsUnknownError("CoreS3 internal I2C bus is unavailable");

	result = i2c_master_bus_add_device(bus, &config, &device);
	if (result != ESP_OK)
		xsUnknownError("unable to attach AW88298 readback handle");

	result = i2c_master_transmit_receive(
		device,
		&registerAddress,
		sizeof(registerAddress),
		response,
		sizeof(response),
		STACKCHAN_CORES3_AMP_I2C_TIMEOUT_MS
	);
	i2c_master_bus_rm_device(device);
	if (result != ESP_OK)
		xsUnknownError("unable to read AW88298 volume register");

	xsmcSetInteger(xsResult, ((uint16_t)response[0] << 8) | response[1]);
}

static void audioDuplexTestSetNumberProperty(
	xsMachine *the,
	xsSlot object,
	xsIdentifier identifier,
	xsNumberValue value
)
{
	xsmcSetNumber(xsVar(0), value);
	xsmcSet(object, identifier, xsVar(0));
}

void xs_audio_duplex_test_analyze_diagnostics(xsMachine *the)
{
	const int16_t *diagnostics;
	xsUnsignedValue bytes;
	int32_t requestedMaximumDelay;
	uint32_t sampleCount;
	uint32_t maximumDelay;
	int32_t bestDelay = 0;
	int32_t lag;
	uint32_t sample;
	uint64_t totalRawEnergy = 0;
	uint64_t totalReferenceEnergy = 0;
	uint64_t totalCleanEnergy = 0;
	uint64_t bestReferenceOverlapEnergy = 0;
	int64_t bestRawCrossCorrelation = 0;
	int64_t cleanCrossCorrelation = 0;
	double bestNormalizedCorrelation = 0;
	double bestScore = -1;
	double cleanNormalizedCorrelation = 0;
	double echoSuppressionDb;
	double erleDb;

	xsmcVars(1);
	xsmcGetBufferReadable(xsArg(0), (void **)&diagnostics, &bytes);
	if (!bytes || (bytes % (3 * sizeof(int16_t))))
		xsRangeError("AEC diagnostics must contain raw/reference/clean int16 triples");

	requestedMaximumDelay = xsmcToInteger(xsArg(1));
	if (requestedMaximumDelay < 0)
		xsRangeError("maximum delay must be non-negative");

	sampleCount = bytes / (3 * sizeof(int16_t));
	maximumDelay = (uint32_t)requestedMaximumDelay;
	if (maximumDelay >= sampleCount)
		maximumDelay = sampleCount - 1;

	for (sample = 0; sample < sampleCount; sample++) {
		int32_t raw = diagnostics[sample * 3];
		int32_t reference = diagnostics[(sample * 3) + 1];
		int32_t clean = diagnostics[(sample * 3) + 2];
		totalRawEnergy += (int64_t)raw * raw;
		totalReferenceEnergy += (int64_t)reference * reference;
		totalCleanEnergy += (int64_t)clean * clean;
	}

	for (lag = -(int32_t)maximumDelay; lag <= (int32_t)maximumDelay; lag++) {
		uint32_t rawStart = (lag > 0) ? (uint32_t)lag : 0;
		uint32_t referenceStart = (lag < 0) ? (uint32_t)-lag : 0;
		uint32_t overlap = sampleCount - (uint32_t)abs(lag);
		uint64_t rawOverlapEnergy = 0;
		uint64_t referenceOverlapEnergy = 0;
		int64_t crossCorrelation = 0;
		double normalizedCorrelation;
		double score;

		for (sample = 0; sample < overlap; sample++) {
			int32_t raw = diagnostics[((rawStart + sample) * 3)];
			int32_t reference =
				diagnostics[((referenceStart + sample) * 3) + 1];
			crossCorrelation += (int64_t)raw * reference;
			rawOverlapEnergy += (int64_t)raw * raw;
			referenceOverlapEnergy += (int64_t)reference * reference;
		}

		normalizedCorrelation = (rawOverlapEnergy && referenceOverlapEnergy)
			? ((double)crossCorrelation /
				sqrt((double)rawOverlapEnergy * (double)referenceOverlapEnergy))
			: 0;
		score = fabs(normalizedCorrelation);
		if (score > bestScore) {
			bestScore = score;
			bestDelay = lag;
			bestRawCrossCorrelation = crossCorrelation;
			bestReferenceOverlapEnergy = referenceOverlapEnergy;
			bestNormalizedCorrelation = normalizedCorrelation;
		}
	}

	if (bestReferenceOverlapEnergy) {
		uint32_t cleanStart = (bestDelay > 0) ? (uint32_t)bestDelay : 0;
		uint32_t referenceStart = (bestDelay < 0) ? (uint32_t)-bestDelay : 0;
		uint32_t overlap = sampleCount - (uint32_t)abs(bestDelay);
		uint64_t cleanOverlapEnergy = 0;

		for (sample = 0; sample < overlap; sample++) {
			int32_t clean = diagnostics[((cleanStart + sample) * 3) + 2];
			int32_t reference =
				diagnostics[((referenceStart + sample) * 3) + 1];
			cleanCrossCorrelation += (int64_t)clean * reference;
			cleanOverlapEnergy += (int64_t)clean * clean;
		}
		if (cleanOverlapEnergy)
			cleanNormalizedCorrelation =
				(double)cleanCrossCorrelation /
				sqrt((double)cleanOverlapEnergy * (double)bestReferenceOverlapEnergy);
	}

	echoSuppressionDb = 20.0 * log10(
		(fabs((double)bestRawCrossCorrelation) + 1.0) /
		(fabs((double)cleanCrossCorrelation) + 1.0)
	);
	erleDb = 10.0 * log10(
		((double)totalRawEnergy + 1.0) / ((double)totalCleanEnergy + 1.0)
	);

	xsmcSetNewObject(xsResult);
	audioDuplexTestSetNumberProperty(the, xsResult, xsID("sampleCount"), sampleCount);
	audioDuplexTestSetNumberProperty(the, xsResult, xsID("bestDelaySamples"), bestDelay);
	audioDuplexTestSetNumberProperty(
		the,
		xsResult,
		xsID("bestDelayMilliseconds"),
		((double)bestDelay * 1000.0) / 16000.0
	);
	audioDuplexTestSetNumberProperty(
		the,
		xsResult,
		xsID("rawReferenceCorrelation"),
		bestNormalizedCorrelation
	);
	audioDuplexTestSetNumberProperty(
		the,
		xsResult,
		xsID("cleanReferenceCorrelation"),
		cleanNormalizedCorrelation
	);
	audioDuplexTestSetNumberProperty(
		the,
		xsResult,
		xsID("correlatedEchoSuppressionDb"),
		echoSuppressionDb
	);
	audioDuplexTestSetNumberProperty(
		the,
		xsResult,
		xsID("rawRms"),
		sqrt((double)totalRawEnergy / sampleCount)
	);
	audioDuplexTestSetNumberProperty(
		the,
		xsResult,
		xsID("referenceRms"),
		sqrt((double)totalReferenceEnergy / sampleCount)
	);
	audioDuplexTestSetNumberProperty(
		the,
		xsResult,
		xsID("cleanRms"),
		sqrt((double)totalCleanEnergy / sampleCount)
	);
	audioDuplexTestSetNumberProperty(the, xsResult, xsID("erleDb"), erleDb);
}
