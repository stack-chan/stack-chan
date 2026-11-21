#pragma once
#include <stddef.h>
typedef void *QueueHandle_t;
typedef struct {size_t size; unsigned count; unsigned char *bytes; int is_static;} StaticQueue_t;
#define pdTRUE 1
#define pdMS_TO_TICKS(n) (n)
#define portMAX_DELAY (-1)
QueueHandle_t xQueueCreate(unsigned,size_t);
int xQueueSend(QueueHandle_t,const void *,int);
int xQueueReceive(QueueHandle_t,void *,int);
void vQueueDelete(QueueHandle_t);

QueueHandle_t xQueueCreateStatic(unsigned,size_t,unsigned char *,StaticQueue_t *);
