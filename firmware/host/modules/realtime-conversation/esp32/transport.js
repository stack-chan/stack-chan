// Copyright (c) 2026 Shinya Ishikawa
// SPDX-License-Identifier: Apache-2.0

import { createTransport } from 'realtimeConversation/transport-core'
import Timer from 'timer'

export default createTransport({ Timer, Native, native, ArrayBuffer })
