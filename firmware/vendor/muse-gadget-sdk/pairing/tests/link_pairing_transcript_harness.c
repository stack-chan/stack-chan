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

#include "pairing_transcript.h"

#include <assert.h>
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
    if (argc != 12) return 2;
    bool community = atoi(argv[1]) != 0;
    int epoch = atoi(argv[2]);
    const char *policy = argv[3];
    pairing_transcript_fields_t fields = {
        .device_id = argv[4], .node_id = argv[5], .mac = argv[6],
        .firmware_version = argv[7], .mobile_pub = argv[8], .device_pub = argv[9],
        .mobile_nonce = argv[10], .device_nonce = argv[11],
    };
    assert(pairing_transcript_build(true, 1, policy, &fields) == NULL);
    assert(pairing_transcript_build(false, 0, policy, &fields) == NULL);
    assert(pairing_transcript_build(false, -1, policy, &fields) == NULL);
    assert(pairing_transcript_build(false, 1, PAIRING_POLICY_APP, &fields) == NULL);
    assert(pairing_transcript_build(community, epoch, NULL, &fields) == NULL);
    assert(pairing_transcript_build(community, epoch, "unknown_policy", &fields) == NULL);
    assert(pairing_transcript_build(community, epoch, policy, NULL) == NULL);
    char *transcript = pairing_transcript_build(community, epoch, policy, &fields);
    assert(transcript != NULL);
    fputs(transcript, stdout);
    free(transcript);
    return 0;
}
