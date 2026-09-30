# Test-only interception of SDK calls; SDK sources are compiled unchanged.
idf_component_register()
target_link_options(${COMPONENT_LIB} INTERFACE
    "-Wl,--wrap=PocoDrawingEnd" "-Wl,--wrap=PiuRegionEmpty")

# Opt-in SystemView capture: mark codec calls without changing codec sources.
if(CONFIG_STACKCHAN_TASK_TRACE)
    target_link_options(${COMPONENT_LIB} INTERFACE
        "-Wl,--wrap=esp_audio_enc_process" "-Wl,--wrap=esp_audio_dec_process")
endif()
