#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef unsigned xsUnsignedValue;
typedef int esp_err_t;
typedef int xsMachine;
typedef void *xsSlot;
typedef int BaseType_t;
typedef void *TaskHandle_t;
typedef void *i2s_chan_handle_t;
typedef struct { uint32_t size; } i2s_event_data_t;

#include "driver-records.inc"

#define C_NULL NULL
#define pdFALSE 0
#define pdTRUE 1
#define eSetValueWithOverwrite 0
#define portYIELD_FROM_ISR() ((void)0)
#define portMAX_DELAY 10000
#define ESP_OK 0
#define ESP_FAIL 8
#define c_memcpy memcpy
#define xsBeginHost(x)
#define xsEndHost(x)
#define xsTry if (1)
#define xsCatch else
#define xsmcSetInteger(...)
#define xsNew1(...) NULL
#define xsmcSetNull(x)
#define xsReference(x) ((void *)(x))
#define xsmcGetBufferReadable(...) abort()
#define xsCallFunction1(...) (callbacks++)
#define builtinCriticalSectionBegin()
#define builtinCriticalSectionEnd()
#define modMessagePostToMachine(...) ((void)0)
#define xTaskNotifyFromISR(...) ((void)0)
#define vTaskDelete(...)

static AudioOutRecord out;
static AudioOutElementRecord element, tail;
static uint8_t padding[14334];
static uint8_t captured[16384], stage[2048];
static int16_t samples[4096];
static size_t length;
static int callbacks, releases, posts, ticks;
static bool firstWrite = true, refusePost = true, closeAtWrite, shortWrite;
static void *xsResult;

static void audiooutDeliver(void *, void *, uint8_t *, uint16_t);
static int doWrite(AudioOut, void *, xsUnsignedValue);

static void c_free(void *address)
{
    assert(address == &element || address == &tail);
    releases++;
}

static int i2s_channel_write(void *channel, void *pcm, size_t size, size_t *written, int timeout)
{
    *written = shortWrite ? size / 2 : size;
    assert(length + *written <= sizeof(captured));
    memcpy(captured + length, pcm, *written);
    length += *written;
    if (firstWrite) {
        firstWrite = false;
        // Deliver an already-posted machine callback while the IDF write is yielding.
        audiooutDeliver(NULL, &out, NULL, 0);
#if !STOCK
        if (closeAtWrite) out.closing = true;
#endif
    }
    return ESP_OK;
}

static int i2s_channel_preload_data(void *ch, void *pcm, size_t n, size_t *written)
{
    return i2s_channel_write(ch, pcm, n, written, 0);
}

static int modMessagePostToMachineFromISR(void *machine, void (*cb)(void *, void *, uint8_t *, uint16_t), void *ctx)
{
    if (refusePost) {
        refusePost = false;
        return -1;
    }
    posts++;
    return 0;
}

static void xTaskNotifyWait(unsigned clearBefore, unsigned clearAfter, uint32_t *state, int timeout)
{
    // The first wake consumes queued PCM. Once the native loop returns to sleep, end the test task.
    *state = ticks++ ? 2 : 1;
#if !STOCK
    if (*state == 2) out.closing = true;
#endif
}
