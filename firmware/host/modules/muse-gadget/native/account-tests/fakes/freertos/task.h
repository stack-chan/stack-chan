#pragma once
void vTaskDelay(int);
void vTaskDelete(void *);
int xTaskCreate(void (*)(void *),const char *,unsigned,void *,unsigned,void *);
