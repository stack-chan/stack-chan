#include "xsmc.h"
#include "xsHost.h"
#include "model-storage.h"
#include "psa/crypto.h"
#include <stdio.h>
#include <string.h>

static uint32_t inUse;

int sano_model_claim(void) {
    uint32_t expected = 0;
    return __atomic_compare_exchange_n(&inUse, &expected, 1, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE);
}

void sano_model_release(SanoModel *model) {
    if (model->mapped)
        esp_partition_munmap(model->mapping);
    memset(model, 0, sizeof(*model));
    __atomic_store_n(&inUse, 0, __ATOMIC_RELEASE);
}

static int fail(char *error, size_t size, const char *message) {
    snprintf(error, size, "%s", message);
    return 0;
}

int sano_model_open_claimed(SanoModel *model, char *error, size_t errorBytes) {
    const esp_partition_t *partition = esp_partition_find_first(ESP_PARTITION_TYPE_DATA, 0x40, SANO_MODEL_PARTITION_LABEL);
    if (!partition || partition->address != SANO_MODEL_PARTITION_ADDRESS ||
        partition->size != SANO_MODEL_PARTITION_BYTES || partition->encrypted)
        return fail(error, errorBytes, "missing or incompatible sanoTTS model partition");

    uint8_t header[SANO_MODEL_HEADER_BYTES];
    if (esp_partition_read(partition, 0, header, sizeof(header)) != ESP_OK || !sano_model_header_check(header))
        return fail(error, errorBytes, "sanoTTS model missing or uncommitted");

    const void *base = NULL;
    if (esp_partition_mmap(partition, SANO_MODEL_OFFSET, SANO_MODEL_BYTES, ESP_PARTITION_MMAP_DATA,
                           &base, &model->mapping) != ESP_OK)
        return fail(error, errorBytes, "sanoTTS model mmap failed");

    uint8_t digest[32];
    size_t length = 0;
    if (((uintptr_t)base & 15) || psa_crypto_init() != PSA_SUCCESS ||
        psa_hash_compute(PSA_ALG_SHA_256, base, SANO_MODEL_BYTES, digest, sizeof(digest), &length) != PSA_SUCCESS ||
        length != sizeof(digest) || memcmp(digest, sano_model_digest, sizeof(digest))) {
        esp_partition_munmap(model->mapping);
        return fail(error, errorBytes, "sanoTTS model SHA-256 or alignment mismatch");
    }
    model->mapped = 1;
    model->payload = base;
    return 1;
}

void xs_sano_model_status(xsMachine *the) {
    if (!sano_model_claim())
        xsUnknownError("sanoTTS model is in use");
    SanoModel model = {0};
    char error[96] = {0};
    int valid = sano_model_open_claimed(&model, error, sizeof(error));
    sano_model_release(&model);

    xsmcVars(1);
    xsmcSetNewObject(xsResult);
    xsmcSetBoolean(xsVar(0), valid);
    xsmcSet(xsResult, xsID("valid"), xsVar(0));
    xsmcSetString(xsVar(0), valid ? "verified" : error);
    xsmcSet(xsResult, xsID("reason"), xsVar(0));
}
