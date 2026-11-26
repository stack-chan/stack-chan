#include "driver-stubs.h"
#include "driver-functions.inc"

int main(int argc, char **argv)
{
    bool fragmented = argc > 1 && !strcmp(argv[1], "tail-fragment");
    closeAtWrite = argc > 1 && !strcmp(argv[1], "close");
    shortWrite = argc > 1 && !strcmp(argv[1], "short-write");
    out.dma_buf_size = sizeof(stage);
    out.total_dma_buf_size = 10240;
    out.bytesWritable = 4096;
    out.useCount = 2;
    out.callbackPending = true;
    out.started = true;
    out.volumeFixed = argc > 1 && !strcmp(argv[1], "unity-gain") ? 256 : 12;
    out.stagingBuffer = stage;
    out.elements = &element;
    element.data = samples;
    element.bytesAvailable = sizeof(samples);
    element.completion = &xsResult;
    for (int i = 0; i < 4096; i++) samples[i] = i % 2500 - 1250;
    if (fragmented) {
        element.bytesAvailable = 2;
        element.next = &tail;
        tail.bytesAvailable = sizeof(padding);
        tail.data = padding;
        tail.completion = &xsResult;
    }

#if STOCK
    audioOutLoop(&out);
#else
    out.fixedOnly = true;
    fixedOutLoop(&out);
    if (closeAtWrite) {
        assert(length == sizeof(stage) && element.bytesAvailable == sizeof(samples) - sizeof(stage));
        assert(!callbacks && !releases && !posts);
        puts("Interrupted write stopped at the current DMA block.");
        return 0;
    }
    if (shortWrite) {
        assert(element.err != ESP_OK && out.completionReady);
        puts("Short IDF write marked the page as failed.");
        return 0;
    }
#endif

    size_t frames = fragmented ? (2 + sizeof(padding)) / 2 : 4096;
    size_t correct = 0;
    while (correct < frames && (correct + 1) * 2 <= length) {
        int16_t value;
        memcpy(&value, captured + correct * 2, sizeof(value));
        int input = fragmented && correct > 0 ? 0 : samples[correct];
        if (value != ((input * out.volumeFixed) >> 8)) break;
        correct++;
    }
    printf("PCM bytes %zu/%zu, matching samples %zu/%zu\n", length, frames * 2, correct, frames);
    if (length != frames * 2 || correct != frames) return 1;

#if !STOCK
    assert(callbacks == fragmented && releases == fragmented);
    out.closing = false;
    i2s_event_data_t event = {sizeof(stage)};
    playedBuffer(NULL, &event, &out);
    assert(!posts && !out.callbackPending && out.completionReady && out.useCount == 1);
    playedBuffer(NULL, &event, &out);
    assert(posts == 1 && out.callbackPending && !out.completionReady && out.useCount == 2);
    audiooutDeliver(NULL, &out, NULL, 0);
    assert(callbacks == fragmented + 1 && releases == callbacks && !out.elements && out.useCount == 1);
    puts("A full machine queue retried on the next DMA interrupt and delivered one completion.");
#endif
    return 0;
}
