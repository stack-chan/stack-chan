/* Copyright (c) 2026 Shinya Ishikawa. SPDX-License-Identifier: Apache-2.0 */
#include "esp_partition.h"
#include "mc.defines.h"

/* Only the ECMA-419 Files object calls this adapter. The legacy File object
 * retains its own partition and mount. SDK sources are compiled unchanged. */
const esp_partition_t *stackchanFilesPartitionFindFirst(esp_partition_type_t type,
        esp_partition_subtype_t subtype, const char *label)
{
#ifdef MODDEF_FILES_PARTITION
    label = MODDEF_FILES_PARTITION;
#endif
    return esp_partition_find_first(type, subtype, label);
}
