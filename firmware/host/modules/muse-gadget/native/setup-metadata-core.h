#pragma once
#include <stdbool.h>
typedef struct { bool stored, sdkReady; char id[32]; char mac[18]; char device[32]; } MuseSetupMetadata;
bool muse_setup_metadata(MuseSetupMetadata *);
