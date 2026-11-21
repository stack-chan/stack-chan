#include "xsmc.h"
#include "xsHost.h"
#include "account-owner.h"
#include "account-wifi-driver.h"
#include <math.h>
void xs_muse_account_wifi(xsMachine *the) {
  double n=xsmcToNumber(xsArg(1));
  if (!isfinite(n) || n<1 || n>UINT32_MAX || floor(n)!=n) xsRangeError("invalid account generation");
  uint32_t generation=(uint32_t)n;
  uint32_t watch=muse_account_wifi_watch();
  if(!watch)xsUnknownError("Muse account WiFi unavailable");
  xsTry {
    if (muse_account_owner_wifi(the, xsArg(0), generation, muse_account_wifi_apply, NULL) != MA_OK)
      xsUnknownError("Muse account WiFi unavailable");
  }
  xsCatch {
    muse_account_wifi_unwatch(watch);
    xsThrow(xsException);
  }
  xsmcSetInteger(xsResult,(xsIntegerValue)watch);
}

static uint32_t wifiWatchToken(xsMachine *the) {
  double n=xsmcToNumber(xsArg(0));
  return isfinite(n) && n>=1 && n<=0xFFFFFF && floor(n)==n ? (uint32_t)n : 0;
}
void xs_muse_account_wifi_reason(xsMachine *the) {
  xsmcSetString(xsResult,muse_account_wifi_reason(wifiWatchToken(the)));
}
void xs_muse_account_wifi_close(xsMachine *the) {
  if(!muse_account_wifi_unwatch(wifiWatchToken(the)))xsUnknownError("Muse account WiFi close failed");
}
