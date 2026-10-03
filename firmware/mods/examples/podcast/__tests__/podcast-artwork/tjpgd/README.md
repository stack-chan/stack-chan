TJpgDec R0.03 by ChaN, copied from Espressif esp_jpeg 1.3.1 (tjpgd/).

This simulator test dependency exercises the same streaming API and thumbnail callbacks as the ESP32-S3 ROM implementation. Production uses rom/tjpgd.h and links the ROM decoder; these files are only built by this test manifest. Configuration enables RGB888 and reduced decoding with a 3100-byte pool. Copyright and redistribution terms are retained in tjpgd.c and tjpgd.h.

Sources: https://components.espressif.com/components/espressif/esp_jpeg/versions/1.3.1 and http://elm-chan.org/fsw/tjpgd/00index.html
