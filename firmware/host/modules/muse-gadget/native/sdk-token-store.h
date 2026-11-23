#pragma once
#include <stdbool.h>
#define MUSE_SDK_TOKEN_LENGTH 48
typedef enum { MSDK_OK, MSDK_ABSENT, MSDK_INVALID, MSDK_IO, MSDK_EXISTS, MSDK_BUSY } MuseSDKResult;
bool muse_sdk_token_valid(const char *);
bool muse_sdk_pairing_privacy(void);
MuseSDKResult muse_sdk_token_presence(void);
MuseSDKResult muse_sdk_token_read(char out[MUSE_SDK_TOKEN_LENGTH+1]);
