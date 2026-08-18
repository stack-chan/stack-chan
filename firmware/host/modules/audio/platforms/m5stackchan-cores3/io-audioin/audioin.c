/*
 * Stack-chan overlay of Moddable modules/io/audioin/esp32/audioin.c.
 * Opens the RX channel in READY and enables it only after start().
 *
 * Copyright (c) 2024-2025 Moddable Tech, Inc.
 *
 *   This file is part of the Moddable SDK Runtime.
 *
 *   The Moddable SDK Runtime is free software: you can redistribute it and/or modify
 *   it under the terms of the GNU Lesser General Public License as published by
 *   the Free Software Foundation, either version 3 of the License, or
 *   (at your option) any later version.
 *
 *   The Moddable SDK Runtime is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *   GNU Lesser General Public License for more details.
 * 
 *   You should have received a copy of the GNU Lesser General Public License
 *   along with the Moddable SDK Runtime.  If not, see <http://www.gnu.org/licenses/>.  
 *
 */

#include "xsmc.h"
#include "xsHost.h"
#include "mc.xs.h"
#include "mc.defines.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "driver/i2s_std.h"
#include "driver/i2s_pdm.h"
#include "esp_adc/adc_continuous.h"
#include "soc/soc_caps.h"

#include "builtinCommon.h"

#ifndef MODDEF_AUDIOIN_I2S_NUM
	#define MODDEF_AUDIOIN_I2S_NUM			(0)
#endif
#ifndef MODDEF_AUDIOIN_I2S_BCK_PIN
	#define MODDEF_AUDIOIN_I2S_BCK_PIN		(32)
#endif
#ifndef MODDEF_AUDIOIN_I2S_LR_PIN
	#define MODDEF_AUDIOIN_I2S_LR_PIN		(33)
#endif
#ifndef MODDEF_AUDIOIN_I2S_MCK_PIN
	#define MODDEF_AUDIOIN_I2S_MCK_PIN		(I2S_GPIO_UNUSED)
#endif
#ifndef MODDEF_AUDIOIN_I2S_FORMAT_I2S
	#define MODDEF_AUDIOIN_I2S_FORMAT_I2S	(0)
#endif
#ifndef MODDEF_AUDIOIN_I2S_DATAIN
	#define MODDEF_AUDIOIN_I2S_DATAIN		(27)
#endif
#ifndef MODDEF_AUDIOIN_I2S_ADC
	#define MODDEF_AUDIOIN_I2S_ADC			(0)
#endif
#ifndef MODDEF_AUDIOIN_I2S_MULTIPLIER
	#define MODDEF_AUDIOIN_I2S_MULTIPLIER	(1)
#endif
#ifndef MODDEF_AUDIOIN_I2S_BIAS
	#define MODDEF_AUDIOIN_I2S_BIAS			(0)
#endif
#ifndef MODDEF_AUDIOIN_I2S_SLOT
	#define MODDEF_AUDIOIN_I2S_SLOT (I2S_STD_SLOT_RIGHT)
#endif
#ifndef MODDEF_AUDIOIN_NUMCHANNELS
	#define MODDEF_AUDIOIN_NUMCHANNELS (1)
#endif

#if MODDEF_AUDIOIN_I2S_ADC
	#if MODDEF_AUDIOIN_SAMPLERATE < SOC_ADC_SAMPLE_FREQ_THRES_LOW
		#warning "SOC reqires higher audioin sample rate. automatically increasing."
		#undef MODDEF_AUDIOIN_SAMPLERATE
		#define MODDEF_AUDIOIN_SAMPLERATE SOC_ADC_SAMPLE_FREQ_THRES_LOW
	#elif MODDEF_AUDIOIN_SAMPLERATE > SOC_ADC_SAMPLE_FREQ_THRES_HIGH
		#warning "SOC requires lower audioin sample rate. automatically decreasing."
		#undef MODDEF_AUDIOIN_SAMPLERATE
		#define MODDEF_AUDIOIN_SAMPLERATE SOC_ADC_SAMPLE_FREQ_THRES_HIGH
	#endif
#endif

#if MODDEF_AUDIOIN_I2S_PDM
	uint8_t gPDMAudioOutBusy __attribute__((weak)) = 0;
	uint8_t gPDMAudioInBusy = 0;
#endif

#define kADCSampleLength	(256)

#define AUDIO_IN_TIMEOUT	50
#define MAX_INPUT_BLOCK		2048
#define AUDIO_IN_BUFFERSIZE	(8192 * 2)
#define AUDIO_IN_DMA_FRAMES	240

enum {
	kStateIdle = 0,
	kStateRecording = 1,
	kStateClosing = 2,
	kStateTerminated = 3
};

struct AudioInputRecord {
	xsMachine	*the;
	xsSlot		object;
	xsSlot		*onReadable;
	uint8_t		pendingCallback;

	uint8_t		numChannels;
	uint32_t	sampleRate;
	uint32_t	bitsPerSample;

#if MODDEF_AUDIOIN_I2S_ADC
	adc_continuous_handle_t handle;
#else
	i2s_chan_handle_t handle;
#endif

	SemaphoreHandle_t	mutex;
	TaskHandle_t		task;
	uint8_t		state;

	uint8_t		*recPos;
	uint8_t		*playPos;
	uint8_t		*endPos;
	uint32_t	bufferSize;
	uint32_t	dmaReadBytes;
	uint8_t		buffer[];
};
typedef struct AudioInputRecord AudioInputRecord;
typedef struct AudioInputRecord *AudioInput;

#if 0 && mxInstrument
	#include "modInstrumentation.h"
	#define countBytes	modInstrumentationAdjust
#else
	#define countBytes(what, value)
#endif

static void xs_audioin_mark(xsMachine* the, void* it, xsMarkRoot markRoot);
static void audioInLoop(void *pvParameter);
static void deliverCallbacks(void *the, void *refcon, uint8_t *message, uint16_t messageLength);

/*
static void blockDump(uint8_t *block, uint32_t amt)
{
	char debugStr[128];
	int i;
	uint16_t *blk = (uint16_t*)block;
	char *pos = debugStr;

	for (i=0; i<amt/2; i++) {
		pos += sprintf(pos, "%04x ", *blk++);
		if (i % 16 == 15) {
			modLog_transmit(debugStr);
			pos = debugStr;
		}
	}
	if (pos != debugStr)
		modLog_transmit(debugStr);
}
*/

static const xsHostHooks xsAudioInHooks = {
	xs_audioin_destructor,
	xs_audioin_mark,
	C_NULL
};

static int amtReadable(AudioInput input) {
	int p = input->recPos - input->playPos;
	if (p < 0)
		p += input->bufferSize;
	return p;
}

#if !MODDEF_AUDIOIN_I2S_ADC && !MODDEF_AUDIOIN_I2S_PDM
static void audioInCloseChannel(AudioInput input)
{
	if (!input->handle)
		return;
	if (ESP_OK == i2s_del_channel(input->handle))
		input->handle = C_NULL;
}

static esp_err_t audioInOpenStdChannel(AudioInput input)
{
	esp_err_t err;
	i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(MODDEF_AUDIOIN_I2S_NUM, I2S_ROLE_MASTER);
	i2s_std_config_t rx_std_cfg = {
		.clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(input->sampleRate),
#if MODDEF_AUDIOIN_I2S_FORMAT_I2S
		.slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT,
			(2 == MODDEF_AUDIOIN_NUMCHANNELS) ? I2S_SLOT_MODE_STEREO : I2S_SLOT_MODE_MONO),
#else
		.slot_cfg = I2S_STD_MSB_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT,
			(2 == MODDEF_AUDIOIN_NUMCHANNELS) ? I2S_SLOT_MODE_STEREO : I2S_SLOT_MODE_MONO),
#endif
		.gpio_cfg = {
			.mclk = MODDEF_AUDIOIN_I2S_MCK_PIN,
			.bclk = MODDEF_AUDIOIN_I2S_BCK_PIN,
			.ws = MODDEF_AUDIOIN_I2S_LR_PIN,
			.dout = I2S_GPIO_UNUSED,
			.din = MODDEF_AUDIOIN_I2S_DATAIN,
			.invert_flags = {
				.mclk_inv = false,
				.bclk_inv = false,
				.ws_inv = false,
			}
		}
	};

	chan_cfg.dma_desc_num = 6;
	chan_cfg.dma_frame_num = AUDIO_IN_DMA_FRAMES;
	input->handle = C_NULL;
	err = i2s_new_channel(&chan_cfg, C_NULL, &input->handle);
	if (ESP_OK != err) {
		input->handle = C_NULL;
		return err;
	}

	rx_std_cfg.slot_cfg.slot_mask = (2 == MODDEF_AUDIOIN_NUMCHANNELS)
		? I2S_STD_SLOT_BOTH
		: MODDEF_AUDIOIN_I2S_SLOT;
	err = i2s_channel_init_std_mode(input->handle, &rx_std_cfg);
	if (ESP_OK != err) {
		audioInCloseChannel(input);
		return err;
	}
	return ESP_OK;
}
#endif

void xs_audioin_constructor(xsMachine *the)
{
	uint8_t format = kIOFormatBuffer;
	int32_t bitsPerSample = 16;
	int32_t numChannels = 1;
	int32_t sampleRate = 8000;
	uint32_t bytesPerFrame, bufferSize;
	AudioInput input;
	int i;
	xsmcVars(1);

#ifdef MODDEF_AUDIOIN_BITSPERSAMPLE
	bitsPerSample = MODDEF_AUDIOIN_BITSPERSAMPLE;
#endif
#ifdef MODDEF_AUDIOIN_NUMCHANNELS
	numChannels = MODDEF_AUDIOIN_NUMCHANNELS;
#endif
#ifdef MODDEF_AUDIOIN_SAMPLERATE
	sampleRate = MODDEF_AUDIOIN_SAMPLERATE;
#endif
	format = builtinInitializeFormat(the, format);
	if (kIOFormatBuffer != format)
		xsRangeError("invalid format");
	if (xsmcGet(xsVar(0), xsArg(0), xsID_bitsPerSample))
		bitsPerSample = xsmcToInteger(xsVar(0));
	if (xsmcGet(xsVar(0), xsArg(0), xsID_channels))
		numChannels = xsmcToInteger(xsVar(0));
	if (xsmcGet(xsVar(0), xsArg(0), xsID_sampleRate))
		sampleRate = xsmcToInteger(xsVar(0));
	if ((8 != bitsPerSample) && (16 != bitsPerSample))
		xsRangeError("invalid bits per sample");
	if ((1 != numChannels) && (2 != numChannels))
		xsRangeError("invalid number of channels");
	if ((sampleRate < 8000) || (sampleRate > 48000))
		xsRangeError("invalid sample rate");
	if (xsmcGet(xsVar(0), xsArg(0), xsID_audioType)) {
		char *type = xsmcToString(xsVar(0));
		if (c_strcmp(type, "LPCM"))
			xsRangeError("invalid audioType");
	}


#if MODDEF_AUDIOIN_I2S_PDM
	if (gPDMAudioInBusy)
		xsUnknownError("already in use");

	if (gPDMAudioOutBusy)
		xsUnknownError("pdm already in use by audioout");
#endif

	bytesPerFrame = (bitsPerSample * numChannels) >> 3;
//	bufferSize = (bytesPerFrame * sampleRate) >> 5; //??
	bufferSize = AUDIO_IN_BUFFERSIZE;

	input = (AudioInput)c_calloc(1, sizeof(AudioInputRecord) + bufferSize);
	if (!input)
		xsRangeError("not enough memory");
	xsmcSetHostData(xsThis, input);
	xsSetHostHooks(xsThis, (xsHostHooks *)&xsAudioInHooks);

	input->state = kStateIdle;
	input->bufferSize = bufferSize;
	input->recPos = input->buffer;
	input->playPos = input->buffer;
	input->endPos = input->buffer + bufferSize;
	input->numChannels = numChannels;

	input->the = the;
	input->object = xsThis;
	xsRemember(input->object);
	input->onReadable = builtinGetCallback(the, xsID_onReadable);	
	builtinInitializeTarget(the);

	input->sampleRate = sampleRate;
	input->bitsPerSample = bitsPerSample;

#if MODDEF_AUDIOIN_I2S_PDM
	gPDMAudioInBusy = 1;
#endif

	input->dmaReadBytes = AUDIO_IN_DMA_FRAMES * ((1 == numChannels) ? 4 : bytesPerFrame);

#if !MODDEF_AUDIOIN_I2S_ADC && !MODDEF_AUDIOIN_I2S_PDM
	{
		esp_err_t err = audioInOpenStdChannel(input);
		if (ESP_OK != err) {
			xsForget(input->object);
			c_free(input);
			xsmcSetHostData(xsThis, C_NULL);
			xsUnknownError("I2S input setup failed");
		}
	}
#endif

	input->mutex = xSemaphoreCreateMutex();
	if (!input->mutex) {
#if !MODDEF_AUDIOIN_I2S_ADC && !MODDEF_AUDIOIN_I2S_PDM
		audioInCloseChannel(input);
#endif
		xsForget(input->object);
		c_free(input);
		xsmcSetHostData(xsThis, C_NULL);
		xsUnknownError("no memory for AudioIn mutex");
	}
	if (pdPASS != xTaskCreate(audioInLoop, "audioInput", 4096 + 1024, input, 10, &input->task)) {
#if !MODDEF_AUDIOIN_I2S_ADC && !MODDEF_AUDIOIN_I2S_PDM
		audioInCloseChannel(input);
#endif
		vSemaphoreDelete(input->mutex);
		xsForget(input->object);
		c_free(input);
		xsmcSetHostData(xsThis, C_NULL);
		xsUnknownError("AudioIn task create failed");
	}
}

void xs_audioin_destructor(void *it)
{
	if (it) {
		AudioInput input = it;
		input->state = kStateClosing;
		if (input->task) {
			xTaskNotify(input->task, kStateClosing, eSetValueWithOverwrite);
			while (kStateClosing == input->state)
				modDelayMilliseconds(1);

			vSemaphoreDelete(input->mutex);
		}

		if (input->pendingCallback) {
			input->state = kStateTerminated;
			return;
		}

		c_free(input);
	}
}

void xs_audioin_close(xsMachine *the)
{
	AudioInput input = xsmcGetHostData(xsThis);
	if (input && xsmcGetHostDataValidate(xsThis, (void *)&xsAudioInHooks)) {
		xsmcSetHostData(xsThis, C_NULL);
		xsmcSetHostDestructor(xsThis, C_NULL);
		xsForget(input->object);
		xs_audioin_destructor(input);
	}
}

void xs_audioin_mark(xsMachine* the, void* it, xsMarkRoot markRoot)
{
	AudioInput input = it;
	if (input->onReadable)
		(*markRoot)(the, input->onReadable);
}

void xs_audioin_level(xsMachine *the)
{
	AudioInput input = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioInHooks);
	xsUnsignedValue requested;
	uint8_t* buffer;
	int16_t* samples;
	int32_t	i;
	double ave = 0.0;

	xsResult = xsArg(0);
	xsmcGetBufferReadable(xsResult, (void **)&buffer, &requested);

	requested /= 2;
	samples = (int16_t*)buffer;
	
	for (i=0; i<requested; i++) {
		int16_t sample = samples[i];
		if (sample < 0) sample = -sample;
		ave += sample;
	}

	int result = c_round(ave / requested);

	xsmcSetInteger(xsResult, result);
}

void xs_audioin_read(xsMachine *the)
{
	AudioInput input = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioInHooks);
	esp_err_t err;
	xsUnsignedValue available, requested;
	xsBooleanValue allocate = 1;
	uint8_t* buffer;

	xSemaphoreTake(input->mutex, portMAX_DELAY);
	available = amtReadable(input);
	xSemaphoreGive(input->mutex);

	if (input->numChannels == 1)
		available /= 2;					// strip left channel

	if (0 == available)
		return;		// read returns undefined if nothing available

	if (0 == xsmcArgc)
		requested = available;
	else if (xsReferenceType == xsmcTypeOf(xsArg(0))) {
		xsResult = xsArg(0);
		xsmcGetBufferWritable(xsResult, (void **)&buffer, &requested);
		xsmcSetInteger(xsResult, requested);
		allocate = 0;
	}
	else
		requested = xsmcToInteger(xsArg(0));

	if ((requested <= 0) || (requested > available))
		xsUnknownError("invalid size");

	if (allocate)
		buffer = xsmcSetArrayBuffer(xsResult, C_NULL, requested);

	countBytes(AudioInConsumed, requested);

	double bias = 0.0;
	int16_t	*samples = (int16_t	*)buffer;

	xsUnsignedValue remaining = requested;
	xSemaphoreTake(input->mutex, portMAX_DELAY);
	if (input->recPos < input->playPos) {
		available = input->endPos - input->playPos;
		while ((remaining > 0) && (input->playPos < input->endPos)) {
			if (input->numChannels == 2) {
				*samples = (*(uint16_t*)input->playPos);
				bias += *samples++;
				input->playPos += 2;
				*samples = (*(uint16_t*)input->playPos);
				bias += *samples++;
				input->playPos += 2;
				remaining -= 4;
			}
			else {
				*samples = (*(uint32_t*)input->playPos) & 0xffff;		// take the bottom 16 bits
				bias += *samples++;
				input->playPos += 4;
				remaining -= 2;
			}
		}
		if (input->playPos == input->endPos)
			input->playPos = input->buffer;
	}
	if (input->recPos != input->playPos) {
		while (input->recPos > input->playPos) {
			if (0 == remaining)
				break;
			if (input->numChannels == 2) {
				*samples = *((uint16_t*)input->playPos);
				bias += *samples++;
				input->playPos += 2;
				*samples = *((uint16_t*)input->playPos);
				bias += *samples++;
				input->playPos += 2;
				remaining -= 4;
			}
			else {
				*samples = (*(uint32_t*)input->playPos) & 0xffff;		// take the bottom 16 bits
				bias += *samples++;
				input->playPos += 4;
				remaining -= 2;
			}
		}
	}
	xSemaphoreGive(input->mutex);

	int32_t i;
	samples = (uint16_t *)buffer;
	requested /= 2;		// samples
	bias /= requested;

#if (1 != MODDEF_AUDIOIN_I2S_MULTIPLIER) || MODDEF_AUDIOIN_I2S_BIAS
	for (i=0; i<requested; i++) {
#if MODDEF_AUDIOIN_I2S_BIAS
		int32_t sample = samples[i] - bias;
#else
		int32_t sample = samples[i];
#endif
		sample *= MODDEF_AUDIOIN_I2S_MULTIPLIER;
		if (sample > 32767) 		// clip
			sample = 32767;
		else if (sample < -32768)
			sample = -32768;
		samples[i] = (int16_t)sample;
	}
#endif
}

void deliverCallbacks(void *the, void *refcon, uint8_t *message, uint16_t messageLength)
{
	AudioInput input = refcon;
	uint32_t bytes_read;

	if (kStateTerminated == input->state) {
		c_free(input);
		return;
	} 

	xsBeginHost(input->the);

	bytes_read = amtReadable(input);
	if (input->numChannels == 1)		// only lower 16 bits
		bytes_read /= 2;

	if (0 != bytes_read) {
		xsResult = xsAccess(input->object);
		xsCallFunction1(xsReference(input->onReadable), xsResult, xsInteger(bytes_read));
	}

	input->pendingCallback = 0;

	xsEndHost(input->the);
}

void audioInLoop(void *pvParameter)
{
	AudioInput input = pvParameter;
	uint8_t stopped = true, enabled = false;

	if (input->handle)
		goto ready;

// ### HW CONFIGURATION
#if MODDEF_AUDIOIN_I2S_ADC
#error untested
	adc_continuous_handle_t adcHandle;
	adc_continuous_handle_cfg_t adc_config = {
		.max_store_buf_size = 1024,
		.conv_frame_size = kADCSampleLength,
	};
	ESP_ERROR_CHECK(adc_continuous_new_handle(&adc_config, &adcHandle));

	adc_continuous_config_t dig_cfg = {
		.sample_freq_hz = input->sampleRate,
		.conv_mode = ADC_CONF_SINGLE_UNIT_1,
		.format = ADC_DIGI_OUTPUT_FORMAT_TYPE1,
	};

	adc_digi_pattern_config_t adc_pattern[1] = {0};
	adc_pattern[0].atten = ADC_ATTEN_DB_11;
	adc_pattern[0].channel = ADC_CHANNEL_6;		//@@ config
	adc_pattern[0].unit = ADC_UNIT_1;			//@@ config
	adc_pattern[0].bit_width = ADC_BITWIDTH_12;
	dig_cfg.pattern_num = 1;
	dig_cfg.adc_pattern = adc_pattern;
	ESP_ERROR_CHECK(adc_continuous_config(adcHandle, &dig_cfg));

	ESP_ERROR_CHECK(adc_continuous_start(adcHandle));
	input->handle = adcHandle;
#else
	esp_err_t err;

	i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(MODDEF_AUDIOIN_I2S_NUM, I2S_ROLE_MASTER);
	err = i2s_new_channel(&chan_cfg, C_NULL, &input->handle);
	if (err) modLog("i2s_new_channel failed");

#if MODDEF_AUDIOIN_I2S_PDM
	i2s_pdm_rx_config_t pdm_rx_cfg = {
		.clk_cfg = I2S_PDM_RX_CLK_DEFAULT_CONFIG(input->sampleRate),
		.slot_cfg = I2S_PDM_RX_SLOT_DEFAULT_CONFIG(
				input->bitsPerSample == 8 ? I2S_DATA_BIT_WIDTH_8BIT : I2S_DATA_BIT_WIDTH_16BIT,
				I2S_SLOT_MODE_MONO),
		.gpio_cfg = {
			.clk = MODDEF_AUDIOIN_I2S_LR_PIN,
			.din = MODDEF_AUDIOIN_I2S_DATAIN,
			.invert_flags = {
				.clk_inv = false,
			}
		}
	};

	pdm_rx_cfg.slot_cfg.slot_mask = MODDEF_AUDIOIN_I2S_SLOT;
	pdm_rx_cfg.clk_cfg.dn_sample_mode = I2S_PDM_DSR_16S;

	err = i2s_channel_init_pdm_rx_mode(input->handle, &pdm_rx_cfg);
	if (err) {
		i2s_del_channel(input->handle);
		input->handle = C_NULL;
		modLog("i2s_channel_init_pdm_rx_mode failed");
	}
#else
	i2s_std_config_t rx_std_cfg = {
		.clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(input->sampleRate),
#if MODDEF_AUDIOIN_I2S_FORMAT_I2S
		.slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT,
			(2 == MODDEF_AUDIOIN_NUMCHANNELS) ? I2S_SLOT_MODE_STEREO : I2S_SLOT_MODE_MONO),
#else
		.slot_cfg = I2S_STD_MSB_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT,
			(2 == MODDEF_AUDIOIN_NUMCHANNELS) ? I2S_SLOT_MODE_STEREO : I2S_SLOT_MODE_MONO),
#endif
		.gpio_cfg = {
			.mclk = MODDEF_AUDIOIN_I2S_MCK_PIN,
			.bclk = MODDEF_AUDIOIN_I2S_BCK_PIN,
			.ws = MODDEF_AUDIOIN_I2S_LR_PIN,
			.dout = I2S_GPIO_UNUSED,
			.din = MODDEF_AUDIOIN_I2S_DATAIN,
			.invert_flags = {
				.mclk_inv = false,
				.bclk_inv = false,
				.ws_inv = false,
			}
		}
	};
	rx_std_cfg.slot_cfg.slot_mask = (2 == MODDEF_AUDIOIN_NUMCHANNELS)
		? I2S_STD_SLOT_BOTH
		: MODDEF_AUDIOIN_I2S_SLOT; 		//@@

	err = i2s_channel_init_std_mode(input->handle, &rx_std_cfg);
	if (err) {
		if (ESP_OK == i2s_del_channel(input->handle))
			input->handle = C_NULL;
		modLog("i2s_channel_init failed");
	}
#endif

	/* Leave the RX channel in READY until start(). Enabling here drives BCLK/WS
	 * while ChatAudioIO still considers the microphone idle. */
	enabled = false;
#endif

ready:
	if (C_NULL == input->handle)
		goto done;

	while (true) {
		size_t bytes_read = 0;

		if (kStateRecording != input->state) {
			uint32_t newState;

			if (!stopped) {
#if MODDEF_AUDIOIN_I2S_ADC
				adc_continuous_stop(input->handle);
#else
				if (enabled)
					i2s_channel_disable(input->handle);
				enabled = false;
#endif
				stopped = true;

				input->playPos = input->recPos = input->buffer;
			}

			if ((kStateClosing == input->state) || (kStateTerminated == input->state))
				break;

			xTaskNotifyWait(0, 0, &newState, portMAX_DELAY);
			continue;
		}

		if (stopped) {
#if MODDEF_AUDIOIN_I2S_ADC
			adc_continuous_enable(input->handle);
#else
			if (!enabled)
				i2s_channel_enable(input->handle);
			enabled = true;
#endif

			stopped = false;
		}

#if MODDEF_AUDIOIN_I2S_ADC
#error untested
		uint32_t use = sizeof(input);
		uint32_t needed = requested * sizeof(adc_digi_output_data_t);
		if (use > needed) use = needed;
		uint32_t used;

		err = adc_continuous_read(input->handle, input, use, &used, 17);
		if (err) break;

		used /= sizeof(adc_digi_output_data_t);
		requested -= used;

        adc_digi_output_data_t *in = (adc_digi_output_data_t *)input;
#if 8 == MODDEF_AUDIOIN_BITSPERSAMPLE
		uint8_t *out = (uint8_t *)buffer;
		while (used--) {
			*out++ in->type1.data >> 4;
			in++;
		}
		samples = (void *)out;
#else // 16 == MODDEF_AUDIOIN_BITSPERSAMPLE
		uint16_t *out = (uint16_t *)buffer;
		while (used--) {
			*out++ = (in->type1.data - 2048) * 8;
			in++;
		}
		samples = (void *)out;
#endif
    
#elif MODDEF_AUDIOIN_I2S_PDM && (8 == MODDEF_AUDIOIN_BITSPERSAMPLE)
   		int8_t *out = buffer;
		int i;
		while (sampleCount) {
			const int tmpCount = 512;
			int16_t tmp[tmpCount];
			int use = sampleCount;
			if (use > tmpCount)
				use = tmpCount;
			err = i2s_channel_read(input->handle, (char *)tmp, use << 1, &bytes_read, AUDIO_IN_TIMEOUT);
			if (err) break;

			for (i=0; i < use; i++)
				*out++ = (tmp[i] >> 8) ^ 0x80;
			sampleCount -= use;
		}
#else
		xSemaphoreTake(input->mutex, portMAX_DELAY);
		uint32_t	amt;
		if (input->playPos > input->recPos)
			amt = input->playPos - input->recPos;
		else
			amt = input->endPos - input->recPos;
		if (amt == 0) {
			amt = input->playPos - input->buffer;
			input->recPos = input->buffer;
		}
		xSemaphoreGive(input->mutex);
		if (input->dmaReadBytes && (amt > input->dmaReadBytes))
			amt = input->dmaReadBytes;
		amt = (amt > MAX_INPUT_BLOCK) ? MAX_INPUT_BLOCK : amt;
		if (input->dmaReadBytes)
			amt -= (amt % input->dmaReadBytes);
		if (amt > 0) {
			err = i2s_channel_read(input->handle, input->recPos, amt, &bytes_read, AUDIO_IN_TIMEOUT);
			if (ESP_ERR_TIMEOUT == err)
				continue;
			if ((ESP_OK != err) || (0 == bytes_read) ||
				(input->dmaReadBytes && (bytes_read % input->dmaReadBytes)))
				continue;
			xSemaphoreTake(input->mutex, portMAX_DELAY);
			input->recPos += bytes_read;
			xSemaphoreGive(input->mutex);
		}
#endif

		if (input->onReadable && (bytes_read > 0)) {
			if (!input->pendingCallback) {
				input->pendingCallback = 1;
				modMessagePostToMachine(input->the, C_NULL, 0, deliverCallbacks, input);
			}
		}

		countBytes(AudioInRead, bytes_read);
	}

	// ## HW shutdown
	if (input->handle) {
#if MODDEF_AUDIOIN_I2S_ADC
		adc_continuous_deinit(input->handle);
		input->handle = C_NULL;
#else
		if (enabled)
			i2s_channel_disable(input->handle);
		if (ESP_OK == i2s_del_channel(input->handle))
			input->handle = C_NULL;
#endif
	}

done:
#if MODDEF_AUDIOIN_I2S_PDM
	gPDMAudioInBusy = 0;
#endif

	input->state = kStateTerminated;
	input->task = C_NULL;

	vTaskDelete(C_NULL);
}

void xs_audioin_start(xsMachine *the)
{
	AudioInput input = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioInHooks);
	input->state = kStateRecording;
	xTaskNotify(input->task, kStateRecording, eSetValueWithOverwrite);
}

void xs_audioin_stop(xsMachine *the)
{
	AudioInput input = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioInHooks);
	input->state = kStateIdle;
	xTaskNotify(input->task, kStateIdle, eSetValueWithOverwrite);
}

void xs_audioin_get_format(xsMachine *the)
{
	xsmcGetHostDataValidate(xsThis, (void *)&xsAudioInHooks);
	builtinGetFormat(the, kIOFormatBuffer);
}

void xs_audioin_set_format(xsMachine *the)
{
	xsmcGetHostDataValidate(xsThis, (void *)&xsAudioInHooks);
	uint8_t format = builtinSetFormat(the);
	if (kIOFormatBuffer != format)
		xsRangeError("invalid format");
}

void xs_audioin_get_bitsPerSample(xsMachine *the)
{
	AudioInput input = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioInHooks);
	xsmcSetInteger(xsResult, input->bitsPerSample);
}

void xs_audioin_get_channels(xsMachine *the)
{
	AudioInput input = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioInHooks);
	xsmcSetInteger(xsResult, input->numChannels);
}

void xs_audioin_get_sampleRate(xsMachine *the)
{
	AudioInput input = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioInHooks);
	xsmcSetInteger(xsResult, input->sampleRate);
}
