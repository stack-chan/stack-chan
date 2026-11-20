// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0
#include "xsmc.h"
#include "xsHost.h"
#include <stdlib.h>

void xs_native_transport_test_destructor(void *data) { free(data); }
void xs_native_transport_test_open(xsMachine *the)
{
    int *data = malloc(sizeof(int));
    if (!data) xsUnknownError("no test state");
    *data = 123;
    xsmcSetHostData(xsThis, data);
}
void xs_native_transport_test_read(xsMachine *the)
{
    int *data = xsmcGetHostData(xsThis);
    if (!data) xsUnknownError("native base was not initialized");
    xsmcSetInteger(xsResult, *data);
}
