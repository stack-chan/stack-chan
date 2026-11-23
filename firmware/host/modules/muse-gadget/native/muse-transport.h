#pragma once
#include "xs.h"
void muse_transport_initialize(xsMachine *, const char *, const char *, const char *, const char *);
void xs_muse_close(xsMachine *);
typedef enum {
  MUSE_TRANSPORT_NONE, MUSE_TRANSPORT_CONFIGURATION, MUSE_TRANSPORT_RECORD,
  MUSE_TRANSPORT_NOISE, MUSE_TRANSPORT_WEBSOCKET, MUSE_TRANSPORT_EVENTS,
  MUSE_TRANSPORT_START
} MuseTransportStage;
void muse_transport_initialize_diagnostic(xsMachine *,const char *,const char *,const char *,const char *,MuseTransportStage *);
