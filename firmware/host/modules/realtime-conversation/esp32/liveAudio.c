// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

#include "xsHost.h"
#include "xsmc.h"
#include "esp_timer.h"
#include "io-performance.h"
#include "esp_webrtc.h"
#include "liveAudio.h"
#include "driver/i2s_std.h"
#include "esp_heap_caps.h"
#ifndef CONFIG_IDF_TARGET_ESP32S3
#include "esp_aec.h"
#endif
#include "esp_ae_rate_cvt.h"
#include "audio_render.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/stream_buffer.h"
#include <stdlib.h>
#include <string.h>

static esp_err_t measuredWrite(i2s_chan_handle_t handle, const void *data, size_t size, size_t *written, uint32_t timeout) {
  esp_err_t err = i2s_channel_write(handle, data, size, written, timeout);
  if (!err && *written) stackchanAudioProgress(0, esp_timer_get_time());
  return err;
}
static esp_err_t measuredRead(i2s_chan_handle_t handle, void *data, size_t size, size_t *received, uint32_t timeout) {
  esp_err_t err = i2s_channel_read(handle, data, size, received, timeout);
  if (!err && *received) stackchanAudioProgress(1, esp_timer_get_time());
  return err;
}
// Stream buffers are copied by the CPU, never handed to I2S DMA. FreeRTOS's
// dynamic allocator would place all 25.6 KB in internal RAM. Keep only its
// control blocks internal, and put sample storage in PSRAM.


static struct {
  StaticStreamBuffer_t control;
  uint8_t *data;
  StreamBufferHandle_t handle;
} streams[2];
static StreamBufferHandle_t audioStreamCreate(size_t size, size_t trigger) {
  for (int i = 0; i < 2; i++) if (!streams[i].handle) {
    streams[i].data = heap_caps_malloc(size + 1, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!streams[i].data) return NULL;
    // Static creation uses the supplied byte count, including its empty slot.
    streams[i].handle = xStreamBufferCreateStatic(size + 1, trigger, streams[i].data, &streams[i].control);
    if (!streams[i].handle) {free(streams[i].data); streams[i].data = NULL;}
    return streams[i].handle;
  }
  return NULL;
}
static void audioStreamDelete(StreamBufferHandle_t handle) {
  vStreamBufferDelete(handle);
  for (int i = 0; i < 2; i++) if (streams[i].handle == handle) {
    free(streams[i].data); streams[i].data = NULL; streams[i].handle = NULL;
    break;
  }
}

static void originalLiveAudioClose(LiveAudio *a);
static void originalLiveAudioStop(LiveAudio *a);

/* The codec is configured by the Tab5 provider. This module owns BOTH I2S
 * directions for the entire session; do not open device.audio at the same time.
 * Three 10 ms DMA buffers separate a submitted sample from the capture clock.
 * AEC receives the software-volume-adjusted samples, including silence. */
#define BLOCK 480
#define DMA_BLOCKS 3
#define CAPTURE_BYTES 6400
#define PLAYBACK_BYTES 19200

struct LiveAudio {
	esp_capture_audio_src_if_t source;
	esp_capture_handle_t capture;
	av_render_handle_t player;
	audio_render_handle_t render;
	i2s_chan_handle_t tx, rx;
	StreamBufferHandle_t input, output;

#ifndef CONFIG_IDF_TARGET_ESP32S3
	aec_handle_t *aec;
#endif
	esp_ae_rate_cvt_handle_t resampler;
	atomic_bool stopping, done, reading, muted;
	atomic_uint volume, captured, rendered, underruns, overruns, sourceSamples;
	atomic_uint requestedRate, requestedChannels, sourceFrameBytes;
	atomic_uint micLevel, cleanLevel, referenceLevel;
	atomic_uint outputIdleMs, silenceMs, maxSilenceMs;
	atomic_uint audibleMs;
	atomic_int error;
	bool taskStarted, txEnabled, rxEnabled;
	uint32_t pts;
	int chunk;
	_Atomic(const char *) stage;
	int16_t *buffers;
};

static esp_capture_err_t sourceOpen(esp_capture_audio_src_if_t *s) { return ESP_CAPTURE_ERR_OK; }
static esp_capture_err_t sourceCodecs(esp_capture_audio_src_if_t *s, const esp_capture_format_id_t **codecs, uint8_t *count)
{
	static const esp_capture_format_id_t pcm = ESP_CAPTURE_FMT_ID_PCM;
	*codecs = &pcm; *count = 1;
	return ESP_CAPTURE_ERR_OK;
}
static esp_capture_err_t sourceNegotiate(esp_capture_audio_src_if_t *s, esp_capture_audio_info_t *in, esp_capture_audio_info_t *out)
{
	LiveAudio *a = (LiveAudio *)s;
	atomic_store(&a->requestedRate, in->sample_rate); atomic_store(&a->requestedChannels, in->channel);
	if (in->format_id != ESP_CAPTURE_FMT_ID_PCM) return ESP_CAPTURE_ERR_NOT_SUPPORTED;
	*out = (esp_capture_audio_info_t){.format_id = ESP_CAPTURE_FMT_ID_PCM, .sample_rate = 16000, .channel = 1, .bits_per_sample = 16};
	return ESP_CAPTURE_ERR_OK;
}
static esp_capture_err_t sourceStart(esp_capture_audio_src_if_t *s)
{
	LiveAudio *a = (LiveAudio *)s;
	a->pts = 0;
	atomic_store(&a->reading, true);
	return ESP_CAPTURE_ERR_OK;
}
/* Optional application DSP/test source. Runs on the native capture task, never
 * the JS event loop. Implementations must be bounded and non-blocking. */
__attribute__((weak)) void liveAudioTransformCapture(int16_t *samples, size_t count) {}
static esp_capture_err_t sourceRead(esp_capture_audio_src_if_t *s, esp_capture_stream_frame_t *frame)
{
	LiveAudio *a = (LiveAudio *)s;
	int offset = 0;
	atomic_store(&a->sourceFrameBytes, frame->size);
	while (offset < frame->size && atomic_load(&a->reading) && !atomic_load(&a->stopping))
		offset += xStreamBufferReceive(a->input, frame->data + offset, frame->size - offset, pdMS_TO_TICKS(50));
	if (offset != frame->size) return ESP_CAPTURE_ERR_NOT_SUPPORTED;
	if (atomic_load(&a->muted)
#ifdef CONFIG_IDF_TARGET_ESP32S3
		|| atomic_load(&a->outputIdleMs) < 500
#endif
	) memset(frame->data, 0, frame->size);
	else liveAudioTransformCapture((int16_t *)frame->data, frame->size / 2);
	atomic_fetch_add(&a->sourceSamples, frame->size / 2);
	frame->pts = a->pts / 16;
	a->pts += frame->size / 2;
	return ESP_CAPTURE_ERR_OK;
}
static esp_capture_err_t sourceStop(esp_capture_audio_src_if_t *s)
{
	atomic_store(&((LiveAudio *)s)->reading, false);
	return ESP_CAPTURE_ERR_OK;
}
static audio_render_handle_t renderInit(void *cfg, int size) { return *(LiveAudio **)cfg; }
static int renderOpen(audio_render_handle_t h, av_render_audio_frame_info_t *info)
{
	return (info->sample_rate == 48000 && info->channel == 1 && info->bits_per_sample == 16) ? 0 : -1;
}
static int renderWrite(audio_render_handle_t h, av_render_audio_frame_t *frame)
{
	LiveAudio *a = h;
	int offset = 0;
	while (offset < frame->size && !atomic_load(&a->stopping))
		offset += xStreamBufferSend(a->output, frame->data + offset, frame->size - offset, pdMS_TO_TICKS(50));
	return offset == frame->size ? 0 : -1;
}
static int renderLatency(audio_render_handle_t h, uint32_t *ms)
{
	LiveAudio *a = h;
	*ms = xStreamBufferBytesAvailable(a->output) / 96 + DMA_BLOCKS * 10;
	return 0;
}
static int renderInfo(audio_render_handle_t h, av_render_audio_frame_info_t *info)
{
	*info = (av_render_audio_frame_info_t){.sample_rate = 48000, .channel = 1, .bits_per_sample = 16};
	return 0;
}
static int renderClose(audio_render_handle_t h) { return 0; }
static void renderDeinit(audio_render_handle_t h) {}

static void audioTask(void *ctx)
{
	LiveAudio *a = ctx;
	int16_t *tx = a->buffers, *rx = tx + BLOCK * 2;
	int16_t *pair = rx + BLOCK * 2, *converted = pair + BLOCK * 2;
	int16_t *reference = converted + BLOCK * 2;
	int16_t *mic = reference + BLOCK * DMA_BLOCKS;
	int16_t *ref = mic + a->chunk, *clean = ref + a->chunk;
	int accumulated = 0, delay = 0;
	unsigned idle = 1000, gap = 0;
	bool gapActive = false;
	while (!atomic_load(&a->stopping)) {
		/* Non-blocking dequeue: the clock must keep running between utterances. */
		size_t got = xStreamBufferReceive(a->output, tx, BLOCK * 2, 0);
		if (got < BLOCK * 2 && idle < 500) {
			if (!gapActive) atomic_fetch_add(&a->underruns, 1);
			gapActive = true; gap += 10;
			atomic_fetch_add(&a->silenceMs, 10);
			if (gap > atomic_load(&a->maxSilenceMs)) atomic_store(&a->maxSilenceMs, gap);
		} else { gapActive = false; gap = 0; }
		memset((uint8_t *)tx + got, 0, BLOCK * 2 - got);
		bool audible = false;
		for (size_t i = 0; i < got / 2; i++) if (abs(tx[i]) > 32) { audible = true; break; }
		/* Missing packets are not evidence of silence. Only received PCM
		 * can reopen the S3 microphone after playback. */
		if (audible) { idle = 0; atomic_fetch_add(&a->audibleMs, 10); }
		else if (got == BLOCK * 2 && idle < 10000) idle += 10;
		atomic_store(&a->outputIdleMs, idle);
		unsigned volume = atomic_load(&a->volume);
		for (int i = BLOCK - 1; i >= 0; i--) {
			int16_t sample = (int32_t)tx[i] * volume / 1024;
			tx[i * 2] = tx[i * 2 + 1] = sample;
		}
		size_t written = 0, received = 0;
		int err = measuredWrite(a->tx, tx, BLOCK * 4, &written, 200);
		if (!err) err = measuredRead(a->rx, rx, BLOCK * 4, &received, 200);
		if (err || received != BLOCK * 4 || written != BLOCK * 4) {
			a->stage = written != BLOCK * 4 ? "i2s_write" : "i2s_read";
			atomic_store(&a->error, err ? err : ESP_ERR_INVALID_SIZE);
			break;
		}
		for (int i = 0; i < BLOCK; i++) {
			pair[i * 2] = rx[i * 2];
			pair[i * 2 + 1] = reference[delay];
			reference[delay] = tx[i * 2];
			delay = (delay + 1) % (BLOCK * DMA_BLOCKS);
		}
		uint32_t count = BLOCK;
		err = esp_ae_rate_cvt_process(a->resampler, pair, BLOCK, converted, &count);
		if (err) { atomic_store(&a->error, err); break; }
		atomic_fetch_add(&a->rendered, got / 2);
		for (uint32_t i = 0; i < count; i++) {
			mic[accumulated] = converted[i * 2];
			ref[accumulated++] = converted[i * 2 + 1];
			if (accumulated != a->chunk) continue;
#ifdef CONFIG_IDF_TARGET_ESP32S3
			memcpy(clean, mic, a->chunk * 2);
			// Gate capture locally before any JavaScript or server mute ACK can run.
			if (idle < 500) memset(clean, 0, a->chunk * 2);
#else
			aec_process(a->aec, mic, ref, clean);
#endif
			unsigned m = 0, r = 0, c = 0;
			for (int j = 0; j < a->chunk; j++) { m += abs(mic[j]); r += abs(ref[j]); c += abs(clean[j]); }
			atomic_store(&a->micLevel, m / a->chunk);
			atomic_store(&a->referenceLevel, r / a->chunk);
			atomic_store(&a->cleanLevel, c / a->chunk);
			if (atomic_load(&a->muted)) memset(clean, 0, a->chunk * 2);
			if (atomic_load(&a->reading)) {
				if (xStreamBufferSpacesAvailable(a->input) >= a->chunk * 2)
					xStreamBufferSend(a->input, clean, a->chunk * 2, 0);
				else atomic_fetch_add(&a->overruns, 1);
			}
			atomic_fetch_add(&a->captured, a->chunk);
			accumulated = 0;
		}
	}
	atomic_store(&a->done, true);
	vTaskDelete(NULL);
}

static int originalLiveAudioOpen(LiveAudio **out, esp_webrtc_media_provider_t *provider)
{
	LiveAudio *a = calloc(1, sizeof(*a));
	if (!a) return ESP_ERR_NO_MEM;
	*out = a;
	atomic_store(&a->volume, 512);
	a->source = (esp_capture_audio_src_if_t){.open = sourceOpen, .get_support_codecs = sourceCodecs,
		.negotiate_caps = sourceNegotiate, .start = sourceStart, .read_frame = sourceRead,
		.abort = sourceStop, .stop = sourceStop, .close = sourceStop};
	a->stage = "audio_buffers";
	a->input = audioStreamCreate(CAPTURE_BYTES, 1);
	a->output = audioStreamCreate(PLAYBACK_BYTES, 1);
	a->stage = "aec_create";
#ifdef CONFIG_IDF_TARGET_ESP32S3
	if (!a->input || !a->output) return ESP_ERR_NO_MEM;
	a->chunk = 160;
#else
	a->aec = aec_create(16000, 4, 1, AEC_MODE_FD_LOW_COST);
	if (!a->input || !a->output || !a->aec) return ESP_ERR_NO_MEM;
	a->chunk = aec_get_chunksize(a->aec);
#endif
	atomic_store(&a->outputIdleMs, 1000);
	a->buffers = heap_caps_aligned_calloc(16, BLOCK * (8 + DMA_BLOCKS) + a->chunk * 3, sizeof(int16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
	if (!a->buffers) return ESP_ERR_NO_MEM;
	esp_ae_rate_cvt_cfg_t rate = {.src_rate = 48000, .dest_rate = 16000, .channel = 2,
		.bits_per_sample = 16, .complexity = 2, .perf_type = ESP_AE_RATE_CVT_PERF_TYPE_SPEED};
	a->stage = "resampler_open";
	int err = esp_ae_rate_cvt_open(&rate, &a->resampler);
	if (err) return err;
	i2s_chan_config_t channel = I2S_CHANNEL_DEFAULT_CONFIG(
#ifdef CONFIG_IDF_TARGET_ESP32S3
		I2S_NUM_1,
#else
		I2S_NUM_0,
#endif
		I2S_ROLE_MASTER);
	channel.dma_desc_num = DMA_BLOCKS;
	channel.dma_frame_num = BLOCK;
	channel.auto_clear = true;
	a->stage = "i2s_new_channel";
	err = i2s_new_channel(&channel, &a->tx, &a->rx);
	if (err) return err;
	i2s_std_config_t config = {
		.clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(48000),
		.slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_STEREO),
		#ifdef CONFIG_IDF_TARGET_ESP32S3
		.gpio_cfg = {.mclk = 0, .bclk = 34, .ws = 33, .dout = 13, .din = 14}
#else
		.gpio_cfg = {.mclk = 30, .bclk = 27, .ws = 29, .dout = 26, .din = 28}
#endif
	};
	a->stage = "i2s_init_tx";
	if ((err = i2s_channel_init_std_mode(a->tx, &config))) return err;
	a->stage = "i2s_init_rx";
	if ((err = i2s_channel_init_std_mode(a->rx, &config))) return err;
	a->stage = "i2s_enable_rx";
	if ((err = i2s_channel_enable(a->rx))) return err;
	a->rxEnabled = true;
	a->stage = "i2s_enable_tx";
	if ((err = i2s_channel_enable(a->tx))) return err;
	a->txEnabled = true;
	a->stage = "audio_task";
	if (xTaskCreatePinnedToCore(audioTask, "live_audio", 8192, a, 20, NULL, 0) != pdPASS) return ESP_ERR_NO_MEM;
	a->taskStarted = true;
	esp_capture_cfg_t capture = {.sync_mode = ESP_CAPTURE_SYNC_MODE_AUDIO, .audio_src = &a->source};
	a->stage = "capture_open";
	if ((err = esp_capture_open(&capture, &a->capture))) return err;
	audio_render_cfg_t render = {.ops = {.init = renderInit, .open = renderOpen, .write = renderWrite,
		.get_latency = renderLatency, .get_frame_info = renderInfo, .close = renderClose, .deinit = renderDeinit},
		.cfg = &a, .cfg_size = sizeof(a)};
	a->stage = "render_alloc";
	a->render = audio_render_alloc_handle(&render);
	if (!a->render) return ESP_ERR_NO_MEM;
	av_render_cfg_t player = {.audio_render = a->render, .audio_raw_fifo_size = 16384, .audio_render_fifo_size = 32768};
	a->stage = "render_open";
	a->player = av_render_open(&player);
	if (!a->player) return ESP_ERR_NO_MEM;
	av_render_audio_frame_info_t info;
	renderInfo(a, &info);
	a->stage = "render_format";
	/* av_render 1.1.0 at c865084 assigns aud_fix_info but unconditionally
	 * returns WRONG_STATE. Accept that known return only for this setter. */
	err = av_render_set_fixed_frame_info(a->player, &info);
	if (err && err != ESP_MEDIA_ERR_WRONG_STATE) return err;
	provider->capture = a->capture;
	provider->player = a->player;
	return 0;
}
static void originalLiveAudioStop(LiveAudio *a)
{
	if (!a) return;
	atomic_store(&a->stopping, true);
	atomic_store(&a->reading, false);
}
static void originalLiveAudioClose(LiveAudio *a)
{
	if (!a) return;
	originalLiveAudioStop(a);
	if (a->capture) esp_capture_close(a->capture);
	if (a->player) av_render_close(a->player);
	if (a->render) audio_render_free_handle(a->render);
	while (a->taskStarted && !atomic_load(&a->done)) vTaskDelay(pdMS_TO_TICKS(10));
	if (a->rxEnabled) i2s_channel_disable(a->rx);
	if (a->txEnabled) i2s_channel_disable(a->tx);
	if (a->rx) i2s_del_channel(a->rx);
	if (a->tx) i2s_del_channel(a->tx);
#ifndef CONFIG_IDF_TARGET_ESP32S3
	if (a->aec) aec_destroy(a->aec);
#endif
	if (a->resampler) esp_ae_rate_cvt_close(a->resampler);
	if (a->input) audioStreamDelete(a->input);
	if (a->output) audioStreamDelete(a->output);
	free(a->buffers);
	free(a);
}
static void originalLiveAudioMute(LiveAudio *a, bool mute) { if (a) atomic_store(&a->muted, mute); }
void liveAudioVolume(LiveAudio *a, unsigned volume) { if (a) atomic_store(&a->volume, volume); }
int liveAudioError(LiveAudio *a) { return a ? atomic_load(&a->error) : 0; }
const char *liveAudioStage(LiveAudio *a) { return a ? a->stage : "audio_allocate"; }
void liveAudioStats(LiveAudio *a, LiveAudioStats *s)
{
	if (!a) return;
	*s = (LiveAudioStats){atomic_load(&a->captured), atomic_load(&a->rendered), atomic_load(&a->underruns),
		atomic_load(&a->overruns), atomic_load(&a->micLevel), atomic_load(&a->cleanLevel), atomic_load(&a->referenceLevel), atomic_load(&a->outputIdleMs), atomic_load(&a->silenceMs), atomic_load(&a->maxSilenceMs), atomic_load(&a->sourceSamples), atomic_load(&a->requestedRate), atomic_load(&a->requestedChannels), atomic_load(&a->sourceFrameBytes)};
	s->audibleMs = atomic_load(&a->audibleMs);
}

static portMUX_TYPE audioLock = portMUX_INITIALIZER_UNLOCKED;
static LiveAudio *activeAudio;
static atomic_bool quiesceAudio;
void liveAudioStop(LiveAudio *audio);
extern esp_err_t stackchanMediaAdapter(void);
extern int stackchanInstallOpusPolicy(void);
int liveAudioOpen(LiveAudio **out, esp_webrtc_media_provider_t *provider) {
  atomic_store(&quiesceAudio, false);
  // Transport.start installs the default adapter; apply the board policy after it.
  int adapterError = stackchanMediaAdapter();
  if (adapterError) return adapterError;
  int opusError = stackchanInstallOpusPolicy();
  if (opusError) return opusError;
  stackchanAudioReset();
  int err = originalLiveAudioOpen(out, provider);
  if (!err) { portENTER_CRITICAL(&audioLock); activeAudio = *out; portEXIT_CRITICAL(&audioLock); }
  return err;
}
void liveAudioStop(LiveAudio *audio) {
  if (!audio) return;
  int first = !atomic_load(&audio->stopping);
  originalLiveAudioStop(audio);
  // Stop was explicitly requested. Flush the renderer's queued tail through
  // its public API before disconnecting WebRTC, instead of repeatedly decoding
  // into a cancelled sink and flooding the log from high-priority audio tasks.
  // Before the first decoded frame, AV Render has no render thread to wait on.
  // Flushing then calls xEventGroupWaitBits with a zero bit mask and asserts.
  if (first && audio->player && atomic_load(&audio->rendered)) av_render_flush(audio->player);
}
void xs_live_audio_quiesce(xsMachine *the) {
  // The peer task owns the pointer and performs the stop on its next control
  // update. A JS callback never races the native audio object's destruction.
  atomic_store(&quiesceAudio, true);
}
void liveAudioMute(LiveAudio *audio, bool mute) {
  originalLiveAudioMute(audio, mute);
  if (atomic_exchange(&quiesceAudio, false)) liveAudioStop(audio);
}
void liveAudioClose(LiveAudio *audio) {
  portENTER_CRITICAL(&audioLock);
  if (activeAudio == audio) activeAudio = NULL;
  portEXIT_CRITICAL(&audioLock);
  originalLiveAudioClose(audio);
}
void xs_io_audio_levels(xsMachine *the) {
  unsigned level = 0, idle = 10000;
  portENTER_CRITICAL(&audioLock);
  if (activeAudio) {
    level = atomic_load(&activeAudio->referenceLevel);
    idle = atomic_load(&activeAudio->outputIdleMs);
  }
  portEXIT_CRITICAL(&audioLock);
  xsmcVars(1); xsmcSetNewObject(xsResult);
  xsmcSetInteger(xsVar(0),level); xsmcSet(xsResult,xsID("referenceLevel"),xsVar(0));
  xsmcSetInteger(xsVar(0),idle); xsmcSet(xsResult,xsID("outputIdleMs"),xsVar(0));
}
