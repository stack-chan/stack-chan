#pragma once
#include "account-session-core.h"
#include "account-http.h"
typedef struct MuseAccountWorker MuseAccountWorker;
MuseAccountWorker *muse_account_worker_start(MuseAccount **owner,uint32_t generation,const char *device_id);
bool muse_account_worker_done(MuseAccountWorker *);
bool muse_account_worker_take(MuseAccountWorker *,MuseAccount **owner,MuseAccountResult *result);
void muse_account_worker_cancel(MuseAccountWorker *);
void muse_account_worker_release(MuseAccountWorker *);
MuseAccountHTTPReason muse_account_worker_http_reason(MuseAccountWorker *);
