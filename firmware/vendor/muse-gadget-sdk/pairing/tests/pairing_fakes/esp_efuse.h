/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#pragma once
#include <stdbool.h>
typedef int esp_efuse_block_t;
typedef int esp_efuse_purpose_t;
#define EFUSE_BLK_KEY0 4
#define EFUSE_BLK_KEY_MAX 10
#define ESP_EFUSE_KEY_PURPOSE_ECDSA_KEY 9
extern int test_fuse_state, test_efuse_reads;
static inline bool esp_efuse_key_block_unused(int b) { (void)b; test_efuse_reads++; return test_fuse_state == 0; }
static inline int esp_efuse_get_key_purpose(int b) { (void)b; return test_fuse_state == 0 ? 0 : ESP_EFUSE_KEY_PURPOSE_ECDSA_KEY; }
static inline bool esp_efuse_get_key_dis_read(int b) { (void)b; return test_fuse_state == 1; }
static inline bool esp_efuse_get_key_dis_write(int b) { (void)b; return test_fuse_state == 1; }
static inline bool esp_efuse_get_keypurpose_dis_write(int b) { (void)b; return test_fuse_state == 1; }
