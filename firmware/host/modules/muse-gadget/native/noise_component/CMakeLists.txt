get_filename_component(MUSE_COMPONENT_REAL "${CMAKE_CURRENT_LIST_DIR}" REALPATH)
set(NOISE_ROOT "${MUSE_COMPONENT_REAL}/../../../../../vendor/muse-gadget-sdk/noise_core")
idf_component_register(SRCS "noise_api.cpp"
  "${NOISE_ROOT}/src/ClientSession.cpp" "${NOISE_ROOT}/src/InitiatorHandshake.cpp"
  "${NOISE_ROOT}/src/PsaCryptoBackend.cpp" "${NOISE_ROOT}/src/ServiceCodec.cpp"
  "${NOISE_ROOT}/src/Status.cpp" "${NOISE_ROOT}/src/Transport.cpp" "${NOISE_ROOT}/src/TransportFrameCodec.cpp"
  INCLUDE_DIRS ".." "${NOISE_ROOT}/include" PRIV_REQUIRES mbedtls)
target_compile_features(${COMPONENT_LIB} PRIVATE cxx_std_17)
target_compile_options(${COMPONENT_LIB} PRIVATE -std=c++17 -fno-exceptions -fno-rtti)
