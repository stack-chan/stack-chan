#pragma once
#include <stdbool.h>
#define OPENAI_KEY_MAX 512
bool openai_key_input_open(void);
int openai_key_input_poll(void);
void openai_key_input_close(void);
