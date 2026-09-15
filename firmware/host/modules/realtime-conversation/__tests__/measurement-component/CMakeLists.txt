# Test-only interception of SDK calls; SDK sources are compiled unchanged.
idf_component_register()
target_link_options(${COMPONENT_LIB} INTERFACE
    "-Wl,--wrap=PocoDrawingEnd" "-Wl,--wrap=PiuRegionEmpty")
