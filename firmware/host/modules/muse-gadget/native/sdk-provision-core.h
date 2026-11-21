#pragma once
#include <stdbool.h>
bool muse_sdk_provision_open(void);
int muse_sdk_provision_poll(void);
void muse_sdk_provision_close(void);
