#pragma once
#include <stdbool.h>
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_HTTP_EAGAIN -2
#define HTTP_EVENT_ON_DATA 1
#define HTTP_EVENT_REDIRECT 2
#define HTTP_METHOD_GET 1
#define HTTP_METHOD_POST 2
#define HTTP_TRANSPORT_OVER_SSL 3
typedef void *esp_http_client_handle_t;
typedef struct { int event_id,data_len; void *data,*user_data; } esp_http_client_event_t;
typedef struct {
  const char *url; int method,timeout_ms,buffer_size,buffer_size_tx,transport_type,max_authorization_retries;
  bool skip_cert_common_name_check,disable_auto_redirect,is_async;
  esp_err_t (*event_handler)(esp_http_client_event_t *);
  void *user_data; esp_err_t (*crt_bundle_attach)(void *);
} esp_http_client_config_t;
esp_http_client_handle_t esp_http_client_init(const esp_http_client_config_t *);
esp_err_t esp_http_client_set_header(esp_http_client_handle_t,const char *,const char *);
esp_err_t esp_http_client_delete_header(esp_http_client_handle_t,const char *);
esp_err_t esp_http_client_set_post_field(esp_http_client_handle_t,const char *,int);
esp_err_t esp_http_client_perform(esp_http_client_handle_t);
int esp_http_client_get_status_code(esp_http_client_handle_t);
esp_err_t esp_http_client_cleanup(esp_http_client_handle_t);
esp_err_t esp_http_client_close(esp_http_client_handle_t);

esp_err_t esp_http_client_get_and_clear_last_tls_error(esp_http_client_handle_t,int *,int *);

#define ESP_ERR_HTTP_INVALID_TRANSPORT (0x7000 + 5)
