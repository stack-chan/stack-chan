#include "xsmc.h"
#include "xsHost.h"
#include "wifi-provision-core.h"
void xs_muse_wifi_open(xsMachine *the){if(!muse_wifi_provision_open())xsUnknownError("USB unavailable");}
void xs_muse_wifi_poll(xsMachine *the){xsmcSetInteger(xsResult,muse_wifi_provision_poll());}
void xs_muse_wifi_connect(xsMachine *the){xsmcSetBoolean(xsResult,muse_wifi_provision_connect());}
void xs_muse_wifi_close(xsMachine *the){(void)the;muse_wifi_provision_close();}
