#pragma once
#include <stdbool.h>
bool muse_account_wifi_apply(void *,const char *,const char *);
#include <stdint.h>
uint32_t muse_account_wifi_watch(void);
const char *muse_account_wifi_reason(uint32_t);
bool muse_account_wifi_unwatch(uint32_t);
