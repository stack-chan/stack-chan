#include "xsmc.h"
#include "mc.xs.h"
#include "xsHost.h"

void xs_resamplePCM16Mono(xsMachine *the)
{
	int16_t *input;
	int16_t *output;
	xsUnsignedValue inputBytes;
	xsUnsignedValue outputBytes;
	uint32_t inputOffset = xsmcToInteger(xsArg(1));
	uint32_t inputCount = xsmcToInteger(xsArg(2));
	uint32_t sourceRate = xsmcToInteger(xsArg(4));
	uint32_t targetRate = xsmcToInteger(xsArg(5));
	int32_t *state;
	xsUnsignedValue stateBytes;
	uint32_t phase;
	uint32_t inputStart = 0;
	int32_t previousSample;
	uint32_t available;
	uint32_t inputEnd;
	uint32_t outputCount = 0;

	if (!sourceRate || !targetRate || (sourceRate > 65535) || (targetRate > 65535))
		xsRangeError("invalid sample rate");
	xsmcGetBufferReadable(xsArg(0), (void **)&input, &inputBytes);
	xsmcGetBufferWritable(xsArg(3), (void **)&output, &outputBytes);
	xsmcGetBufferWritable(xsArg(6), (void **)&state, &stateBytes);
	if (stateBytes < (3 * sizeof(int32_t)))
		xsRangeError("resampler state too small");
	phase = (uint32_t)state[0];
	if (phase >= sourceRate)
		xsRangeError("invalid resampler phase");
	if ((inputOffset > (inputBytes >> 1)) || (inputCount > ((inputBytes >> 1) - inputOffset)))
		xsRangeError("input range out of bounds");
	if (!inputCount) {
		xsmcSetInteger(xsResult, 0);
		return;
	}
	input += inputOffset;

	/*
	 * Keep the final source sample until the next buffer arrives. This makes
	 * interpolation across MP3-frame boundaries identical to interpolation of
	 * one continuous PCM stream instead of duplicating the last sample of every
	 * frame and producing a periodic click.
	 */
	if (!state[2]) {
		previousSample = input[0];
		inputStart = 1;
		state[2] = 1;
	}
	else
		previousSample = (int16_t)state[1];

	available = inputCount - inputStart;
	inputEnd = available * targetRate;

	while (phase < inputEnd) {
		uint32_t inputIndex = phase / targetRate;
		uint32_t fraction = phase % targetRate;
		int32_t first = inputIndex ? input[inputStart + inputIndex - 1] : previousSample;
		int32_t second = input[inputStart + inputIndex];
		int64_t sample = ((int64_t)first * (targetRate - fraction)) + ((int64_t)second * fraction);
		if (outputCount >= (outputBytes >> 1))
			xsRangeError("output buffer too small");
		if (sample >= 0)
			sample += targetRate >> 1;
		else
			sample -= targetRate >> 1;
		output[outputCount++] = (int16_t)(sample / targetRate);
		phase += sourceRate;
	}
	phase -= inputEnd;
	state[0] = (int32_t)phase;
	state[1] = input[inputCount - 1];

	xsmcSetInteger(xsResult, (int32_t)outputCount);
}
