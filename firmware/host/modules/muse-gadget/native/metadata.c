#include "xsmc.h"
#include "xsHost.h"
#include "setup-metadata-core.h"
void xs_muse_setup_metadata(xsMachine *the) {
  MuseSetupMetadata info;
  if (!muse_setup_metadata(&info)) xsUnknownError("setup state unavailable");
  xsmcVars(1); xsmcSetNewObject(xsResult);
  xsmcSetBoolean(xsVar(0),info.stored); xsmcSet(xsResult,xsID("setupComplete"),xsVar(0));
  xsmcSetBoolean(xsVar(0),info.sdkReady); xsmcSet(xsResult,xsID("sdkReady"),xsVar(0));
  xsmcSetString(xsVar(0),info.id); xsmcSet(xsResult,xsID("nodeId"),xsVar(0));
  xsmcSetString(xsVar(0),info.device); xsmcSet(xsResult,xsID("deviceId"),xsVar(0));
  xsmcSetString(xsVar(0),info.mac); xsmcSet(xsResult,xsID("mac"),xsVar(0));
  xsmcSetString(xsVar(0),"stackchan-host"); xsmcSet(xsResult,xsID("firmwareVersion"),xsVar(0));
}
