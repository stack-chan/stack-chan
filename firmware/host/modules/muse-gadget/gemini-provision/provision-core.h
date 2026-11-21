#pragma once
#include <stdbool.h>
#define GEMINI_KEY_MAX 512
bool gemini_key_input_open(void);
int gemini_key_input_poll(void);
void gemini_key_input_close(void);
