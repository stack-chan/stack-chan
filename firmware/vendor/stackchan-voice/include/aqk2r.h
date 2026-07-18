#ifndef AQK2R_H
#define AQK2R_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

#define SIZE_AQK2R_MIN_WORK_BUF (21u * 1024u)

#define AQK2R_OK                 0u
#define AQK2R_ERR_GENERAL      100u
#define AQK2R_ERR_ARGUMENT     101u
#define AQK2R_ERR_WORKBUF      102u
#define AQK2R_ERR_OUTPUT       103u
#define AQK2R_ERR_NOT_READY    104u
#define AQK2R_ERR_UNREADABLE   105u
#define AQK2R_ERR_DIC_OPEN     200u
#define AQK2R_ERR_DIC_READ     210u
#define AQK2R_ERR_DIC_FORMAT   211u
#define AQK2R_ERR_DIC_VERSION  220u

/* Application-provided external dictionary access. The returned base may be
 * any non-zero, 4-byte-aligned virtual address. */
size_t aqdic_open(void);
size_t aqdic_read(size_t pos, size_t size, void *buf);
void aqdic_close(void);

uint8_t CAqK2R_Create(uint8_t *workbuf, uint32_t workbuf_size);
uint8_t CAqK2R_Convert(const char *utf8_text, char *roman_out, uint32_t roman_out_size);
void CAqK2R_Release(void);

#ifdef __cplusplus
}
#endif

#endif
