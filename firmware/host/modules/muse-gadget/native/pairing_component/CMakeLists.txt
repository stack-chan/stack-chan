get_filename_component(PAIRING_COMPONENT_REAL "${CMAKE_CURRENT_LIST_DIR}" REALPATH)
set(PAIRING_ROOT "${PAIRING_COMPONENT_REAL}/../../../../../vendor/muse-gadget-sdk/pairing")
set(CJSON_ROOT "${PAIRING_ROOT}/managed_components/espressif__cjson/cJSON")
idf_component_register(
  SRCS "${PAIRING_ROOT}/main/link_pairing.c"
    "${PAIRING_ROOT}/main/pairing_transcript.c"
    "${PAIRING_ROOT}/main/pairing_signer_policy.c"
    "${CJSON_ROOT}/cJSON.c"
    "${PAIRING_COMPONENT_REAL}/../account-session-core.c"
    "${PAIRING_COMPONENT_REAL}/../account-nvs.c"
    "${PAIRING_COMPONENT_REAL}/../setup-metadata-core.c"
    "${PAIRING_COMPONENT_REAL}/../account-http.c"
    "${PAIRING_COMPONENT_REAL}/../gemini-native-http.c"
    "${PAIRING_COMPONENT_REAL}/../account-worker.c"
    "${PAIRING_COMPONENT_REAL}/../sdk-token-store.c"
  INCLUDE_DIRS "${PAIRING_ROOT}/main" "${CJSON_ROOT}"
  PRIV_REQUIRES esp_driver_usb_serial_jtag mbedtls esp_timer efuse nvs_flash esp_http_client esp-tls esp_wifi
)
target_compile_definitions(${COMPONENT_LIB} PRIVATE CONFIG_HOMEHUB_PAIRING_AUTH_EPOCH=1)
if(CONFIG_HOMEHUB_PAIRING_EFUSE_AUTH)
  message(FATAL_ERROR "This integration is community pairing only; manufacturer eFuse attestation is not configured")
endif()
