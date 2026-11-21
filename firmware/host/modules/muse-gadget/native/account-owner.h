#pragma once
#include "xs.h"
#include "account-session-core.h"
MuseAccountResult muse_account_owner_configure(xsMachine *,xsSlot,MuseAccountNoiseSink,void *);
MuseAccountResult muse_account_owner_wifi(xsMachine *,xsSlot,uint32_t,MuseAccountWiFiSink,void *);
