#include "xsmc.h"
#include "xsHost.h"
#include "account-owner.h"
#include "muse-transport.h"

typedef struct { xsMachine *the; const char *app; MuseTransportStage stage; } AccountTransport;
static bool configure(void *context, const char *host, const char *vm, const char *token) {
  AccountTransport *c = context;
  xsMachine *the = c->the;
  bool ok = false;
  xsTry {
    muse_transport_initialize_diagnostic(the, host, vm, token, c->app, &c->stage);
    ok = true;
  }
  xsCatch {
    xs_muse_close(the);
  }
  return ok;
}
void xs_muse_account_constructor(xsMachine *the) {
  char app[65] = {0};
  if (xsmcArgc > 1) xsmcToStringBuffer(xsArg(1), app, sizeof(app));
  AccountTransport context = {the, app, MUSE_TRANSPORT_NONE};
  MuseAccountResult result = muse_account_owner_configure(the, xsArg(0), configure, &context);
  if (result != MA_OK) {
    switch(context.stage) {
      case MUSE_TRANSPORT_CONFIGURATION: xsUnknownError("Muse account transport configuration");
      case MUSE_TRANSPORT_RECORD: xsUnknownError("Muse account transport allocation");
      case MUSE_TRANSPORT_NOISE: xsUnknownError("Muse account Noise initialization");
      case MUSE_TRANSPORT_WEBSOCKET: xsUnknownError("Muse account WebSocket initialization");
      case MUSE_TRANSPORT_EVENTS: xsUnknownError("Muse account WebSocket events");
      case MUSE_TRANSPORT_START: xsUnknownError("Muse account WebSocket start");
      default: xsUnknownError("Muse account transport unavailable");
    }
  }
}
