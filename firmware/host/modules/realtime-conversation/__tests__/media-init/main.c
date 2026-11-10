#define _POSIX_C_SOURCE 200809L
#include <assert.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

extern int stackchanRealtimeMediaInit(void);
extern int stackchanRealtimeCodecInit(void);

static atomic_int calls, installing, failures, errors;
static int failFirst;
static atomic_int encoderCalls, decoderCalls, registering;
static int failEncoder, failDecoder, codecs;

void vTaskDelay(unsigned ticks)
{
	struct timespec delay = {.tv_nsec = ticks * 1000000};
	nanosleep(&delay, NULL);
}

int media_lib_add_default_adapter(void)
{
	assert(atomic_fetch_add(&installing, 1) == 0);
	int invocation = atomic_fetch_add(&calls, 1);
	vTaskDelay(10);
	atomic_fetch_sub(&installing, 1);
	return !codecs && failFirst && !invocation ? 77 : 0;
}

int esp_audio_enc_register_default(void)
{
	assert(atomic_fetch_add(&registering, 1) == 0);
	int invocation = atomic_fetch_add(&encoderCalls, 1);
	vTaskDelay(2);
	atomic_fetch_sub(&registering, 1);
	return failEncoder && !invocation ? 77 : 0;
}

int esp_audio_dec_register_default(void)
{
	assert(atomic_fetch_add(&registering, 1) == 0);
	int invocation = atomic_fetch_add(&decoderCalls, 1);
	vTaskDelay(2);
	atomic_fetch_sub(&registering, 1);
	return failDecoder && !invocation ? 77 : 0;
}

static void *initialize(void *unused)
{
	(void)unused;
	int result = codecs ? stackchanRealtimeCodecInit() : stackchanRealtimeMediaInit();
	if (result == 77) atomic_fetch_add(&failures, 1);
	else if (result != 0) atomic_fetch_add(&errors, 1);
	return NULL;
}

int main(int argc, char **argv)
{
	assert(argc == 2);
	assert(atomic_load(&calls) == 0);
	failFirst = strstr(argv[1], "retry") != NULL;
	codecs = strstr(argv[1], "codec") != NULL;
	failEncoder = strstr(argv[1], "encoder-retry") != NULL;
	failDecoder = strstr(argv[1], "decoder-retry") != NULL;
	if (codecs) {
		// Ordinary MP3/Opus allocator initialization does not register codecs.
		assert(stackchanRealtimeMediaInit() == 0);
		assert(atomic_load(&encoderCalls) == 0);
		assert(atomic_load(&decoderCalls) == 0);
		if (strncmp(argv[1], "concurrent", 10) == 0) {
			pthread_t threads[32];
			for (unsigned i = 0; i < 32; i++) assert(!pthread_create(&threads[i], NULL, initialize, NULL));
			for (unsigned i = 0; i < 32; i++) assert(!pthread_join(threads[i], NULL));
			assert(atomic_load(&errors) == 0);
			assert(atomic_load(&failures) == (failFirst ? 1 : 0));
		} else if (failFirst) {
			assert(stackchanRealtimeCodecInit() == 77);
			assert(atomic_load(&decoderCalls) == (failEncoder ? 0 : 1));
		}
		for (unsigned i = 0; i < 64; i++) assert(stackchanRealtimeCodecInit() == 0);
		assert(atomic_load(&encoderCalls) == (failFirst ? 2 : 1));
		assert(atomic_load(&decoderCalls) == (failDecoder ? 2 : 1));
		assert(atomic_load(&registering) == 0);
		assert(atomic_load(&calls) == 1);
		puts("native codec initialization/retry contract passed");
		return 0;
	}
	if (strncmp(argv[1], "concurrent", 10) == 0) {
		pthread_t threads[32];
		for (unsigned i = 0; i < 32; i++) assert(!pthread_create(&threads[i], NULL, initialize, NULL));
		for (unsigned i = 0; i < 32; i++) assert(!pthread_join(threads[i], NULL));
		assert(atomic_load(&errors) == 0);
		assert(atomic_load(&failures) == (failFirst ? 1 : 0));
	} else if (failFirst) {
		assert(stackchanRealtimeMediaInit() == 77);
	}
	for (unsigned i = 0; i < 64; i++) assert(stackchanRealtimeMediaInit() == 0);
	assert(atomic_load(&calls) == (failFirst ? 2 : 1));
	assert(atomic_load(&installing) == 0);
	puts("native adapter initialization contract passed");
	return 0;
}
