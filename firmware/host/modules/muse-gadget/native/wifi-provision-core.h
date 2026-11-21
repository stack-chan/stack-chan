#pragma once
#include <stdbool.h>
bool muse_wifi_provision_open(void);
int muse_wifi_provision_poll(void);
bool muse_wifi_provision_connect(void);
void muse_wifi_provision_close(void);
