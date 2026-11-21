#include "xsmc.h"
#include "xsHost.h"
#include "sdk-provision-core.h"
void xs_muse_sdk_provision_open(xsMachine *the){if(!muse_sdk_provision_open())xsUnknownError("USB setup unavailable");}
void xs_muse_sdk_provision_poll(xsMachine *the){xsmcSetInteger(xsResult,muse_sdk_provision_poll());}
void xs_muse_sdk_provision_close(xsMachine *the){(void)the;muse_sdk_provision_close();}
