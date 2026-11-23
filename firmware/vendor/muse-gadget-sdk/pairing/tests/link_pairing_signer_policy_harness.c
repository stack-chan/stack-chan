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

#include <assert.h>
#include <stdbool.h>

#include "pairing_signer_policy.h"

int main(void) {
    for (int unused = 0; unused <= 1; unused++) {
        for (int expected_purpose = 0; expected_purpose <= 1;
             expected_purpose++) {
            for (int read_protected = 0; read_protected <= 1;
                 read_protected++) {
                for (int write_protected = 0; write_protected <= 1;
                     write_protected++) {
                    for (int purpose_locked = 0; purpose_locked <= 1;
                         purpose_locked++) {
                        pairing_signer_t expected = PAIRING_SIGNER_UNAVAILABLE;
                        if (unused && !expected_purpose && !read_protected
                            && !write_protected && !purpose_locked) {
                            expected = PAIRING_SIGNER_COMMUNITY;
                        } else if (!unused && expected_purpose && read_protected
                                   && write_protected && purpose_locked) {
                            expected = PAIRING_SIGNER_EFUSE;
                        }

                        assert(pairing_signer_classify(
                                   unused, expected_purpose, read_protected,
                                   write_protected, purpose_locked)
                               == expected);
                    }
                }
            }
        }
    }
    return 0;
}
