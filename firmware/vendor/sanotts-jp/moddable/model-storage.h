#ifndef SANO_MODEL_STORAGE_H
#define SANO_MODEL_STORAGE_H
#include <stddef.h>
#include <stdint.h>
#include "esp_partition.h"
#include "model-format.h"

typedef struct {
    const uint8_t *payload;
    esp_partition_mmap_handle_t mapping;
    int mapped;
} SanoModel;

/* Claim before worker startup. The owner releases the mapping after the worker exits. */
int sano_model_claim(void);
void sano_model_release(SanoModel *model);
int sano_model_open_claimed(SanoModel *model, char *error, size_t errorBytes);
#endif
