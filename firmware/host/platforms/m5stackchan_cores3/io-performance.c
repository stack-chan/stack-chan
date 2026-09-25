#include "xsAll.h"
#include "xsHost.h"
#include "xsmc.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "modSPI.h"
#include "io-performance.h"
#include <string.h>

extern int stackchanOpusOriginalComplexity, stackchanOpusOriginalBitrate, stackchanOpusOriginalMode;
static portMUX_TYPE lock = portMUX_INITIALIZER_UNLOCKED;
static int enabled;
static int64_t pending[3], maxDelay[3], lastAudio[2], maxAudioGap[2];
static int64_t lastUpdate[3], maxUpdateGap[3];
static uint32_t frames, updates[3], violations[3], audioCalls[2];
static const char *names[] = {"text", "mouth", "gesture"};

void xs_io_now(xsMachine *the) { xsmcSetNumber(xsResult, esp_timer_get_time() / 1000.0); }
void xs_io_reset(xsMachine *the) {
  portENTER_CRITICAL(&lock);
  enabled = 1; frames = 0;
  memset(pending, 0, sizeof(pending)); memset(maxDelay, 0, sizeof(maxDelay));
  memset(lastUpdate, 0, sizeof(lastUpdate)); memset(maxUpdateGap, 0, sizeof(maxUpdateGap));
  memset(updates, 0, sizeof(updates)); memset(violations, 0, sizeof(violations));
  memset(lastAudio, 0, sizeof(lastAudio)); memset(maxAudioGap, 0, sizeof(maxAudioGap));
  memset(audioCalls, 0, sizeof(audioCalls));
  portEXIT_CRITICAL(&lock);
}
void xs_io_mark(xsMachine *the) {
  const char *name = xsmcToString(xsArg(0)); int which = -1;
  for (int i = 0; i < 3; i++) if (!strcmp(names[i], name)) which = i;
  if (which < 0) xsRangeError("unknown display measurement");
  int64_t at = xsmcToNumber(xsArg(1)) * 1000;
  portENTER_CRITICAL(&lock);
  if (enabled && (!pending[which] || at < pending[which])) pending[which] = at;
  portEXIT_CRITICAL(&lock);
}
void stackchanFrameComplete(void) {
  if (!enabled) return;
  // Piu finished all dirty regions; include the last queued DMA transaction.
  modSPIFlush();
  int64_t now = esp_timer_get_time();
  portENTER_CRITICAL(&lock);
  frames++;
  for (int i = 0; i < 3; i++) if (pending[i]) {
    int64_t elapsed = now - pending[i];
    if (elapsed > maxDelay[i]) maxDelay[i] = elapsed;
    if (elapsed >= 500000) violations[i]++;
    if (lastUpdate[i] && now - lastUpdate[i] > maxUpdateGap[i]) maxUpdateGap[i] = now - lastUpdate[i];
    lastUpdate[i] = now;
    updates[i]++; pending[i] = 0;
  }
  portEXIT_CRITICAL(&lock);
}
void stackchanAudioReset(void) {
  portENTER_CRITICAL(&lock);
  memset(lastAudio, 0, sizeof(lastAudio));
  portEXIT_CRITICAL(&lock);
}
void stackchanAudioProgress(unsigned direction, int64_t now) {
  portENTER_CRITICAL(&lock);
  if (enabled) {
    if (lastAudio[direction] && now - lastAudio[direction] > maxAudioGap[direction])
      maxAudioGap[direction] = now - lastAudio[direction];
    lastAudio[direction] = now; audioCalls[direction]++;
  }
  portEXIT_CRITICAL(&lock);
}
void xs_io_stats(xsMachine *the) {
  txMachine *machine = (txMachine *)the;
  int64_t delays[3], gaps[2], waiting[3], updateGaps[3]; uint32_t count, n[3], bad[3], calls[2];
  portENTER_CRITICAL(&lock);
  count = frames;
  memcpy(delays,maxDelay,sizeof(delays)); memcpy(gaps,maxAudioGap,sizeof(gaps));
  memcpy(waiting,pending,sizeof(waiting)); memcpy(n,updates,sizeof(n));
  memcpy(bad,violations,sizeof(bad)); memcpy(calls,audioCalls,sizeof(calls));
  memcpy(updateGaps,maxUpdateGap,sizeof(updateGaps));
  portEXIT_CRITICAL(&lock);
  xsmcVars(2); xsmcSetNewObject(xsResult);
  xsmcSetInteger(xsVar(0),machine->currentHeapCount); xsmcSet(xsResult,xsID("heapUsed"),xsVar(0));
  xsmcSetInteger(xsVar(0),machine->maximumHeapCount); xsmcSet(xsResult,xsID("heapSize"),xsVar(0));
  xsmcSetInteger(xsVar(0),machine->currentChunksSize); xsmcSet(xsResult,xsID("chunkUsed"),xsVar(0));
  xsmcSetInteger(xsVar(0),machine->maximumChunksSize); xsmcSet(xsResult,xsID("chunkSize"),xsVar(0));
  xsmcSetInteger(xsVar(0),xPortGetCoreID()); xsmcSet(xsResult,xsID("currentCore"),xsVar(0));
  xsmcSetInteger(xsVar(0),xTaskGetCoreID(NULL)); xsmcSet(xsResult,xsID("affinity"),xsVar(0));
  xsmcSetInteger(xsVar(0),stackchanOpusOriginalMode); xsmcSet(xsResult,xsID("originalOpusMode"),xsVar(0));
  xsmcSetInteger(xsVar(0),stackchanOpusOriginalComplexity); xsmcSet(xsResult,xsID("originalOpusComplexity"),xsVar(0));
  xsmcSetInteger(xsVar(0),stackchanOpusOriginalBitrate); xsmcSet(xsResult,xsID("originalOpusBitrate"),xsVar(0));
  xsmcSetInteger(xsVar(0),count); xsmcSet(xsResult,xsID("frames"),xsVar(0));
  for (int i=0;i<3;i++) {
    xsmcSetNewObject(xsVar(1));
    xsmcSetNumber(xsVar(0),delays[i]/1000.0); xsmcSet(xsVar(1),xsID("maxMs"),xsVar(0));
    xsmcSetNumber(xsVar(0),updateGaps[i]/1000.0); xsmcSet(xsVar(1),xsID("maxGapMs"),xsVar(0));
    xsmcSetInteger(xsVar(0),n[i]); xsmcSet(xsVar(1),xsID("count"),xsVar(0));
    xsmcSetInteger(xsVar(0),bad[i]); xsmcSet(xsVar(1),xsID("violations"),xsVar(0));
    xsmcSetNumber(xsVar(0),waiting[i]?(esp_timer_get_time()-waiting[i])/1000.0:0); xsmcSet(xsVar(1),xsID("pendingMs"),xsVar(0));
    xsmcSet(xsResult,xsID(names[i]),xsVar(1));
  }
  for (int i=0;i<2;i++) {
    xsmcSetNewObject(xsVar(1));
    xsmcSetNumber(xsVar(0),gaps[i]/1000.0); xsmcSet(xsVar(1),xsID("maxGapMs"),xsVar(0));
    xsmcSetInteger(xsVar(0),calls[i]); xsmcSet(xsVar(1),xsID("count"),xsVar(0));
    xsmcSet(xsResult,xsID(i?"capture":"playback"),xsVar(1));
  }
}
void xs_io_main_priority(xsMachine *the) {
  int priority = xsmcToInteger(xsArg(0));
  if (priority != 4 && priority != 6) xsRangeError("supported main priorities: 4, 6");
  if (strcmp(pcTaskGetName(NULL), "main")) xsUnknownError("main thread required");
  vTaskPrioritySet(NULL, priority);
}
