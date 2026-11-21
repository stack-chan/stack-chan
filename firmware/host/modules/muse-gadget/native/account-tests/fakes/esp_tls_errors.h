/* SPDX-FileCopyrightText: 2021-22 Espressif Systems (Shanghai) CO LTD
 * SPDX-License-Identifier: Apache-2.0
 */
#pragma once
#define ESP_ERR_ESP_TLS_BASE           0x8000             /*!< Starting number of ESP-TLS error codes */
#define ESP_ERR_ESP_TLS_CANNOT_RESOLVE_HOSTNAME           (ESP_ERR_ESP_TLS_BASE + 0x01)  /*!< Error if hostname couldn't be resolved upon tls connection */
#define ESP_ERR_ESP_TLS_CANNOT_CREATE_SOCKET              (ESP_ERR_ESP_TLS_BASE + 0x02)  /*!< Failed to create socket */
#define ESP_ERR_ESP_TLS_UNSUPPORTED_PROTOCOL_FAMILY       (ESP_ERR_ESP_TLS_BASE + 0x03)  /*!< Unsupported protocol family */
#define ESP_ERR_ESP_TLS_FAILED_CONNECT_TO_HOST            (ESP_ERR_ESP_TLS_BASE + 0x04)  /*!< Failed to connect to host */
#define ESP_ERR_ESP_TLS_SOCKET_SETOPT_FAILED              (ESP_ERR_ESP_TLS_BASE + 0x05)  /*!< failed to set/get socket option */
#define ESP_ERR_ESP_TLS_CONNECTION_TIMEOUT                (ESP_ERR_ESP_TLS_BASE + 0x06)  /*!< new connection in esp_tls_low_level_conn connection timeouted */
#define ESP_ERR_ESP_TLS_SE_FAILED                         (ESP_ERR_ESP_TLS_BASE + 0x07)  /*< esp-tls use Secure Element returned failed */
#define ESP_ERR_ESP_TLS_TCP_CLOSED_FIN                    (ESP_ERR_ESP_TLS_BASE + 0x08)  /*< esp-tls's TPC transport connection has benn closed (in a clean way) */
#define ESP_ERR_ESP_TLS_SERVER_HANDSHAKE_TIMEOUT          (ESP_ERR_ESP_TLS_BASE + 0x09)  /*!< TLS handshake timeout */
#define ESP_ERR_MBEDTLS_CERT_PARTLY_OK                    (ESP_ERR_ESP_TLS_BASE + 0x10)  /*!< mbedtls parse certificates was partly successful */
#define ESP_ERR_MBEDTLS_CTR_DRBG_SEED_FAILED              (ESP_ERR_ESP_TLS_BASE + 0x11)  /*!< mbedtls api returned error */
#define ESP_ERR_MBEDTLS_SSL_SET_HOSTNAME_FAILED           (ESP_ERR_ESP_TLS_BASE + 0x12)  /*!< mbedtls api returned error */
#define ESP_ERR_MBEDTLS_SSL_CONFIG_DEFAULTS_FAILED        (ESP_ERR_ESP_TLS_BASE + 0x13)  /*!< mbedtls api returned error */
#define ESP_ERR_MBEDTLS_SSL_CONF_ALPN_PROTOCOLS_FAILED    (ESP_ERR_ESP_TLS_BASE + 0x14)  /*!< mbedtls api returned error */
#define ESP_ERR_MBEDTLS_X509_CRT_PARSE_FAILED             (ESP_ERR_ESP_TLS_BASE + 0x15)  /*!< mbedtls api returned error */
#define ESP_ERR_MBEDTLS_SSL_CONF_OWN_CERT_FAILED          (ESP_ERR_ESP_TLS_BASE + 0x16)  /*!< mbedtls api returned error */
#define ESP_ERR_MBEDTLS_SSL_SETUP_FAILED                  (ESP_ERR_ESP_TLS_BASE + 0x17)  /*!< mbedtls api returned error */
#define ESP_ERR_MBEDTLS_SSL_WRITE_FAILED                  (ESP_ERR_ESP_TLS_BASE + 0x18)  /*!< mbedtls api returned error */
#define ESP_ERR_MBEDTLS_PK_PARSE_KEY_FAILED               (ESP_ERR_ESP_TLS_BASE + 0x19)  /*!< mbedtls api returned failed  */
#define ESP_ERR_MBEDTLS_SSL_HANDSHAKE_FAILED              (ESP_ERR_ESP_TLS_BASE + 0x1A)  /*!< mbedtls api returned failed  */
#define ESP_ERR_MBEDTLS_SSL_CONF_PSK_FAILED               (ESP_ERR_ESP_TLS_BASE + 0x1B)  /*!< mbedtls api returned failed  */
#define ESP_ERR_MBEDTLS_SSL_TICKET_SETUP_FAILED           (ESP_ERR_ESP_TLS_BASE + 0x1C)  /*!< mbedtls api returned failed  */
#define ESP_ERR_MBEDTLS_SSL_READ_FAILED                   (ESP_ERR_ESP_TLS_BASE + 0x1D)  /*!< mbedtls api returned failed  */
