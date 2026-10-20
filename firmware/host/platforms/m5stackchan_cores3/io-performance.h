#ifndef STACKCHAN_IO_PERFORMANCE_H
#define STACKCHAN_IO_PERFORMANCE_H
#include <stdint.h>
void stackchanFrameComplete(void);
void stackchanAudioProgress(unsigned direction, int64_t at);
void stackchanAudioReset(void);
#endif
