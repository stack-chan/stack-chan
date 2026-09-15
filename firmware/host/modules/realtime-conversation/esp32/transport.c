// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

#include "xsmc.h"
#include "xsHost.h"
#include "esp_webrtc.h"
#include "esp_capture_sink.h"
#include "esp_webrtc_defaults.h"
#include "esp_peer_default.h"
#include "esp_audio_enc_default.h"
#include "esp_audio_dec_default.h"
#include "media_lib_adapter.h"
#include "media_lib_os.h"
#include "esp_heap_caps.h"
#include "liveAudio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

#define EVENT_BYTES 131072
#define EVENT_COUNT 128
#define COMMAND_COUNT 8

enum { kOffer = 1, kMessage, kError, kDisconnected, kAnswer, kSend };
typedef struct { int type, size, code; char *data; } LiveMessage;
typedef struct {
	QueueHandle_t events, commands;
	atomic_bool stopping, done, muted;
	atomic_int failure;
	atomic_uint queuedBytes, volume, lastPollTick;
	bool started, errorRead, captureOnly;
	atomic_uint encodedFrames, encodedPts;
	atomic_uint peerEvents, lastPeerEvent, dataMessages;
	const char *failureStage;
	esp_webrtc_handle_t rtc;
	esp_peer_signaling_cfg_t signal;
	LiveAudioStats stats;
	portMUX_TYPE lock;
} LiveTransport;

/* I2S and media-library schedulers are process-wide resources. The JS host
 * thread owns this lease until every native task has stopped. */
static LiveTransport *gOwner;
static bool gAdapters;

static void fail(LiveTransport *t, int code)
{
	int expected = 0;
	atomic_compare_exchange_strong(&t->failure, &expected, code ? code : -1);
}
static int enqueue(LiveTransport *t, int type, const void *data, int size)
{
	if (atomic_load(&t->stopping)) return 0;
	if (size < 0 || size > EVENT_BYTES) { fail(t, ESP_ERR_INVALID_SIZE); return -1; }
	unsigned previous = atomic_fetch_add(&t->queuedBytes, size);
	if (previous + size > EVENT_BYTES) {
		atomic_fetch_sub(&t->queuedBytes, size); fail(t, ESP_ERR_NO_MEM); return -1;
	}
	LiveMessage msg = {.type = type, .size = size};
	if (size) {
		msg.data = malloc(size + 1);
		if (!msg.data) { atomic_fetch_sub(&t->queuedBytes, size); fail(t, ESP_ERR_NO_MEM); return -1; }
		memcpy(msg.data, data, size);
		msg.data[size] = 0;
	}
	if (xQueueSend(t->events, &msg, 0) != pdPASS) {
		free(msg.data); atomic_fetch_sub(&t->queuedBytes, size); fail(t, ESP_ERR_NO_MEM); return -1;
	}
	return 0;
}
static int signalStart(esp_peer_signaling_cfg_t *cfg, esp_peer_signaling_handle_t *handle)
{
	LiveTransport *t = *(LiveTransport **)cfg->extra_cfg;
	t->signal = *cfg;
	*handle = t;
	esp_peer_signaling_ice_info_t ice = {.is_initiator = true};
	int err = cfg->on_ice_info(&ice, cfg->ctx);
	return err ? err : cfg->on_connected(cfg->ctx);
}
static int signalSend(esp_peer_signaling_handle_t handle, esp_peer_signaling_msg_t *msg)
{
	if (msg->type == ESP_PEER_SIGNALING_MSG_SDP)
		return enqueue(handle, kOffer, msg->data, msg->size);
	return 0;
}
static int signalStop(esp_peer_signaling_handle_t handle) { return 0; }
static const esp_peer_signaling_impl_t signaling = {.start = signalStart, .send_msg = signalSend, .stop = signalStop};
static int onData(esp_webrtc_custom_data_via_t via, uint8_t *data, int size, void *ctx)
{
	if (via == ESP_WEBRTC_CUSTOM_DATA_VIA_DATA_CHANNEL)
		atomic_fetch_add(&((LiveTransport *)ctx)->dataMessages, 1);
	return via == ESP_WEBRTC_CUSTOM_DATA_VIA_DATA_CHANNEL ? enqueue(ctx, kMessage, data, size) : 0;
}
static int onEvent(esp_webrtc_event_t *event, void *ctx)
{
	LiveTransport *t = ctx;
	if (atomic_load(&t->stopping)) return 0;
	atomic_store(&t->lastPeerEvent, event->type);
	if (event->type < 32) atomic_fetch_or(&t->peerEvents, 1U << event->type);
	if (event->type == ESP_WEBRTC_EVENT_DATA_CHANNEL_CONNECTED) {
		esp_peer_data_channel_cfg_t cfg = {.type = ESP_PEER_DATA_CHANNEL_RELIABLE, .ordered = true, .label = "oai-events"};
		esp_peer_handle_t peer = NULL;
		int err = esp_webrtc_get_peer_connection(t->rtc, &peer);
		if (!err) err = esp_peer_create_data_channel(peer, &cfg);
		if (err) fail(t, err);
	}
	else if (event->type == ESP_WEBRTC_EVENT_CONNECT_FAILED) fail(t, ESP_FAIL);
	else if (event->type == ESP_WEBRTC_EVENT_DISCONNECTED || event->type == ESP_WEBRTC_EVENT_DATA_CHANNEL_CLOSED ||
		event->type == ESP_WEBRTC_EVENT_DATA_CHANNEL_DISCONNECTED)
		enqueue(t, kDisconnected, NULL, 0);
	return 0;
}
static void scheduler(const char *name, media_lib_thread_cfg_t *cfg)
{
	if (!strcmp(name, "pc_task")) { cfg->stack_size = 25 * 1024; cfg->priority = 18; cfg->core_id = 1; }
	else if (!strcmp(name, "Adec")) { cfg->stack_size = 40 * 1024; cfg->priority = 15; cfg->core_id = 0; }
	else if (!strcmp(name, "pc_send")) {
#ifdef CONFIG_IDF_TARGET_ESP32S3
		/* Keep capture/RTP ahead of peer receive work on the S3. */
		cfg->priority = 19;
#else
		cfg->priority = 15;
#endif
		cfg->core_id = 1;
	}
	else if (!strcmp(name, "ARender")) cfg->priority = 20;
	else if (!strcmp(name, "start")) cfg->stack_size = 6 * 1024;
}
static void captureScheduler(const char *name, esp_capture_thread_schedule_cfg_t *cfg)
{
	cfg->stack_in_ext = true;
#ifdef CONFIG_IDF_TARGET_ESP32S3
	/* esp_capture defaults AUD_SRC to priority 5, which competes with XS/TLS
	 * while the decoder is active. Match Espressif's capture sample priority. */
	if (!strcmp(name, "AUD_SRC")) { cfg->priority = 15; cfg->core_id = 0; }
#endif
	if (!strcmp(name, "aenc_0")) {
		/* Opus/SILK exceeds esp_capture's 4 KB default on ESP32-P4.
		 * Match the Opus scheduler in esp_capture's audio example. */
		cfg->stack_size = 40 * 1024;
#ifdef CONFIG_IDF_TARGET_ESP32S3
		cfg->priority = 19;
		/* Keep Opus's hot stack in SRAM instead of competing with the
		 * decoder/UI for the S3's external-memory cache. */
		cfg->stack_size = 28 * 1024;
		cfg->stack_in_ext = false;
#else
		cfg->priority = 10;
#endif
		cfg->core_id = 1;
	}
}
/* Optional offline probe recorder; never called by a provider session. */
__attribute__((weak)) void liveCaptureProbePacket(const uint8_t *data, size_t size, uint32_t pts) {}
static void worker(void *ctx)
{
	LiveTransport *t = ctx;
	LiveAudio *audio = NULL;
	esp_webrtc_media_provider_t provider = {0};
	esp_capture_sink_handle_t probeSink = NULL;
	int err = liveAudioOpen(&audio, &provider);
	if (err) { t->failureStage = liveAudioStage(audio); goto done; }
	if (t->captureOnly) {
		/* Match the RTP drain priority when comparing capture throughput. */
		vTaskPrioritySet(NULL, 15);
		esp_capture_sink_cfg_t sink = {.audio_info = {.format_id = ESP_CAPTURE_FMT_ID_OPUS,
			.sample_rate = 16000, .channel = 1, .bits_per_sample = 16}};
		t->failureStage = "capture_probe_setup";
		if ((err = esp_capture_sink_setup(provider.capture, 0, &sink, &probeSink))) goto done;
		if ((err = esp_capture_sink_enable(probeSink, ESP_CAPTURE_RUN_MODE_ALWAYS))) goto done;
		if ((err = esp_capture_start(provider.capture))) goto done;
		goto running;
	}
	esp_peer_default_cfg_t peer = {.agent_recv_timeout = 500, .ice_use_lite_mode = false,
		.rtp_cfg = {.audio_recv_jitter = {.cache_size = 32768}, .send_pool_size = 32768, .send_queue_num = 64}};
	esp_webrtc_cfg_t cfg = {
		.peer_cfg = {.audio_info = {.codec = ESP_PEER_AUDIO_CODEC_OPUS, .sample_rate = 16000, .channel = 1},
			.audio_dir = ESP_PEER_MEDIA_DIR_SEND_RECV, .video_dir = ESP_PEER_MEDIA_DIR_NONE,
			.enable_data_channel = true, .manual_ch_create = true, .no_auto_reconnect = true,
			.on_custom_data = onData, .ctx = t, .extra_cfg = &peer, .extra_size = sizeof(peer)},
		.signaling_cfg = {.extra_cfg = &t, .extra_size = sizeof(t)},
		.peer_impl = esp_peer_get_default_impl(), .signaling_impl = &signaling
	};
	if ((err = esp_webrtc_open(&cfg, &t->rtc))) goto done;
	if ((err = esp_webrtc_set_media_provider(t->rtc, &provider))) goto done;
	if ((err = esp_webrtc_set_event_handler(t->rtc, onEvent, t))) goto done;
	if ((err = esp_webrtc_start(t->rtc))) goto done;
	running:
	atomic_store(&t->lastPollTick, xTaskGetTickCount());
	while (!atomic_load(&t->stopping) && !atomic_load(&t->failure)) {
		if (probeSink) {
			esp_capture_stream_frame_t frame = {.stream_type = ESP_CAPTURE_STREAM_TYPE_AUDIO};
			while (esp_capture_sink_acquire_frame(probeSink, &frame, true) == ESP_CAPTURE_ERR_OK) {
				atomic_fetch_add(&t->encodedFrames, 1); atomic_store(&t->encodedPts, frame.pts);
				liveCaptureProbePacket(frame.data, frame.size, frame.pts);
				esp_capture_sink_release_frame(probeSink, &frame);
			}
		}
		/* This watchdog runs even when the JS VM aborts or blocks in IPC. */
		if ((TickType_t)(xTaskGetTickCount() - atomic_load(&t->lastPollTick)) > pdMS_TO_TICKS(10000)) {
			t->failureStage = "event_loop_watchdog";
			if (t->rtc) {
				static const char close[] = "{\"type\":\"session.close\"}";
				esp_webrtc_send_custom_data(t->rtc, ESP_WEBRTC_CUSTOM_DATA_VIA_DATA_CHANNEL, (uint8_t *)close, sizeof(close)-1);
				vTaskDelay(pdMS_TO_TICKS(200));
			}
			err = ESP_ERR_TIMEOUT; break;
		}
		LiveMessage msg;
		if (xQueueReceive(t->commands, &msg, pdMS_TO_TICKS(20)) == pdPASS) {
			if (msg.type == kAnswer) {
				esp_peer_signaling_msg_t answer = {.type = ESP_PEER_SIGNALING_MSG_SDP, .data = (uint8_t *)msg.data, .size = msg.size};
				err = t->signal.on_msg(&answer, t->signal.ctx);
			}
			else err = esp_webrtc_send_custom_data(t->rtc, ESP_WEBRTC_CUSTOM_DATA_VIA_DATA_CHANNEL, (uint8_t *)msg.data, msg.size);
			free(msg.data);
			if (err) break;
		}
		liveAudioMute(audio, atomic_load(&t->muted));
		liveAudioVolume(audio, atomic_load(&t->volume));
		LiveAudioStats stats = {0};
		liveAudioStats(audio, &stats);
		portENTER_CRITICAL(&t->lock);
		t->stats = stats;
		portEXIT_CRITICAL(&t->lock);
		if ((err = liveAudioError(audio))) { t->failureStage = liveAudioStage(audio); break; }
	}
done:
	if (err) fail(t, err);
	atomic_store(&t->stopping, true);
	liveAudioStop(audio);
	if (probeSink) esp_capture_stop(provider.capture);
	if (t->rtc) { esp_webrtc_close(t->rtc); t->rtc = NULL; }
	liveAudioClose(audio);
	atomic_store(&t->done, true);
	vTaskDelete(NULL);
}
static void dispose(LiveTransport *t)
{
	LiveMessage msg;
	if (t->events) { while (xQueueReceive(t->events, &msg, 0) == pdPASS) free(msg.data); vQueueDelete(t->events); }
	if (t->commands) { while (xQueueReceive(t->commands, &msg, 0) == pdPASS) free(msg.data); vQueueDelete(t->commands); }
	if (gOwner == t) gOwner = NULL;
	free(t);
}
void xs_live_transport_destructor(void *data)
{
	LiveTransport *t = data;
	if (!t) return;
	atomic_store(&t->stopping, true);
	while (t->started && !atomic_load(&t->done)) vTaskDelay(pdMS_TO_TICKS(10));
	dispose(t);
}
void xs_live_transport_constructor(xsMachine *the)
{
	if (gOwner) xsUnknownError("Tab5 audio is already in use");
	LiveTransport *t = calloc(1, sizeof(*t));
	if (!t) xsUnknownError("No memory for WebRTC");
	t->lock = (portMUX_TYPE)portMUX_INITIALIZER_UNLOCKED;
	t->events = xQueueCreate(EVENT_COUNT, sizeof(LiveMessage));
	t->commands = xQueueCreate(COMMAND_COUNT, sizeof(LiveMessage));
	if (!t->events || !t->commands) { dispose(t); xsUnknownError("No memory for WebRTC queues"); }
	atomic_store(&t->volume, 512);
	gOwner = t;
	xsmcSetHostData(xsThis, t);
}
void xs_live_transport_start(xsMachine *the)
{
	LiveTransport *t = xsmcGetHostData(xsThis);
	if (!t || t->started || atomic_load(&t->stopping)) xsUnknownError("Transport cannot start");
	if (!gAdapters) {
		media_lib_add_default_adapter();
		media_lib_thread_set_schedule_cb(scheduler);
		esp_capture_set_thread_scheduler(captureScheduler);
		esp_audio_enc_register_default();
		esp_audio_dec_register_default();
		gAdapters = true;
	}
	t->captureOnly = xsmcArgc && xsmcToBoolean(xsArg(0));
	t->started = true;
	if (xTaskCreatePinnedToCore(worker, "live_peer", 12288, t, 10, NULL, 1) != pdPASS) {
		t->started = false;
		xsUnknownError("No memory for WebRTC task");
	}
}
static void command(xsMachine *the, int type)
{
	LiveTransport *t = xsmcGetHostData(xsThis);
	if (!t || !t->started || atomic_load(&t->stopping)) xsUnknownError("Transport is closed");
	const char *text = xsmcToString(xsArg(0));
	int size = strlen(text);
	if (!size || size > 65536) xsRangeError("Invalid message size");
	LiveMessage msg = {.type = type, .size = size, .data = malloc(size + 1)};
	if (!msg.data) xsUnknownError("No memory for message");
	memcpy(msg.data, text, size + 1);
	if (xQueueSend(t->commands, &msg, 0) != pdPASS) {
		free(msg.data);
		if (type == kAnswer) xsUnknownError("WebRTC command queue full");
		xsmcSetBoolean(xsResult, false);
		return;
	}
	xsmcSetBoolean(xsResult, true);
}
void xs_live_transport_answer(xsMachine *the) { command(the, kAnswer); }
void xs_live_transport_send(xsMachine *the) { command(the, kSend); }
void xs_live_transport_mute(xsMachine *the)
{
	LiveTransport *t = xsmcGetHostData(xsThis);
	if (!t) xsUnknownError("Transport is closed");
	atomic_store(&t->muted, xsmcToBoolean(xsArg(0)));
}
void xs_live_transport_volume(xsMachine *the)
{
	LiveTransport *t = xsmcGetHostData(xsThis);
	if (!t) xsUnknownError("Transport is closed");
	xsNumberValue value = xsmcToNumber(xsArg(0));
	if (!(value >= 0 && value <= 1)) xsRangeError("Invalid volume");
	atomic_store(&t->volume, (unsigned)(value * 1024));
}
void xs_live_transport_close(xsMachine *the)
{
	LiveTransport *t = xsmcGetHostData(xsThis);
	if (!t) return;
	atomic_store(&t->stopping, true);
	if (!t->started) atomic_store(&t->done, true);
}
void xs_live_transport_read(xsMachine *the)
{
	LiveTransport *t = xsmcGetHostData(xsThis);
	if (!t) return;
	atomic_store(&t->lastPollTick, xTaskGetTickCount());
	LiveMessage msg = {0};
	if (xQueueReceive(t->events, &msg, 0) == pdPASS) atomic_fetch_sub(&t->queuedBytes, msg.size);
	else if (!t->errorRead && atomic_load(&t->failure)) { msg.type = kError; msg.code = atomic_load(&t->failure); t->errorRead = true; }
	else if (!atomic_load(&t->done)) return;
	/* Queue storage belongs to native memory and is independent of XS GC.
	 * Free it even if constructing the JavaScript string throws. */
	xsTry {
		xsmcVars(1);
		xsmcSetNewObject(xsResult);
		xsmcSetString(xsVar(0), msg.type == kOffer ? "offer" : msg.type == kMessage ? "message" : msg.type == kError ? "error" : msg.type == kDisconnected ? "disconnected" : "released");
		xsmcSet(xsResult, xsID("type"), xsVar(0));
		if (msg.data) {
			xsmcSetString(xsVar(0), msg.data);
			xsmcSet(xsResult, xsID(msg.type == kOffer ? "sdp" : "data"), xsVar(0));
		}
		if (msg.type == kError) {
			xsmcSetInteger(xsVar(0), msg.code); xsmcSet(xsResult, xsID("code"), xsVar(0));
			xsmcSetString(xsVar(0), t->failureStage ? t->failureStage : "webrtc"); xsmcSet(xsResult, xsID("stage"), xsVar(0));
		}
	}
	xsCatch { free(msg.data); xsThrow(xsException); }
	free(msg.data);
}
void xs_live_transport_release(xsMachine *the)
{
	LiveTransport *t = xsmcGetHostData(xsThis);
	if (!t) return;
	if (!atomic_load(&t->done)) xsUnknownError("Transport is still running");
	xsmcSetHostData(xsThis, NULL);
	dispose(t);
}
void xs_live_transport_stats(xsMachine *the)
{
	LiveTransport *t = xsmcGetHostData(xsThis);
	if (!t) return;
	LiveAudioStats stats;
	portENTER_CRITICAL(&t->lock);
	stats = t->stats;
	portEXIT_CRITICAL(&t->lock);
	xsmcVars(1);
	xsmcSetNewObject(xsResult);
#define STAT(name, value) xsmcSetNumber(xsVar(0), value); xsmcSet(xsResult, xsID(name), xsVar(0))
	STAT("capturedSamples", stats.captured);
	STAT("sourceSamples", stats.sourceSamples);
	STAT("requestedRate", stats.requestedRate);
	STAT("requestedChannels", stats.requestedChannels);
	STAT("sourceFrameBytes", stats.sourceFrameBytes);
	STAT("encodedFrames", atomic_load(&t->encodedFrames));
	STAT("encodedPts", atomic_load(&t->encodedPts));
	STAT("peerEvents", atomic_load(&t->peerEvents));
	STAT("lastPeerEvent", atomic_load(&t->lastPeerEvent));
	STAT("dataMessages", atomic_load(&t->dataMessages));
	STAT("renderedSamples", stats.rendered);
	STAT("audibleMs", stats.audibleMs);
	STAT("underruns", stats.underruns);
	STAT("overruns", stats.overruns);
	STAT("micLevel", stats.micLevel);
	STAT("cleanLevel", stats.cleanLevel);
	STAT("referenceLevel", stats.referenceLevel);
	STAT("outputIdleMs", stats.outputIdleMs);
	STAT("silenceMs", stats.silenceMs);
	STAT("maxSilenceMs", stats.maxSilenceMs);
	STAT("freeHeap", heap_caps_get_free_size(MALLOC_CAP_8BIT));
	STAT("freeInternalHeap", heap_caps_get_free_size(MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT));
#undef STAT
}

void xs_live_transport_diagnostics(xsMachine *the)
{
#if CONFIG_FREERTOS_GENERATE_RUN_TIME_STATS
	/* Optional, infrequent probe. Never sample tasks in the audio callbacks. */
	TaskStatus_t tasks[48];
	configRUN_TIME_COUNTER_TYPE total;
	UBaseType_t count = uxTaskGetSystemState(tasks, 48, &total);
	xsmcVars(3);
	xsmcSetNewObject(xsResult);
	xsmcSetNumber(xsVar(0), total); xsmcSet(xsResult, xsID("totalUs"), xsVar(0));
	xsmcSetNewArray(xsVar(1), 0);
	for (UBaseType_t i = 0; i < count; i++) {
		xsmcSetNewObject(xsVar(2));
		xsmcSetString(xsVar(0), (xsStringValue)tasks[i].pcTaskName); xsmcSet(xsVar(2), xsID("name"), xsVar(0));
		xsmcSetNumber(xsVar(0), tasks[i].ulRunTimeCounter); xsmcSet(xsVar(2), xsID("runUs"), xsVar(0));
		xsmcSetInteger(xsVar(0), tasks[i].uxCurrentPriority); xsmcSet(xsVar(2), xsID("priority"), xsVar(0));
		xsmcSetInteger(xsVar(0), tasks[i].usStackHighWaterMark); xsmcSet(xsVar(2), xsID("stackFree"), xsVar(0));
		xsmcSetIndex(xsVar(1), i, xsVar(2));
	}
	xsmcSet(xsResult, xsID("tasks"), xsVar(1));
#endif
}
