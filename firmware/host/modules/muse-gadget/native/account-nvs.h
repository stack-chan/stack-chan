#pragma once
#include <stdbool.h>
#include <stddef.h>
#include "account-session-core.h"
bool muse_account_nvs_store(void *, const char *, const char *, const void *, size_t);
MuseAccount *muse_account_nvs_restore(uint32_t);
typedef enum { MA_RESTORE_OK, MA_RESTORE_ABSENT, MA_RESTORE_INVALID, MA_RESTORE_IO } MuseAccountRestoreResult;
MuseAccountRestoreResult muse_account_nvs_restore_result(uint32_t,MuseAccount **);
bool muse_account_device_id(char *,size_t);
