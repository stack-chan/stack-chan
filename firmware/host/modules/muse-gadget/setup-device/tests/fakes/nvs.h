#pragma once
#include <stddef.h>
typedef int esp_err_t; typedef unsigned nvs_handle_t;
#define ESP_OK 0
#define ESP_ERR_NVS_NOT_FOUND 1
#define ESP_ERR_NVS_TYPE_MISMATCH 2
#define NVS_READONLY 0
int nvs_open(const char *,int,nvs_handle_t *);
void nvs_close(nvs_handle_t);
int nvs_get_blob(nvs_handle_t,const char *,void *,size_t *);
int nvs_get_str(nvs_handle_t,const char *,char *,size_t *);
