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

#include "muse_voice_call_core.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ---- JSON ---- */

static const char *ws(const char *p, const char *e)
{
    while (p < e && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) {
        p++;
    }
    return p;
}

static int hexval(char c)
{
    if (c >= '0' && c <= '9') {
        return c - '0';
    }
    if (c >= 'a' && c <= 'f') {
        return c - 'a' + 10;
    }
    if (c >= 'A' && c <= 'F') {
        return c - 'A' + 10;
    }
    return -1;
}

/* p at the opening quote; returns just past the closing one, or NULL. */
static const char *scan_string(const char *p, const char *e)
{
    for (p++; p < e;) {
        unsigned char c = (unsigned char)*p++;
        if (c == '"') {
            return p;
        }
        if (c < 0x20) {
            return NULL;
        }
        if (c != '\\') {
            continue;
        }
        if (p >= e) {
            return NULL;
        }
        char x = *p++;
        if (x == 'u') {
            for (int i = 0; i < 4; i++, p++) {
                if (p >= e || hexval(*p) < 0) {
                    return NULL;
                }
            }
        } else if (!(x == '"' || x == '\\' || x == '/' || x == 'b' || x == 'f' || x == 'n' || x == 'r' || x == 't')) {
            return NULL;
        }
    }
    return NULL;
}

static const char *scan_digits(const char *p, const char *e)
{
    const char *s = p;
    while (p < e && *p >= '0' && *p <= '9') {
        p++;
    }
    return p == s ? NULL : p;
}

static const char *scan_number(const char *p, const char *e)
{
    if (p < e && *p == '-') {
        p++;
    }
    if (p < e && *p == '0') {
        p++;
    } else if (!(p = scan_digits(p, e))) {
        return NULL;
    }
    if (p < e && *p == '.' && !(p = scan_digits(p + 1, e))) {
        return NULL;
    }
    if (p < e && (*p == 'e' || *p == 'E')) {
        p++;
        if (p < e && (*p == '+' || *p == '-')) {
            p++;
        }
        if (!(p = scan_digits(p, e))) {
            return NULL;
        }
    }
    return p;
}

static const char *scan_literal(const char *p, const char *e, const char *lit)
{
    size_t n = strlen(lit);
    return (size_t)(e - p) >= n && !memcmp(p, lit, n) ? p + n : NULL;
}

static const char *scan_value(const char *p, const char *e, int depth, muse_vc_jkind_t *kind);

static const char *scan_container(const char *p, const char *e, int depth, bool object)
{
    char close = object ? '}' : ']';
    p = ws(p + 1, e);
    if (p < e && *p == close) {
        return p + 1;
    }
    for (;;) {
        muse_vc_jkind_t k;
        if (object) {
            if (p >= e || *p != '"' || !(p = scan_string(p, e))) {
                return NULL;
            }
            p = ws(p, e);
            if (p >= e || *p != ':') {
                return NULL;
            }
            p = ws(p + 1, e);
        }
        if (!(p = scan_value(p, e, depth + 1, &k))) {
            return NULL;
        }
        p = ws(p, e);
        if (p < e && *p == ',') {
            p = ws(p + 1, e);
            continue;
        }
        return p < e && *p == close ? p + 1 : NULL;
    }
}

static const char *scan_value(const char *p, const char *e, int depth, muse_vc_jkind_t *kind)
{
    if (p >= e || depth >= MUSE_VC_JSON_DEPTH) {
        return NULL;
    }
    switch (*p) {
    case '"':
        *kind = MUSE_VC_J_STRING;
        return scan_string(p, e);
    case '{':
        *kind = MUSE_VC_J_OBJECT;
        return scan_container(p, e, depth, true);
    case '[':
        *kind = MUSE_VC_J_ARRAY;
        return scan_container(p, e, depth, false);
    case 't':
        *kind = MUSE_VC_J_TRUE;
        return scan_literal(p, e, "true");
    case 'f':
        *kind = MUSE_VC_J_FALSE;
        return scan_literal(p, e, "false");
    case 'n':
        *kind = MUSE_VC_J_NULL;
        return scan_literal(p, e, "null");
    default:
        *kind = MUSE_VC_J_NUMBER;
        return scan_number(p, e);
    }
}

bool muse_vc_json_valid(const char *json, size_t len)
{
    const char *e = json + len;
    muse_vc_jkind_t k;
    const char *p = scan_value(ws(json, e), e, 0, &k);
    return p && ws(p, e) == e;
}

/* Finds `key` among the members of the object at p (which must be valid). */
static muse_vc_jkind_t find_member(const char *p, const char *e, const char *key, size_t key_len, const char **vs,
                                   const char **ve)
{
    p = ws(p, e);
    if (p >= e || *p != '{') {
        return MUSE_VC_J_NONE;
    }
    p = ws(p + 1, e);
    while (p < e && *p == '"') {
        const char *ks = p + 1;
        const char *kend = scan_string(p, e);
        if (!kend) {
            return MUSE_VC_J_NONE;
        }
        p = ws(kend, e);
        if (p >= e || *p != ':') {
            return MUSE_VC_J_NONE;
        }
        p = ws(p + 1, e);
        muse_vc_jkind_t kind;
        const char *v = p;
        if (!(p = scan_value(p, e, 1, &kind))) {
            return MUSE_VC_J_NONE;
        }
        if ((size_t)(kend - 1 - ks) == key_len && !memcmp(ks, key, key_len)) {
            *vs = v;
            *ve = p;
            return kind;
        }
        p = ws(p, e);
        if (p < e && *p == ',') {
            p = ws(p + 1, e);
        }
    }
    return MUSE_VC_J_NONE;
}

/* json_get without the validity pass, for a line already checked. */
static muse_vc_jkind_t get_checked(const char *json, size_t len, const char *path, muse_vc_span_t *out)
{
    const char *s = json, *e = json + len;
    muse_vc_jkind_t kind = MUSE_VC_J_NONE;
    while (*path) {
        const char *dot = strchr(path, '.');
        size_t n = dot ? (size_t)(dot - path) : strlen(path);
        const char *vs, *ve;
        kind = find_member(s, e, path, n, &vs, &ve);
        if (kind == MUSE_VC_J_NONE) {
            return kind;
        }
        s = vs;
        e = ve;
        path += n + (dot ? 1 : 0);
        if (dot && kind != MUSE_VC_J_OBJECT) {
            return MUSE_VC_J_NONE;
        }
    }
    if (kind == MUSE_VC_J_STRING) {
        out->p = s + 1;
        out->n = (size_t)(e - s) - 2;
    } else {
        out->p = s;
        out->n = (size_t)(e - s);
    }
    return kind;
}

muse_vc_jkind_t muse_vc_json_get(const char *json, size_t len, const char *path, muse_vc_span_t *out)
{
    if (!muse_vc_json_valid(json, len)) {
        return MUSE_VC_J_NONE;
    }
    return get_checked(json, len, path, out);
}

static size_t utf8_put(uint32_t cp, char *o)
{
    if (cp < 0x80) {
        o[0] = (char)cp;
        return 1;
    }
    if (cp < 0x800) {
        o[0] = (char)(0xC0 | (cp >> 6));
        o[1] = (char)(0x80 | (cp & 0x3F));
        return 2;
    }
    if (cp < 0x10000) {
        o[0] = (char)(0xE0 | (cp >> 12));
        o[1] = (char)(0x80 | ((cp >> 6) & 0x3F));
        o[2] = (char)(0x80 | (cp & 0x3F));
        return 3;
    }
    o[0] = (char)(0xF0 | (cp >> 18));
    o[1] = (char)(0x80 | ((cp >> 12) & 0x3F));
    o[2] = (char)(0x80 | ((cp >> 6) & 0x3F));
    o[3] = (char)(0x80 | (cp & 0x3F));
    return 4;
}

static bool hex4(const char *p, const char *e, uint32_t *v)
{
    *v = 0;
    for (int i = 0; i < 4; i++) {
        int h = p + i < e ? hexval(p[i]) : -1;
        if (h < 0) {
            return false;
        }
        *v = *v << 4 | (uint32_t)h;
    }
    return true;
}

/* As muse_vc_json_unescape, also giving the decoded length (which counts
 * decoded NULs) and whether it was cut short to fit. */
static bool unescape_n(muse_vc_span_t raw, char *out, size_t cap, size_t *len, bool *truncated);

bool muse_vc_json_unescape(muse_vc_span_t raw, char *out, size_t cap)
{
    size_t len;
    bool truncated;
    return unescape_n(raw, out, cap, &len, &truncated);
}

static bool unescape_n(muse_vc_span_t raw, char *out, size_t cap, size_t *len, bool *truncated)
{
    *len = 0;
    *truncated = false;
    if (!cap) {
        return false;
    }
    const char *p = raw.p, *e = raw.p + raw.n;
    size_t o = 0;
    bool full = false;
    while (p < e) {
        char tmp[4];
        size_t n;
        if (*p != '\\') {
            tmp[0] = *p++;
            n = 1;
        } else {
            if (p + 1 >= e) {
                return false;
            }
            char x = p[1];
            p += 2;
            uint32_t cp;
            switch (x) {
            case '"': cp = '"'; break;
            case '\\': cp = '\\'; break;
            case '/': cp = '/'; break;
            case 'b': cp = '\b'; break;
            case 'f': cp = '\f'; break;
            case 'n': cp = '\n'; break;
            case 'r': cp = '\r'; break;
            case 't': cp = '\t'; break;
            case 'u':
                if (!hex4(p, e, &cp)) {
                    return false;
                }
                p += 4;
                if (cp >= 0xD800 && cp < 0xDC00) {
                    uint32_t lo;
                    if (e - p >= 6 && p[0] == '\\' && p[1] == 'u' && hex4(p + 2, e, &lo) && lo >= 0xDC00 && lo < 0xE000) {
                        cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                        p += 6;
                    } else {
                        cp = 0xFFFD;
                    }
                } else if (cp >= 0xDC00 && cp < 0xE000) {
                    cp = 0xFFFD;
                }
                break;
            default:
                return false;
            }
            n = utf8_put(cp, tmp);
        }
        if (full) {
            continue;   /* keep validating the escapes */
        }
        if (o + n >= cap) {
            full = true;
            continue;
        }
        memcpy(out + o, tmp, n);
        o += n;
    }
    /* A raw multi-byte character cut short by the cap: drop its lead bytes. */
    if (full) {
        size_t k = o;
        while (k > 0 && ((unsigned char)out[k - 1] & 0xC0) == 0x80) {
            k--;
        }
        if (k > 0 && ((unsigned char)out[k - 1] & 0x80)) {
            unsigned char lead = (unsigned char)out[k - 1];
            size_t want = lead >= 0xF0 ? 4 : lead >= 0xE0 ? 3 : 2;
            if (o - (k - 1) < want) {
                o = k - 1;
            }
        }
    }
    out[o] = '\0';
    *len = o;
    *truncated = full;
    return true;
}

bool muse_vc_json_escape(const char *s, char *out, size_t cap)
{
    size_t o = 0;
    for (; *s; s++) {
        unsigned char c = (unsigned char)*s;
        char tmp[7];
        size_t n;
        if (c == '"' || c == '\\') {
            tmp[0] = '\\';
            tmp[1] = (char)c;
            n = 2;
        } else if (c < 0x20) {
            n = (size_t)snprintf(tmp, sizeof(tmp), "\\u%04x", c);
        } else {
            tmp[0] = (char)c;
            n = 1;
        }
        if (o + n >= cap) {
            return false;
        }
        memcpy(out + o, tmp, n);
        o += n;
    }
    if (!cap) {
        return false;
    }
    out[o] = '\0';
    return true;
}

/* ---- base64 ---- */

static int b64val(char c)
{
    if (c >= 'A' && c <= 'Z') {
        return c - 'A';
    }
    if (c >= 'a' && c <= 'z') {
        return c - 'a' + 26;
    }
    if (c >= '0' && c <= '9') {
        return c - '0' + 52;
    }
    if (c == '+') {
        return 62;
    }
    if (c == '/') {
        return 63;
    }
    return -1;
}

long muse_vc_b64_decode(muse_vc_span_t raw, uint8_t *out, size_t cap)
{
    const char *p = raw.p, *e = raw.p + raw.n;
    uint32_t acc = 0;
    int have = 0, pad = 0;
    size_t o = 0;
    while (p < e) {
        char c = *p++;
        if (c == '\\') {
            if (p >= e || *p != '/') {
                return -1;
            }
            c = *p++;
        }
        if (c == '=') {
            /* Only one or two, and only at the very end. */
            if (have < 2 || ++pad > 2) {
                return -1;
            }
            have++;
        } else {
            int v = b64val(c);
            if (v < 0 || pad) {
                return -1;
            }
            acc = acc << 6 | (uint32_t)v;
            have++;
        }
        if (have == 4) {
            if (pad) {
                acc <<= 6 * pad;
            }
            uint8_t b[3] = { (uint8_t)(acc >> 16), (uint8_t)(acc >> 8), (uint8_t)acc };
            size_t n = 3 - (size_t)pad;
            if (o + n > cap) {
                return -1;
            }
            memcpy(out + o, b, n);
            o += n;
            acc = 0;
            have = 0;
            if (pad && p < e) {
                return -1;
            }
        }
    }
    return have ? -1 : (long)o;
}

size_t muse_vc_b64_encode(const uint8_t *in, size_t n, char *out)
{
    static const char abc[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    size_t o = 0;
    for (size_t i = 0; i < n; i += 3) {
        uint32_t v = (uint32_t)in[i] << 16;
        if (i + 1 < n) {
            v |= (uint32_t)in[i + 1] << 8;
        }
        if (i + 2 < n) {
            v |= in[i + 2];
        }
        out[o++] = abc[v >> 18 & 63];
        out[o++] = abc[v >> 12 & 63];
        out[o++] = i + 1 < n ? abc[v >> 6 & 63] : '=';
        out[o++] = i + 2 < n ? abc[v & 63] : '=';
    }
    return o;
}

/* ---- Events ---- */

/* An id member: its raw string span; present but not a string, an empty span
 * at the line (which no id check accepts); absent, untouched. */
static void get_id(const char *line, size_t len, const char *path, muse_vc_span_t *out);

static bool span_is(muse_vc_span_t s, const char *lit)
{
    size_t n = strlen(lit);
    return s.n == n && !memcmp(s.p, lit, n);
}

static bool span_is_nocase(muse_vc_span_t s, const char *lit)
{
    size_t n = strlen(lit);
    if (s.n != n) {
        return false;
    }
    for (size_t i = 0; i < n; i++) {
        char c = s.p[i];
        if (c >= 'A' && c <= 'Z') {
            c = (char)(c - 'A' + 'a');
        }
        if (c != lit[i]) {
            return false;
        }
    }
    return true;
}

/* Sets *out only if the member is a string. */
static bool get_string(const char *line, size_t len, const char *path, muse_vc_span_t *out)
{
    muse_vc_span_t v;
    if (get_checked(line, len, path, &v) != MUSE_VC_J_STRING) {
        return false;
    }
    *out = v;
    return true;
}

/* A JSON number span equal to `want`, as an integer. */
static bool number_is(muse_vc_span_t s, long want)
{
    char tmp[24];
    if (!s.n || s.n >= sizeof(tmp)) {
        return false;
    }
    memcpy(tmp, s.p, s.n);
    tmp[s.n] = '\0';
    char *end;
    double v = strtod(tmp, &end);
    return *end == '\0' && v == (double)want;
}

/* A count as the server writes one: plain digits, no sign, fraction or
 * exponent, within 32 bits. -1 for anything else. */
static int64_t count_value(muse_vc_span_t s)
{
    if (!s.n || s.n > 10 || (s.n > 1 && s.p[0] == '0')) {
        return -1;
    }
    int64_t v = 0;
    for (size_t i = 0; i < s.n; i++) {
        if (s.p[i] < '0' || s.p[i] > '9') {
            return -1;
        }
        v = v * 10 + (s.p[i] - '0');
    }
    return v <= UINT32_MAX ? v : -1;
}

static void get_id(const char *line, size_t len, const char *path, muse_vc_span_t *out)
{
    muse_vc_span_t v;
    muse_vc_jkind_t k = get_checked(line, len, path, &v);
    if (k == MUSE_VC_J_STRING) {
        *out = v;
    } else if (k != MUSE_VC_J_NONE) {
        out->p = line;
        out->n = 0;
    }
}

bool muse_vc_parse_event(const char *line, size_t len, muse_vc_event_t *ev)
{
    memset(ev, 0, sizeof(*ev));
    const char *p = ws(line, line + len);
    if (p >= line + len || *p != '{' || !muse_vc_json_valid(line, len)) {
        return false;
    }
    muse_vc_span_t type;
    if (!get_string(line, len, "type", &type)) {
        return false;
    }
    ev->kind = MUSE_VC_EV_OTHER;
    if (span_is(type, "continuous_audio_video.delta")) {
        /* The audio_delta also carries format {rate, type (may be "")},
         * num_channels and num_frames; video_delta and the timestamps are ignored. */
        if (get_string(line, len, "audio_delta.audio_frames", &ev->audio)) {
            muse_vc_span_t n;
            ev->kind = MUSE_VC_EV_AUDIO;
            ev->audio_rate_ok = true;
            ev->audio_cavd = true;
            get_id(line, len, "response_id", &ev->response_id);
            if (get_checked(line, len, "audio_delta.format.rate", &n) == MUSE_VC_J_NUMBER && !number_is(n, MUSE_VC_WIRE_RATE)) {
                ev->audio_rate_ok = false;
            }
            if (get_checked(line, len, "audio_delta.num_channels", &n) == MUSE_VC_J_NUMBER && !number_is(n, 1)) {
                ev->audio_rate_ok = false;
            }
        }
    } else if (span_is(type, "response.output_audio.delta")) {
        if (get_string(line, len, "delta", &ev->audio)) {
            ev->kind = MUSE_VC_EV_AUDIO;
            ev->audio_rate_ok = true;
        }
    } else if (span_is(type, "hatch.voice.session")) {
        ev->kind = MUSE_VC_EV_SESSION;
        get_id(line, len, "call_id", &ev->call_id);
        get_id(line, len, "session_id", &ev->session_id);
        get_id(line, len, "thread_id", &ev->thread_id);
    } else if (span_is(type, "input_audio_buffer.speech_started")) {
        ev->kind = MUSE_VC_EV_SPEECH_STARTED;
        get_string(line, len, "item_id", &ev->item_id);
    } else if (span_is(type, "input_audio_buffer.speech_stopped")) {
        ev->kind = MUSE_VC_EV_SPEECH_STOPPED;
        get_string(line, len, "item_id", &ev->item_id);
    } else if (span_is(type, "response.created")) {
        ev->kind = MUSE_VC_EV_RESPONSE_CREATED;
        get_id(line, len, "response.id", &ev->mapper_response_id);
        get_string(line, len, "response.submission_message_id", &ev->response_submission_id);
    } else if (span_is(type, "response.done") || span_is(type, "response.completed")) {
        ev->kind = MUSE_VC_EV_RESPONSE_DONE;
        get_id(line, len, "response.id", &ev->mapper_response_id);
        get_string(line, len, "response.status", &ev->status);
    } else if (span_is(type, "hatch.voice.turn_started")) {
        ev->kind = MUSE_VC_EV_TURN_STARTED;
        get_string(line, len, "submission_message_id", &ev->submission_id);
        get_string(line, len, "item_id", &ev->item_id);
    } else if (span_is(type, "hatch.voice.turn_settled")) {
        muse_vc_span_t n;
        ev->kind = MUSE_VC_EV_TURN_SETTLED;
        get_string(line, len, "response_message_id", &ev->response_message_id);
        if (get_checked(line, len, "async_handoffs_pending", &n) == MUSE_VC_J_NUMBER) {
            int64_t count = count_value(n);
            ev->handoffs_none = count == 0;
            ev->handoffs_open = count > 0;
        }
    } else if (span_is(type, "hatch.voice.input_suppressed")) {
        ev->kind = MUSE_VC_EV_INPUT_SUPPRESSED;
        get_string(line, len, "item_id", &ev->item_id);
    } else if (span_is(type, "hatch.voice.switch_input_hold")) {
        muse_vc_span_t held;
        muse_vc_jkind_t k = get_checked(line, len, "held", &held);
        if (k == MUSE_VC_J_TRUE || k == MUSE_VC_J_FALSE) {
            ev->kind = MUSE_VC_EV_HOLD;
            ev->held = k == MUSE_VC_J_TRUE;
        }
    } else if (span_is(type, "response.output_audio_transcript.delta")) {
        if (get_string(line, len, "delta", &ev->text)) {
            ev->kind = MUSE_VC_EV_REPLY_TEXT;
        }
    } else if (span_is(type, "response.output_audio_transcript.done")) {
        if (get_string(line, len, "transcript", &ev->text)) {
            ev->kind = MUSE_VC_EV_REPLY_DONE;
        }
    } else if (span_is(type, "conversation.item.input_audio_transcription.completed")) {
        if (get_string(line, len, "transcript", &ev->text)) {
            ev->kind = MUSE_VC_EV_USER_TEXT;
        }
    } else if (span_is(type, "conversation.item.added")) {
        muse_vc_span_t item_type, name;
        if (get_string(line, len, "item.type", &item_type) && span_is(item_type, "session_control") &&
            get_string(line, len, "item.name", &name) && span_is_nocase(name, "stop")) {
            ev->kind = MUSE_VC_EV_STOP;
        }
    } else if (span_is(type, "error")) {
        ev->kind = MUSE_VC_EV_ERROR;
        get_string(line, len, "error.code", &ev->code);
        get_string(line, len, "error.type", &ev->etype);
        get_string(line, len, "error.message", &ev->text);
    }
    return true;
}

/* ---- Lines ---- */

void muse_vc_lines_init(muse_vc_lines_t *l, char *buf, size_t cap)
{
    memset(l, 0, sizeof(*l));
    l->buf = buf;
    l->cap = cap;
}

void muse_vc_lines_feed(muse_vc_lines_t *l, const uint8_t *data, size_t len, muse_vc_line_fn fn, void *ctx,
                        const volatile bool *stop)
{
    while (len) {
        const uint8_t *nl = memchr(data, '\n', len);
        size_t take = nl ? (size_t)(nl - data) : len;
        if (!l->skipping) {
            if (l->len + take > l->cap) {
                l->skipping = true;
                l->skipped++;
                l->len = 0;
            } else {
                memcpy(l->buf + l->len, data, take);
                l->len += take;
            }
        }
        if (!nl) {
            return;
        }
        data += take + 1;
        len -= take + 1;
        if (l->skipping) {
            l->skipping = false;
        } else {
            size_t n = l->len;
            if (n && l->buf[n - 1] == '\r') {
                n--;
            }
            l->len = 0;
            if (n) {
                fn(ctx, l->buf, n);
            }
        }
        if (stop && *stop) {
            return;
        }
    }
}

/* ---- Audio ---- */

void muse_vc_resampler_init(muse_vc_resampler_t *r, int in_rate, int out_rate)
{
    /* Rounded up, so a call never writes more than n*out/in + 2 samples
     * (rounded down, 16->24 kHz would gain one extra every ~65k). */
    r->step = (uint32_t)((((uint64_t)in_rate << 16) + (uint64_t)out_rate - 1) / (uint64_t)out_rate);
    r->pos = 0;
    r->prev = 0;
}

size_t muse_vc_resample_bound(int in_rate, int out_rate, size_t n)
{
    return (size_t)((uint64_t)n * (uint64_t)out_rate / (uint64_t)in_rate) + 2;
}

/* At most this many input samples per pass, so the Q16 position (below
 * (n << 16) + step) stays within 32 bits on any size_t. */
#define RESAMPLE_BLOCK 32768

static size_t resample_block(muse_vc_resampler_t *r, const int16_t *in, uint32_t n, int16_t *out)
{
    size_t o = 0;
    /* Position 0 is the previous call's last sample; k is in[k-1]. */
    while ((r->pos >> 16) < n) {
        uint32_t i = r->pos >> 16;
        int32_t a = i ? in[i - 1] : r->prev;
        int32_t b = in[i];
        out[o++] = (int16_t)(a + (int32_t)(((int64_t)(b - a) * (int64_t)(r->pos & 0xffff)) >> 16));
        r->pos += r->step;
    }
    r->pos -= n << 16;
    r->prev = in[n - 1];
    return o;
}

size_t muse_vc_resample(muse_vc_resampler_t *r, const int16_t *in, size_t n, int16_t *out)
{
    size_t o = 0;
    while (n) {
        uint32_t k = n < RESAMPLE_BLOCK ? (uint32_t)n : RESAMPLE_BLOCK;
        o += resample_block(r, in, k, out + o);
        in += k;
        n -= k;
    }
    return o;
}

int muse_vc_peak(const int16_t *pcm, size_t n)
{
    int peak = 0;
    for (size_t i = 0; i < n; i++) {
        int v = pcm[i] < 0 ? -(int)pcm[i] : pcm[i];
        peak = v > peak ? v : peak;
    }
    return peak;
}

#define UP_PIECE 320   /* input samples resampled at a time: at most 482 out */
_Static_assert(sizeof(((muse_vc_uplink_t *)0)->piece) / sizeof(int16_t) >=
                   UP_PIECE * MUSE_VC_WIRE_RATE / MUSE_VC_MIC_RATE + 2,
               "the uplink's resample scratch must hold one piece's output");

void muse_vc_uplink_init(muse_vc_uplink_t *u)
{
    memset(u, 0, sizeof(*u));
    muse_vc_resampler_init(&u->up, MUSE_VC_MIC_RATE, MUSE_VC_WIRE_RATE);
}

void muse_vc_uplink_discard(muse_vc_uplink_t *u)
{
    u->fill = 0;
    muse_vc_resampler_init(&u->up, MUSE_VC_MIC_RATE, MUSE_VC_WIRE_RATE);
}

bool muse_vc_uplink_may_send(const muse_vc_uplink_t *u, int64_t now_us, int64_t live_us)
{
    int64_t elapsed = now_us > live_us ? now_us - live_us : 0;
    return (int64_t)(u->sent + MUSE_VC_FRAME) * 1000000 <= (1000000 + elapsed * 3 / 2) * MUSE_VC_WIRE_RATE;
}

static const char APPEND_HEAD[] = "{\"type\":\"input_audio_buffer.append\",\"audio\":\"";
static const char APPEND_TAIL[] = "\"}\n";

size_t muse_vc_uplink_push(muse_vc_uplink_t *u, const int16_t *pcm16, size_t n, char *line, size_t *line_len)
{
    size_t used = 0;
    *line_len = 0;
    while (used < n) {
        size_t take = n - used < UP_PIECE ? n - used : UP_PIECE;
        size_t got = muse_vc_resample(&u->up, pcm16 + used, take, u->piece);
        used += take;
        size_t room = MUSE_VC_FRAME - u->fill;
        size_t first = got < room ? got : room;
        memcpy(u->frame + u->fill, u->piece, first * sizeof(int16_t));
        u->fill += first;
        if (u->fill < MUSE_VC_FRAME) {
            continue;
        }
        uint8_t bytes[MUSE_VC_FRAME * 2];
        for (size_t i = 0; i < MUSE_VC_FRAME; i++) {
            uint16_t v = (uint16_t)u->frame[i];
            bytes[2 * i] = (uint8_t)v;
            bytes[2 * i + 1] = (uint8_t)(v >> 8);
        }
        size_t o = sizeof(APPEND_HEAD) - 1;
        memcpy(line, APPEND_HEAD, o);
        o += muse_vc_b64_encode(bytes, sizeof(bytes), line + o);
        memcpy(line + o, APPEND_TAIL, sizeof(APPEND_TAIL) - 1);
        o += sizeof(APPEND_TAIL) - 1;
        *line_len = o;
        u->sent += MUSE_VC_FRAME;
        /* The rest of this piece starts the next frame. */
        u->fill = got - first;
        memcpy(u->frame, u->piece + first, u->fill * sizeof(int16_t));
        break;
    }
    return used;
}

long muse_vc_decode_audio(muse_vc_resampler_t *down, muse_vc_span_t b64, uint8_t *scratch, size_t scratch_cap,
                          int16_t *out, bool *audible)
{
    *audible = false;
    long n = muse_vc_b64_decode(b64, scratch, scratch_cap);
    if (n < 0 || (n & 1)) {
        return -1;
    }
    size_t samples = (size_t)n / 2;
    int16_t *pcm = (int16_t *)(void *)scratch;
    for (size_t i = 0; i < samples; i++) {
        int16_t v = (int16_t)(uint16_t)(scratch[2 * i] | (uint16_t)scratch[2 * i + 1] << 8);
        memcpy(scratch + 2 * i, &v, sizeof(v));
    }
    *audible = muse_vc_peak(pcm, samples) >= MUSE_VC_AUDIBLE_PEAK;
    return (long)muse_vc_resample(down, pcm, samples, out);
}

/* ---- Half duplex ---- */

void muse_vc_gate_init(muse_vc_gate_t *g, bool full_duplex, int64_t tail_us)
{
    g->full_duplex = full_duplex;
    g->tail_us = tail_us;
    g->audible_until_us = 0;
}

void muse_vc_gate_playout(muse_vc_gate_t *g, const int16_t *pcm, size_t n, int64_t now_us, int64_t queued_us)
{
    if (muse_vc_peak(pcm, n) < MUSE_VC_AUDIBLE_PEAK) {
        return;
    }
    int64_t until = now_us + queued_us + (int64_t)n * 1000000 / MUSE_VC_MIC_RATE + g->tail_us;
    if (until > g->audible_until_us) {
        g->audible_until_us = until;
    }
}

void muse_vc_gate_flush(muse_vc_gate_t *g, int64_t now_us)
{
    if (g->audible_until_us > now_us + g->tail_us) {
        g->audible_until_us = now_us + g->tail_us;
    }
}

bool muse_vc_gate_mic_open(const muse_vc_gate_t *g, int64_t now_us)
{
    return g->full_duplex || now_us >= g->audible_until_us;
}

/* ---- Lifecycle ---- */

void muse_vc_call_init(muse_vc_call_t *c, const muse_vc_limits_t *limits, muse_vc_turns_t *turns)
{
    memset(c, 0, sizeof(*c));
    c->limits = *limits;
    c->turns = turns;
    memset(turns, 0, sizeof(*turns));
}

void muse_vc_call_begin(muse_vc_call_t *c, const char *call_id, int64_t now_us)
{
    muse_vc_limits_t limits = c->limits;
    muse_vc_turns_t *turns = c->turns;
    memset(c, 0, sizeof(*c));
    c->limits = limits;
    c->turns = turns;
    memset(turns, 0, sizeof(*turns));
    snprintf(c->call_id, sizeof(c->call_id), "%s", call_id);
    c->state = MUSE_VC_OPENING;
    c->start_us = now_us;
    c->media_open = true;
    c->end_call_needed = true;   /* from here on the server may hold a call for this id */
}

static uint32_t progress(muse_vc_call_t *c, int64_t now_us)
{
    uint32_t acts = 0;
    if (c->state != MUSE_VC_ENDING) {
        return 0;
    }
    if (c->end_call_pending) {
        acts |= MUSE_VC_ACT_END_CALL;
    }
    /* As the reference client does: the end-call first, then the half-close. */
    if (c->media_open && !c->half_closed && !c->end_call_pending && !c->end_call_open) {
        c->half_closed = true;
        c->half_closed_at_us = now_us;
        acts |= MUSE_VC_ACT_HALF_CLOSE;
    }
    if (!c->media_open && !c->end_call_pending && !c->end_call_open) {
        c->state = MUSE_VC_IDLE;
        acts |= MUSE_VC_ACT_ENDED;
    }
    return acts;
}

uint32_t muse_vc_call_hang_up(muse_vc_call_t *c, muse_vc_end_t why, int64_t now_us)
{
    if (c->state == MUSE_VC_IDLE || c->state == MUSE_VC_ENDING) {
        return 0;   /* the first reason stands */
    }
    bool was_live = c->state == MUSE_VC_LIVE;
    uint32_t acts = 0;
    c->reason = why;
    c->state = MUSE_VC_ENDING;
    c->end_us = now_us;
    c->end_call_pending = c->end_call_needed;
    bool graceful = was_live && (why == MUSE_VC_END_LOCAL || why == MUSE_VC_END_STOP || why == MUSE_VC_END_IDLE ||
                                 why == MUSE_VC_END_MAX);
    if (c->media_open && !graceful) {
        c->media_open = false;
        acts |= MUSE_VC_ACT_RESET_MEDIA;
    }
    return acts | progress(c, now_us);
}

uint32_t muse_vc_call_head(muse_vc_call_t *c, int status, int64_t now_us)
{
    if (c->state != MUSE_VC_OPENING) {
        return 0;
    }
    c->http_status = status;
    if (status < 200 || status >= 300) {
        return muse_vc_call_hang_up(c, status >= 400 ? MUSE_VC_END_REJECTED : MUSE_VC_END_FAILED, now_us);
    }
    c->state = MUSE_VC_CONNECTING;
    c->head_us = now_us;
    return 0;
}

void muse_vc_call_activity(muse_vc_call_t *c, int64_t now_us)
{
    if (c->state == MUSE_VC_LIVE) {
        c->activity_us = now_us;
    }
}

/* An id from the stream: present, 1..cap-1 bytes once unescaped, whole (one
 * that doesn't fit is refused, never shortened) and free of control
 * characters, so an escaped NUL can't make "id\u0000x" compare equal to "id". */
static bool take_id(muse_vc_span_t s, char *out, size_t cap)
{
    char probe[MUSE_VC_TURN_ID_MAX * 2];
    size_t n;
    bool truncated;
    out[0] = '\0';
    if (!s.p || !s.n || !unescape_n(s, probe, sizeof(probe), &n, &truncated) || truncated || !n || n >= cap) {
        return false;
    }
    for (size_t i = 0; i < n; i++) {
        unsigned char ch = (unsigned char)probe[i];
        if (ch < 0x20 || ch == 0x7f) {
            return false;
        }
    }
    memcpy(out, probe, n + 1);
    return true;
}

/* ---- Push-to-talk reply gate ---- */

/* GATE_TAIL: a reply whose response.done came. Its audio, queued or still
 * arriving, plays; it never takes over from, or is flushed for, the reply
 * after it. A press or new speech still makes it stale. */
enum { GATE_STALE, GATE_WAITING, GATE_PLAYING, GATE_CONTINUING, GATE_TAIL };

void muse_vc_reply_gate_init(muse_vc_reply_gate_t *g)
{
    memset(g, 0, sizeof(*g));
}

static muse_vc_gate_id_t *gate_find(muse_vc_reply_gate_t *g, const char *id)
{
    for (int i = 0; i < g->n_ids; i++) {
        if (!strcmp(g->ids[i].id, id)) {
            return &g->ids[i];
        }
    }
    return NULL;
}

static bool gate_any(const muse_vc_reply_gate_t *g, uint8_t state)
{
    for (int i = 0; i < g->n_ids; i++) {
        if (g->ids[i].state == state) {
            return true;
        }
    }
    return false;
}

bool muse_vc_reply_gate_waiting(const muse_vc_reply_gate_t *g)
{
    return gate_any(g, GATE_WAITING);
}

/* A reply that takes audio now. */
static bool gate_live(const muse_vc_reply_gate_t *g)
{
    return gate_any(g, GATE_PLAYING) || gate_any(g, GATE_CONTINUING);
}

bool muse_vc_reply_gate_playing(const muse_vc_reply_gate_t *g)
{
    return gate_live(g) || gate_any(g, GATE_TAIL);
}

uint8_t muse_vc_reply_gate_take_flush(muse_vc_reply_gate_t *g)
{
    uint8_t f = g->flush;
    g->flush = 0;
    return f;
}

const char *muse_vc_reply_gate_open_response(const muse_vc_reply_gate_t *g)
{
    return g->response[0] && g->response_open ? g->response : NULL;
}

bool muse_vc_reply_gate_captions(const muse_vc_reply_gate_t *g)
{
    return g->item[0] && g->confirmed && !g->blocked;
}

bool muse_vc_reply_gate_full(const muse_vc_reply_gate_t *g)
{
    return g->full;
}

/* Everything playing or waiting goes stale; no turn opens anything. */
static void gate_silence(muse_vc_reply_gate_t *g)
{
    for (int i = 0; i < g->n_ids; i++) {
        g->ids[i].state = GATE_STALE;
    }
    g->confirmed = g->blocked = g->want_response = g->turn_fresh = g->response_open = g->reply_played = false;
    g->turn[0] = g->response[0] = '\0';
}

void muse_vc_reply_gate_press(muse_vc_reply_gate_t *g)
{
    gate_silence(g);
    g->item[0] = '\0';
    g->n_hold = 0;
    g->hold_full = false;
    g->hold_last[0] = '\0';
}

/* Whether `item` started in the current hold (since the last press). */
static bool gate_in_hold(const muse_vc_reply_gate_t *g, const char *item)
{
    for (int i = 0; i < g->n_hold; i++) {
        if (!strcmp(g->hold[i], item)) {
            return true;
        }
    }
    return false;
}

static void gate_set(muse_vc_reply_gate_t *g, uint8_t from, uint8_t to)
{
    for (int i = 0; i < g->n_ids; i++) {
        if (g->ids[i].state == from) {
            g->ids[i].state = to;
        }
    }
}

void muse_vc_reply_gate_overflow(muse_vc_reply_gate_t *g)
{
    gate_set(g, GATE_WAITING, GATE_STALE);
}

/* Remembers a new id; false (and full) if there's no room. */
static bool gate_add(muse_vc_reply_gate_t *g, const char *id, uint8_t state)
{
    if (g->n_ids == MUSE_VC_GATE_IDS) {
        g->full = true;
        return false;
    }
    strcpy(g->ids[g->n_ids].id, id);
    g->ids[g->n_ids].state = state;
    g->n_ids++;
    return true;
}

muse_vc_gate_verdict_t muse_vc_reply_gate_audio(muse_vc_reply_gate_t *g, const muse_vc_event_t *ev)
{
    char id[MUSE_VC_TURN_ID_MAX];
    if (g->full || !ev->audio_cavd || !take_id(ev->response_id, id, sizeof(id))) {
        return MUSE_VC_GATE_DROP;
    }
    muse_vc_gate_id_t *known = gate_find(g, id);
    if (known) {
        if (known->state == GATE_PLAYING || known->state == GATE_CONTINUING) {
            g->reply_played = true;
            return MUSE_VC_GATE_PLAY;
        }
        return known->state == GATE_TAIL ? MUSE_VC_GATE_PLAY :
               known->state == GATE_WAITING ? MUSE_VC_GATE_HOLD : MUSE_VC_GATE_DROP;
    }
    if (!g->item[0] || g->blocked) {
        gate_add(g, id, GATE_STALE);
        return MUSE_VC_GATE_DROP;
    }
    if (g->confirmed) {
        /* The newest reply takes over: the one playing goes stale, flushed. */
        if (gate_live(g)) {
            gate_set(g, GATE_PLAYING, GATE_STALE);
            gate_set(g, GATE_CONTINUING, GATE_STALE);
            g->flush |= MUSE_VC_GATE_FLUSH_PLAYING;
        }
        /* A finished reply stops where its queue ends, never under this one. */
        gate_set(g, GATE_TAIL, GATE_STALE);
        uint8_t state = g->turn_fresh ? GATE_PLAYING : GATE_CONTINUING;
        g->turn_fresh = false;
        if (!gate_add(g, id, state)) {
            return MUSE_VC_GATE_DROP;
        }
        g->reply_played = true;
        return MUSE_VC_GATE_PLAY;
    }
    if (gate_any(g, GATE_WAITING)) {
        gate_set(g, GATE_WAITING, GATE_STALE);   /* the newer one waits instead */
        g->flush |= MUSE_VC_GATE_FLUSH_WAITING;
    }
    return gate_add(g, id, GATE_WAITING) ? MUSE_VC_GATE_HOLD : MUSE_VC_GATE_DROP;
}

void muse_vc_reply_gate_event(muse_vc_reply_gate_t *g, const muse_vc_event_t *ev)
{
    char item[MUSE_VC_TURN_ID_MAX];
    switch (ev->kind) {
    case MUSE_VC_EV_SPEECH_STARTED:
        /* The caller talks over whatever was playing or waiting: the server
         * cancels it, and its trailing audio keeps its id. Only this item's
         * turn may open the next reply. */
        gate_silence(g);
        if (!take_id(ev->item_id, g->item, sizeof(g->item))) {
            g->item[0] = '\0';
        } else {
            strcpy(g->hold_last, g->item);
            if (gate_in_hold(g, g->item)) {
                /* already listed */
            } else if (g->n_hold < MUSE_VC_GATE_HOLD_ITEMS) {
                strcpy(g->hold[g->n_hold++], g->item);
            } else {
                g->hold_full = true;
            }
        }
        break;
    case MUSE_VC_EV_TURN_STARTED: {
        char turn[MUSE_VC_TURN_ID_MAX];
        if (!g->item[0] || !take_id(ev->item_id, item, sizeof(item)) || !take_id(ev->submission_id, turn, sizeof(turn))) {
            break;   /* no current item, or no whole identity */
        }
        if (strcmp(item, g->item) != 0 && g->hold_last[0] && !strcmp(item, g->hold_last)) {
            /* The latest hold's item again (its own continuation, after older
             * work was adopted): it's current again, as below, and the
             * adopted reply stops. No flush: the playback queue isn't kept
             * per reply, and this item's own finished reply may be queued
             * ahead of it. */
            gate_set(g, GATE_PLAYING, GATE_STALE);
            gate_set(g, GATE_CONTINUING, GATE_STALE);
            strcpy(g->item, item);
        } else if (strcmp(item, g->item) != 0 && g->confirmed && !g->blocked && g->response[0] &&
                   !g->response_open && g->reply_played && !gate_any(g, GATE_WAITING) && !g->hold_full &&
                   !gate_in_hold(g, item)) {
            /* The current reply has finished, and older work reports back:
             * a delegated task's result, the outcome of a spoken approval.
             * It speaks next, as on the phone: interrupting a reply doesn't
             * cancel that work. The finished reply's audio plays out, never
             * taking over; a continuation that played without a turn of its
             * own was this work's. */
            bool early = gate_any(g, GATE_CONTINUING) || gate_any(g, GATE_PLAYING);
            gate_set(g, GATE_CONTINUING, GATE_PLAYING);
            strcpy(g->item, item);
            g->turn_fresh = !early;
            g->reply_played = early;
            strcpy(g->turn, turn);
            g->response[0] = '\0';
            g->want_response = true;
            break;
        }
        if (strcmp(item, g->item) != 0) {
            /* Older work speaks up: whatever waits, a continuation playing
             * without a turn of its own, and new ids from here on, may be
             * its reply. */
            if (gate_any(g, GATE_WAITING)) {
                gate_set(g, GATE_WAITING, GATE_STALE);
                g->flush |= MUSE_VC_GATE_FLUSH_WAITING;
            }
            if (gate_any(g, GATE_CONTINUING)) {
                gate_set(g, GATE_CONTINUING, GATE_STALE);
                g->flush |= MUSE_VC_GATE_FLUSH_PLAYING;
            }
            g->blocked = true;
            g->turn_fresh = false;
            break;
        }
        /* The current item's turn: what waits plays, a continuation playing
         * is confirmed (this is its alias), and if neither, the next new id
         * is this turn's own. */
        bool had = gate_any(g, GATE_WAITING) || gate_live(g);
        gate_set(g, GATE_WAITING, GATE_PLAYING);
        gate_set(g, GATE_CONTINUING, GATE_PLAYING);
        g->turn_fresh = !had;
        g->confirmed = true;
        g->blocked = false;
        g->reply_played = gate_live(g);
        strcpy(g->turn, turn);
        g->response[0] = '\0';
        g->want_response = true;
        break;
    }
    case MUSE_VC_EV_RESPONSE_CREATED:
        if (g->want_response && take_id(ev->mapper_response_id, g->response, sizeof(g->response))) {
            g->want_response = false;
            g->response_open = true;
        }
        break;
    case MUSE_VC_EV_RESPONSE_DONE:
        if (g->response_open && take_id(ev->mapper_response_id, item, sizeof(item)) && !strcmp(item, g->response)) {
            g->response_open = false;
            /* Its audio still plays as it arrives, but an id first seen
             * from here on is new work (a continuation, or older work's
             * reply ahead of its turn). */
            gate_set(g, GATE_PLAYING, GATE_TAIL);
            gate_set(g, GATE_CONTINUING, GATE_TAIL);
        }
        break;
    case MUSE_VC_EV_INPUT_SUPPRESSED:
        if (g->item[0] && take_id(ev->item_id, item, sizeof(item)) && !strcmp(item, g->item)) {
            /* Side speech: no turn, nothing for it plays. */
            gate_silence(g);
            g->item[0] = '\0';
        }
        break;
    default:
        break;
    }
}

bool muse_vc_reply_gate_done(const muse_vc_reply_gate_t *g, const muse_vc_event_t *ev)
{
    char id[MUSE_VC_TURN_ID_MAX];
    if (ev->kind == MUSE_VC_EV_TURN_SETTLED) {
        return g->turn[0] && take_id(ev->response_message_id, id, sizeof(id)) && !strcmp(id, g->turn);
    }
    if (ev->kind == MUSE_VC_EV_RESPONSE_DONE) {
        return g->response[0] && take_id(ev->mapper_response_id, id, sizeof(id)) && !strcmp(id, g->response);
    }
    return false;
}

/* 1: this exact turn was seen (a repeat); -1: its submission was seen with
 * another item (a conflict); 0: new. */
static int turn_seen(const muse_vc_turns_t *t, const char *submission, const char *item)
{
    const muse_vc_turn_t *lists[2] = { t->active, t->settled };
    int counts[2] = { t->n_active, t->n_settled };
    for (int l = 0; l < 2; l++) {
        for (int i = 0; i < counts[l]; i++) {
            if (!strcmp(lists[l][i].submission, submission)) {
                return strcmp(lists[l][i].item, item) ? -1 : 1;
            }
        }
    }
    return 0;
}

/* Validates and records a turn; its item goes to *item. False if it can't be
 * tracked (bad ids, a submission seen with another item, too many): the call
 * fails rather than guess. */
static bool turn_started(muse_vc_turns_t *t, const muse_vc_event_t *ev, char item[MUSE_VC_TURN_ID_MAX])
{
    char submission[MUSE_VC_TURN_ID_MAX];
    if (!take_id(ev->submission_id, submission, sizeof(submission)) || !take_id(ev->item_id, item, MUSE_VC_TURN_ID_MAX)) {
        return false;
    }
    int seen = turn_seen(t, submission, item);
    if (seen) {
        return seen > 0;
    }
    if (t->n_active == MUSE_VC_MAX_TURNS) {
        return false;
    }
    memcpy(t->active[t->n_active].submission, submission, sizeof(submission));
    memcpy(t->active[t->n_active].item, item, MUSE_VC_TURN_ID_MAX);
    t->n_active++;
    return true;
}

/* The item of the active turn `submission`, or false if it isn't active. */
static bool active_turn_item(const muse_vc_turns_t *t, const char *submission, char item[MUSE_VC_TURN_ID_MAX])
{
    for (int i = 0; i < t->n_active; i++) {
        if (!strcmp(t->active[i].submission, submission)) {
            memcpy(item, t->active[i].item, MUSE_VC_TURN_ID_MAX);
            return true;
        }
    }
    return false;
}

/* True if a turn before the newest active one already named `item`: a
 * delayed reply's alias for older work (or a replay), not a new caller turn. */
static bool item_seen_before(const muse_vc_turns_t *t, const char *item)
{
    for (int i = 0; i + 1 < t->n_active; i++) {
        if (!strcmp(t->active[i].item, item)) {
            return true;
        }
    }
    for (int i = 0; i < t->n_settled; i++) {
        if (!strcmp(t->settled[i].item, item)) {
            return true;
        }
    }
    return false;
}

/* True if this settlement names a submission already settled and not active
 * again: a repeat, which changes nothing. */
static bool settled_before(const muse_vc_turns_t *t, const muse_vc_event_t *ev)
{
    char submission[MUSE_VC_TURN_ID_MAX];
    if (!take_id(ev->response_message_id, submission, sizeof(submission))) {
        return false;
    }
    for (int i = 0; i < t->n_active; i++) {
        if (!strcmp(t->active[i].submission, submission)) {
            return false;
        }
    }
    for (int i = 0; i < t->n_settled; i++) {
        if (!strcmp(t->settled[i].submission, submission)) {
            return true;
        }
    }
    return false;
}

/* Retires every active turn except those for item `keep` (NULL keeps none). */
static void settle_all(muse_vc_turns_t *t, const char *keep)
{
    int kept = 0;
    for (int i = 0; i < t->n_active; i++) {
        if (keep && keep[0] && !strcmp(t->active[i].item, keep)) {
            t->active[kept++] = t->active[i];
            continue;
        }
        t->settled[t->settled_next] = t->active[i];
        t->settled_next = (uint8_t)((t->settled_next + 1) % MUSE_VC_MAX_TURNS);
        if (t->n_settled < MUSE_VC_MAX_TURNS) {
            t->n_settled++;
        }
    }
    t->n_active = (uint8_t)kept;
}

/* Retires the named submission and the earlier ones for its item. An unnamed
 * or unknown settlement retires nothing. Returns true if anything settled. */
static bool turn_settled(muse_vc_turns_t *t, const muse_vc_event_t *ev)
{
    char submission[MUSE_VC_TURN_ID_MAX];
    if (!take_id(ev->response_message_id, submission, sizeof(submission))) {
        return false;
    }
    int at = -1;
    for (int i = 0; i < t->n_active; i++) {
        if (!strcmp(t->active[i].submission, submission)) {
            at = i;
            break;
        }
    }
    if (at < 0) {
        return false;
    }
    char item[MUSE_VC_TURN_ID_MAX];
    memcpy(item, t->active[at].item, sizeof(item));
    int keep = 0;
    for (int i = 0; i < t->n_active; i++) {
        if (i <= at && !strcmp(t->active[i].item, item)) {
            t->settled[t->settled_next] = t->active[i];
            t->settled_next = (uint8_t)((t->settled_next + 1) % MUSE_VC_MAX_TURNS);
            if (t->n_settled < MUSE_VC_MAX_TURNS) {
                t->n_settled++;
            }
            continue;
        }
        if (keep != i) {
            t->active[keep] = t->active[i];
        }
        keep++;
    }
    t->n_active = (uint8_t)keep;
    return true;
}

/* Does this event's item end the speech in progress? Only its own item does;
 * an event without one ends speech that started unnamed. */
static bool ends_speech(const muse_vc_call_t *c, const muse_vc_event_t *ev)
{
    char item[MUSE_VC_TURN_ID_MAX];
    if (!take_id(ev->item_id, item, sizeof(item))) {
        return !c->speaking_item[0];
    }
    return !c->speaking_item[0] || !strcmp(item, c->speaking_item);
}

uint32_t muse_vc_call_event(muse_vc_call_t *c, const muse_vc_event_t *ev, int64_t now_us)
{
    bool live = c->state == MUSE_VC_LIVE;
    if (c->state != MUSE_VC_CONNECTING && !live) {
        return 0;
    }
    switch (ev->kind) {
    case MUSE_VC_EV_SESSION: {
        if (live) {
            return 0;
        }
        /* The readiness fence: this call's exact id and a session id, or the
         * call fails. A thread id is optional (the primary thread), but one
         * that's there has to be whole. */
        char id[MUSE_VC_CALL_ID_MAX];
        if (!take_id(ev->call_id, id, sizeof(id)) || strcmp(id, c->call_id) != 0 ||
            !take_id(ev->session_id, c->session_id, sizeof(c->session_id)) ||
            (ev->thread_id.p && !take_id(ev->thread_id, c->thread_id, sizeof(c->thread_id)))) {
            c->session_id[0] = c->thread_id[0] = '\0';
            return muse_vc_call_hang_up(c, MUSE_VC_END_FAILED, now_us);
        }
        c->state = MUSE_VC_LIVE;
        c->live_us = c->activity_us = now_us;
        return MUSE_VC_ACT_READY;
    }
    case MUSE_VC_EV_SPEECH_STARTED:
        c->speaking = true;
        if (!take_id(ev->item_id, c->speaking_item, sizeof(c->speaking_item))) {
            c->speaking_item[0] = '\0';
        }
        muse_vc_call_activity(c, now_us);
        return live ? MUSE_VC_ACT_FLUSH : 0;
    case MUSE_VC_EV_SPEECH_STOPPED:
    case MUSE_VC_EV_INPUT_SUPPRESSED:
        if (c->speaking && ends_speech(c, ev)) {
            c->speaking = false;
            c->speaking_item[0] = '\0';
        }
        muse_vc_call_activity(c, now_us);
        return 0;
    case MUSE_VC_EV_TURN_STARTED: {
        /* Validated first; then only a turn for the speaking item itself ends
         * its speech (a delayed reply's turn names an older item). */
        char item[MUSE_VC_TURN_ID_MAX];
        uint8_t was_active = c->turns->n_active;
        if (!turn_started(c->turns, ev, item)) {
            return muse_vc_call_hang_up(c, MUSE_VC_END_FAILED, now_us);
        }
        if (c->turns->n_active != was_active) {
            c->awaiting_caller = false;   /* a new turn, not a repeat */
        }
        if (c->speaking && c->speaking_item[0] && !strcmp(item, c->speaking_item)) {
            c->speaking = false;
            c->speaking_item[0] = '\0';
        }
        if (strcmp(item, c->reply_item) != 0 && !item_seen_before(c->turns, item)) {
            /* A new caller turn. A delayed reply's turn names an earlier
             * item; early media the reply adopts was created unmarked. */
            c->awaiting_reply = true;
            c->reply_kept = false;
            memcpy(c->reply_item, item, sizeof(c->reply_item));
            if (c->open_response[0] && c->open_unmarked) {
                memcpy(c->reply_response, c->open_response, sizeof(c->reply_response));
            } else {
                c->reply_response[0] = '\0';
            }
        }
        muse_vc_call_activity(c, now_us);
        return 0;
    }
    case MUSE_VC_EV_TURN_SETTLED:
        if (settled_before(c->turns, ev)) {
            return 0;   /* a repeat: it can't retire newer turns or use up a kept one */
        }
        if (turn_settled(c->turns, ev)) {
            muse_vc_call_activity(c, now_us);   /* a fresh idle window after it */
        }
        if (ev->handoffs_open) {
            /* A boundary (a spoken approval prompt) with delegated work still
             * open: Muse waits on the caller until a new turn starts. Its
             * settlement may name none of the caller's turns, so they stay
             * open (and the idle limit with them) but don't show WORKING. */
            c->awaiting_caller = true;
        } else if (ev->handoffs_none) {
            c->awaiting_caller = false;
        }
        if (ev->handoffs_none && c->turns->n_active) {
            /* Nothing pending: no handoff in the call remains, and Muse
             * doesn't settle every caller turn by name, so a turn asked while
             * a handoff ran would otherwise stay active (working, never idle)
             * for the rest of the call. A turn not answered yet stays: an
             * interrupted reply's settlement can follow the next turn's start.
             * It stays through one such settlement only, so a reply never
             * seen can't hold the call open past its idle limit. */
            bool keep = c->awaiting_reply && !c->reply_kept;
            settle_all(c->turns, keep ? c->reply_item : NULL);
            if (keep) {
                c->reply_kept = true;
            } else {
                c->awaiting_reply = false;
            }
            muse_vc_call_activity(c, now_us);
        }
        return 0;
    case MUSE_VC_EV_RESPONSE_CREATED: {
        char response[MUSE_VC_TURN_ID_MAX], submission[MUSE_VC_TURN_ID_MAX], item[MUSE_VC_TURN_ID_MAX];
        if (!take_id(ev->mapper_response_id, response, sizeof(response))) {
            response[0] = '\0';
        }
        bool marked = take_id(ev->response_submission_id, submission, sizeof(submission));
        memcpy(c->open_response, response, sizeof(c->open_response));
        c->open_unmarked = !marked;
        /* The awaited turn's reply: one for its item, or one that doesn't say
         * (older VMs, early media), never older work's. */
        if (c->awaiting_reply && response[0] &&
            (!marked || (active_turn_item(c->turns, submission, item) && !strcmp(item, c->reply_item)))) {
            memcpy(c->reply_response, response, sizeof(c->reply_response));
        }
        muse_vc_call_activity(c, now_us);
        return 0;
    }
    case MUSE_VC_EV_RESPONSE_DONE: {   /* "cancelled" included: the call goes on */
        /* Only the awaited turn's reply answers it; an older one the caller
         * interrupted finishing late doesn't. */
        char response[MUSE_VC_TURN_ID_MAX];
        if (take_id(ev->mapper_response_id, response, sizeof(response))) {
            if (!strcmp(response, c->open_response)) {
                c->open_response[0] = '\0';
            }
            if (c->awaiting_reply && c->reply_response[0] && !strcmp(response, c->reply_response)) {
                c->awaiting_reply = false;
            }
        }
        muse_vc_call_activity(c, now_us);
        return 0;
    }
    case MUSE_VC_EV_REPLY_TEXT:
    case MUSE_VC_EV_REPLY_DONE:
    case MUSE_VC_EV_USER_TEXT:
        muse_vc_call_activity(c, now_us);
        return 0;
    case MUSE_VC_EV_HOLD:
        if (ev->held == c->held) {
            return 0;
        }
        c->held = ev->held;
        if (c->held) {
            c->speaking = false;   /* its stop may never come */
            c->speaking_item[0] = '\0';
        }
        muse_vc_call_activity(c, now_us);
        return MUSE_VC_ACT_HOLD;
    case MUSE_VC_EV_STOP:
        return muse_vc_call_hang_up(c, MUSE_VC_END_STOP, now_us);
    case MUSE_VC_EV_ERROR:
        /* Before the call is live, an error means it didn't come up. Once live,
         * only a dead session ends it; others (a full queue, a failed turn,
         * an unsupported request) are about one operation. */
        if (!live || span_is(ev->code, "session_dead")) {
            return muse_vc_call_hang_up(c, MUSE_VC_END_FAILED, now_us);
        }
        c->advisory_errors++;
        return 0;
    default:
        return 0;
    }
}

uint32_t muse_vc_call_media_end(muse_vc_call_t *c, bool ok, int http_status, int64_t now_us)
{
    if (!c->media_open) {
        return 0;
    }
    c->media_open = false;
    if (http_status) {
        c->http_status = http_status;
    }
    switch (c->state) {
    case MUSE_VC_OPENING:
        return muse_vc_call_hang_up(c, http_status >= 400 ? MUSE_VC_END_REJECTED : MUSE_VC_END_FAILED, now_us);
    case MUSE_VC_CONNECTING:
        return muse_vc_call_hang_up(c, http_status >= 400 ? MUSE_VC_END_REJECTED : MUSE_VC_END_FAILED, now_us);
    case MUSE_VC_LIVE:
        return muse_vc_call_hang_up(c, ok ? MUSE_VC_END_REMOTE : MUSE_VC_END_FAILED, now_us);
    case MUSE_VC_ENDING:
        return progress(c, now_us);
    default:
        return 0;
    }
}

void muse_vc_call_end_call_sent(muse_vc_call_t *c, int64_t now_us)
{
    if (c->end_call_pending) {
        c->end_call_pending = false;
        c->end_call_open = true;
        c->end_call_at_us = now_us;
    }
}

uint32_t muse_vc_call_end_call_done(muse_vc_call_t *c, int64_t now_us)
{
    if (!c->end_call_open) {
        return 0;
    }
    c->end_call_open = false;
    return progress(c, now_us);
}

uint32_t muse_vc_call_lost(muse_vc_call_t *c, int64_t now_us)
{
    if (c->state == MUSE_VC_IDLE) {
        return 0;
    }
    if (c->state != MUSE_VC_ENDING) {
        c->reason = MUSE_VC_END_LOST;
        c->end_us = now_us;
    }
    c->state = MUSE_VC_IDLE;
    c->media_open = c->end_call_pending = c->end_call_open = false;
    return MUSE_VC_ACT_ENDED;
}

bool muse_vc_call_working(const muse_vc_call_t *c)
{
    return c->state == MUSE_VC_LIVE && c->turns->n_active && !c->awaiting_caller;
}

uint32_t muse_vc_call_poll(muse_vc_call_t *c, int64_t now_us)
{
    switch (c->state) {
    case MUSE_VC_OPENING:
        return now_us - c->start_us > c->limits.open_us ? muse_vc_call_hang_up(c, MUSE_VC_END_NO_ANSWER, now_us) : 0;
    case MUSE_VC_CONNECTING:
        return now_us - c->head_us > c->limits.ready_us ? muse_vc_call_hang_up(c, MUSE_VC_END_NO_ANSWER, now_us) : 0;
    case MUSE_VC_LIVE:
        if (c->held || c->speaking) {
            c->activity_us = now_us;   /* input held, or the caller mid-sentence: not idle */
        }
        if (now_us - c->live_us > c->limits.max_us) {
            return muse_vc_call_hang_up(c, MUSE_VC_END_MAX, now_us);
        }
        if (c->turns->n_active) {
            c->activity_us = now_us;   /* Muse is still working on a turn */
        }
        if (now_us - c->activity_us > c->limits.idle_us) {
            return muse_vc_call_hang_up(c, MUSE_VC_END_IDLE, now_us);
        }
        return 0;
    case MUSE_VC_ENDING: {
        uint32_t acts = 0;
        if (c->end_call_open && now_us - c->end_call_at_us > c->limits.end_call_us) {
            c->end_call_open = false;
            acts |= MUSE_VC_ACT_RESET_END_CALL;
        }
        if (c->media_open && c->half_closed && now_us - c->half_closed_at_us > c->limits.drain_us) {
            c->media_open = false;
            acts |= MUSE_VC_ACT_RESET_MEDIA;
        }
        return acts | progress(c, now_us);
    }
    default:
        return 0;
    }
}

bool muse_vc_admission(const char *call_id, const char *device_id, bool greeting, char *out, size_t cap)
{
    char id[MUSE_VC_CALL_ID_MAX * 6];
    char dev[MUSE_VC_ID_MAX * 6];
    if (!muse_vc_json_escape(call_id, id, sizeof(id)) || !muse_vc_json_escape(device_id ? device_id : "", dev, sizeof(dev))) {
        return false;
    }
    int n = snprintf(out, cap,
                     "{\"type\":\"hatch.voice.call.start\",\"call_id\":\"%s\",\"call_media_type\":\"audio\","
                     "\"device\":\"mcu-wearable\"%s%s%s,\"proactive_greeting_enabled\":%s}\n",
                     id, dev[0] ? ",\"device_id\":\"" : "", dev, dev[0] ? "\"" : "", greeting ? "true" : "false");
    return n > 0 && (size_t)n < cap;
}

bool muse_vc_end_call_body(const muse_vc_call_t *c, int64_t ended_wall_ms, int64_t now_us, char *out, size_t cap)
{
    int64_t elapsed_ms = now_us > c->start_us ? (now_us - c->start_us) / 1000 : 0;
    int64_t started = ended_wall_ms - elapsed_ms;
    if (started < 0) {
        started = 0;
    }
    int64_t ended = ended_wall_ms > started ? ended_wall_ms : started + 1;
    char s[25], e[25];
    muse_vc_rfc3339(started, s);
    muse_vc_rfc3339(ended, e);
    char id[MUSE_VC_CALL_ID_MAX * 6], thread[MUSE_VC_ID_MAX * 6];
    if (!muse_vc_json_escape(c->call_id, id, sizeof(id)) || !muse_vc_json_escape(c->thread_id, thread, sizeof(thread))) {
        return false;
    }
    int n = snprintf(out, cap, "{\"call_id\":\"%s\",\"call_started_at\":\"%s\",\"call_ended_at\":\"%s\"%s%s%s}", id, s, e,
                     thread[0] ? ",\"thread_id\":\"" : "", thread, thread[0] ? "\"" : "");
    return n > 0 && (size_t)n < cap;
}

const char *muse_vc_end_caption(muse_vc_end_t why)
{
    switch (why) {
    case MUSE_VC_END_LOCAL: return "CALL ENDED";
    case MUSE_VC_END_STOP: return "MUSE ENDED THE CALL";
    case MUSE_VC_END_REMOTE: return "MUSE ENDED THE CALL";
    case MUSE_VC_END_REJECTED: return "MUSE DIDN'T TAKE THE CALL";
    case MUSE_VC_END_FAILED: return "CALL FAILED";
    case MUSE_VC_END_NO_ANSWER: return "MUSE DIDN'T ANSWER";
    case MUSE_VC_END_IDLE: return "CALL ENDED: ALL QUIET";
    case MUSE_VC_END_MAX: return "CALL TIME LIMIT";
    case MUSE_VC_END_LOST: return "LOST CONNECTION TO MUSE";
    default: return "";
    }
}

/* ---- Time and ids ---- */

/* Days since 1970-01-01 of a proleptic Gregorian date (H. Hinnant). */
static int64_t days_from_civil(int64_t y, unsigned m, unsigned d)
{
    y -= m <= 2;
    int64_t era = (y >= 0 ? y : y - 399) / 400;
    unsigned yoe = (unsigned)(y - era * 400);
    unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + (int64_t)doe - 719468;
}

void muse_vc_rfc3339(int64_t unix_ms, char out[25])
{
    if (unix_ms < 0) {
        unix_ms = 0;
    }
    int64_t secs = unix_ms / 1000;
    int ms = (int)(unix_ms % 1000);
    int64_t z = secs / 86400 + 719468;
    int64_t sod = secs % 86400;
    int64_t era = z / 146097;
    unsigned doe = (unsigned)(z - era * 146097);
    unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    int64_t y = (int64_t)yoe + era * 400;
    unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    unsigned mp = (5 * doy + 2) / 153;
    unsigned d = doy - (153 * mp + 2) / 5 + 1;
    unsigned m = mp < 10 ? mp + 3 : mp - 9;
    y += m <= 2;
    snprintf(out, 25, "%04u-%02u-%02uT%02u:%02u:%02u.%03uZ", (unsigned)((uint64_t)y % 10000), m % 100, d % 100,
             (unsigned)(sod / 3600), (unsigned)(sod / 60 % 60), (unsigned)(sod % 60), (unsigned)ms);
}

static int digits(const char *p, int n)
{
    int v = 0;
    for (int i = 0; i < n; i++) {
        if (p[i] < '0' || p[i] > '9') {
            return -1;
        }
        v = v * 10 + (p[i] - '0');
    }
    return v;
}

int64_t muse_vc_http_date(const char *s, size_t len)
{
    /* "Sun, 06 Nov 1994 08:49:37 GMT" */
    static const char months[] = "JanFebMarAprMayJunJulAugSepOctNovDec";
    if (len != 29 || s[3] != ',' || s[4] != ' ' || s[7] != ' ' || s[11] != ' ' || s[16] != ' ' || s[19] != ':' ||
        s[22] != ':' || memcmp(s + 25, " GMT", 4) != 0) {
        return -1;
    }
    int day = digits(s + 5, 2), year = digits(s + 12, 4);
    int hh = digits(s + 17, 2), mm = digits(s + 20, 2), ss = digits(s + 23, 2);
    int mon = -1;
    for (int i = 0; i < 12; i++) {
        if (!memcmp(s + 8, months + 3 * i, 3)) {
            mon = i + 1;
        }
    }
    if (day < 1 || day > 31 || year < 1970 || mon < 0 || hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 60) {
        return -1;
    }
    int64_t days = days_from_civil(year, (unsigned)mon, (unsigned)day);
    return ((days * 86400) + hh * 3600 + mm * 60 + ss) * 1000;
}

void muse_vc_uuid(const uint8_t random[16], char out[37])
{
    uint8_t b[16];
    memcpy(b, random, 16);
    b[6] = (uint8_t)((b[6] & 0x0F) | 0x40);
    b[8] = (uint8_t)((b[8] & 0x3F) | 0x80);
    static const char hex[] = "0123456789abcdef";
    size_t o = 0;
    for (int i = 0; i < 16; i++) {
        if (i == 4 || i == 6 || i == 8 || i == 10) {
            out[o++] = '-';
        }
        out[o++] = hex[b[i] >> 4];
        out[o++] = hex[b[i] & 15];
    }
    out[o] = '\0';
}
