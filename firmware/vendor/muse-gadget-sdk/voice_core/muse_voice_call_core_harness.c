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

/* Drives muse_voice_call_core.c for test_muse_voice_call.py: modes that read
 * stdin and write results for Python to check, and `unit` for the lifecycle. */

#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "muse_voice_call_core.h"

#define LINE_CAP (1 << 20)

static char *read_line(FILE *f, size_t *len)
{
    static char *buf;
    if (!buf) {
        buf = malloc(LINE_CAP);
    }
    if (!fgets(buf, LINE_CAP, f)) {
        return NULL;
    }
    *len = strlen(buf);
    while (*len && (buf[*len - 1] == '\n' || buf[*len - 1] == '\r')) {
        buf[--*len] = '\0';
    }
    return buf;
}

static const char *kind_name(muse_vc_jkind_t k)
{
    static const char *n[] = { "none", "string", "number", "true", "false", "null", "object", "array" };
    return n[k];
}

/* valid: one 0/1 per line. */
static int mode_valid(void)
{
    size_t len;
    char *line;
    while ((line = read_line(stdin, &len))) {
        printf("%d\n", muse_vc_json_valid(line, len));
    }
    return 0;
}

/* get PATH: kind, then the unescaped string as hex (or the raw span). */
static int mode_get(const char *path)
{
    size_t len;
    char *line;
    static char out[LINE_CAP];
    while ((line = read_line(stdin, &len))) {
        muse_vc_span_t s = { 0 };
        muse_vc_jkind_t k = muse_vc_json_get(line, len, path, &s);
        printf("%s ", kind_name(k));
        if (k == MUSE_VC_J_STRING) {
            if (!muse_vc_json_unescape(s, out, sizeof(out))) {
                printf("!bad");
            } else {
                for (const char *p = out; *p; p++) {
                    printf("%02x", (unsigned char)*p);
                }
            }
        } else if (k != MUSE_VC_J_NONE) {
            fwrite(s.p, 1, s.n, stdout);
        }
        printf("\n");
    }
    return 0;
}

/* unescape CAP: each line is a raw JSON string body; prints hex of the result. */
static int mode_unescape(int cap)
{
    size_t len;
    char *line;
    char *out = malloc((size_t)cap);
    while ((line = read_line(stdin, &len))) {
        muse_vc_span_t s = { line, len };
        if (!muse_vc_json_unescape(s, out, (size_t)cap)) {
            printf("!bad\n");
            continue;
        }
        for (const char *p = out; *p; p++) {
            printf("%02x", (unsigned char)*p);
        }
        printf("\n");
    }
    free(out);
    return 0;
}

/* b64: decoded hex, or -1. */
static int mode_b64(void)
{
    size_t len;
    char *line;
    static uint8_t out[LINE_CAP];
    while ((line = read_line(stdin, &len))) {
        muse_vc_span_t s = { line, len };
        long n = muse_vc_b64_decode(s, out, sizeof(out));
        if (n < 0) {
            printf("-1\n");
            continue;
        }
        for (long i = 0; i < n; i++) {
            printf("%02x", out[i]);
        }
        printf("\n");
    }
    return 0;
}

/* resample IN OUT PIECE: PCM16 on stdin resampled in calls of up to PIECE
 * samples (0: the whole input in one call), each into a buffer of exactly
 * muse_vc_resample_bound() samples so ASan catches any write past it. */
static int mode_resample(int in_rate, int out_rate, size_t piece)
{
    size_t cap = 1 << 22, n = 0, got;
    int16_t *all = malloc(cap * sizeof(int16_t));
    while ((got = fread(all + n, sizeof(int16_t), cap - n, stdin)) > 0) {
        n += got;
        assert(n < cap);
    }
    muse_vc_resampler_t r;
    muse_vc_resampler_init(&r, in_rate, out_rate);
    for (size_t off = 0; off < n;) {
        size_t k = piece && n - off > piece ? piece : n - off;
        size_t bound = muse_vc_resample_bound(in_rate, out_rate, k);
        int16_t *out = malloc(bound * sizeof(int16_t));
        size_t o = muse_vc_resample(&r, all + off, k, out);
        assert(o <= bound);
        assert(r.pos < r.step);
        fwrite(out, sizeof(int16_t), o, stdout);
        free(out);
        off += k;
    }
    free(all);
    return 0;
}

/* uplink PIECE: 16 kHz PCM16LE on stdin, in pieces of PIECE samples, to append lines. */
static int mode_uplink(int piece)
{
    muse_vc_uplink_t *u = malloc(sizeof(*u));
    muse_vc_uplink_init(u);
    int16_t *in = malloc((size_t)piece * sizeof(int16_t));
    char line[MUSE_VC_APPEND_MAX];
    size_t got;
    while ((got = fread(in, sizeof(int16_t), (size_t)piece, stdin)) > 0) {
        size_t off = 0;
        while (off < got) {
            size_t n;
            off += muse_vc_uplink_push(u, in + off, got - off, line, &n);
            if (n) {
                assert(n <= MUSE_VC_APPEND_MAX && line[n - 1] == '\n');
                fwrite(line, 1, n, stdout);
            }
        }
    }
    free(in);
    free(u);
    return 0;
}

struct down_ctx {
    muse_vc_resampler_t rs;
    uint8_t *scratch;
    int16_t *pcm;
    FILE *pcm_out;
    unsigned audible, silent, bad;
};

static void on_down_line(void *ctx, const char *line, size_t len)
{
    struct down_ctx *d = ctx;
    muse_vc_event_t ev;
    if (!muse_vc_parse_event(line, len, &ev)) {
        printf("invalid\n");
        return;
    }
    static const char *names[] = { "other", "session", "audio", "speech_started", "speech_stopped",
                                   "response_created", "response_done", "turn_started", "turn_settled",
                                   "hold", "reply_text", "reply_done", "user_text", "stop", "error",
                                   "input_suppressed" };
    printf("%s", names[ev.kind]);
    if (ev.kind == MUSE_VC_EV_AUDIO) {
        bool audible;
        long n = ev.audio_rate_ok ? muse_vc_decode_audio(&d->rs, ev.audio, d->scratch, MUSE_VC_LINE_MAX / 4 * 3,
                                                         d->pcm, &audible)
                                  : -2;
        printf(" %ld %s", n, n >= 0 ? (audible ? "audible" : "silent") : "bad");
        if (n > 0) {
            fwrite(d->pcm, sizeof(int16_t), (size_t)n, d->pcm_out);
        }
    } else if (ev.kind == MUSE_VC_EV_HOLD) {
        printf(" %d", ev.held);
    } else if (ev.text.p || ev.status.p || ev.code.p || ev.session_id.p) {
        char out[512];
        muse_vc_span_t s = ev.text.p ? ev.text : ev.status.p ? ev.status : ev.code.p ? ev.code : ev.session_id;
        printf(" %s", muse_vc_json_unescape(s, out, sizeof(out)) ? out : "!bad");
    }
    printf("\n");
}

/* down SEED PCM_PATH: NDJSON on stdin fed in pseudo-random chunks; events to
 * stdout, 16 kHz audio to PCM_PATH. */
static int mode_down(unsigned seed, const char *pcm_path)
{
    struct down_ctx d = { 0 };
    muse_vc_resampler_init(&d.rs, MUSE_VC_WIRE_RATE, MUSE_VC_MIC_RATE);
    d.scratch = malloc(MUSE_VC_LINE_MAX / 4 * 3);
    d.pcm = malloc((MUSE_VC_LINE_MAX / 4 * 3 / 3 + 2) * sizeof(int16_t));
    d.pcm_out = fopen(pcm_path, "wb");
    char *line_buf = malloc(MUSE_VC_LINE_MAX);
    muse_vc_lines_t lines;
    muse_vc_lines_init(&lines, line_buf, MUSE_VC_LINE_MAX);
    static uint8_t chunk[8192];
    size_t got;
    srand(seed);
    while ((got = fread(chunk, 1, 1 + (size_t)(rand() % (int)sizeof(chunk)), stdin)) > 0) {
        size_t off = 0;
        while (off < got) {
            size_t n = 1 + (size_t)(rand() % 700);
            n = n < got - off ? n : got - off;
            muse_vc_lines_feed(&lines, chunk + off, n, on_down_line, &d, NULL);
            off += n;
        }
    }
    printf("skipped %u\n", lines.skipped);
    fclose(d.pcm_out);
    free(d.scratch);
    free(d.pcm);
    free(line_buf);
    return 0;
}

/* time: "ms N" -> RFC 3339; "date STRING" -> ms or -1. */
static int mode_time(void)
{
    size_t len;
    char *line;
    while ((line = read_line(stdin, &len))) {
        if (!strncmp(line, "ms ", 3)) {
            char out[25];
            muse_vc_rfc3339(strtoll(line + 3, NULL, 10), out);
            printf("%s\n", out);
        } else if (!strncmp(line, "date ", 5)) {
            printf("%lld\n", (long long)muse_vc_http_date(line + 5, len - 5));
        }
    }
    return 0;
}

static muse_vc_turns_t s_turns;

/* admission CALL_ID DEVICE_ID GREETING, endcall CALL_ID THREAD WALL_MS ELAPSED_MS */
static int mode_admission(const char *id, const char *dev, int greeting)
{
    char out[MUSE_VC_ADMISSION_MAX];
    if (!muse_vc_admission(id, dev, greeting, out, sizeof(out))) {
        printf("!toolong\n");
        return 0;
    }
    fputs(out, stdout);
    return 0;
}

static int mode_endcall(const char *id, const char *thread, long long wall_ms, long long elapsed_ms)
{
    static const muse_vc_limits_t limits = { 1, 1, 1, 1, 1, 1 };
    muse_vc_call_t c;
    muse_vc_call_init(&c, &limits, &s_turns);
    muse_vc_call_begin(&c, id, 1000000);
    snprintf(c.thread_id, sizeof(c.thread_id), "%s", thread);
    char out[MUSE_VC_END_CALL_MAX];
    if (!muse_vc_end_call_body(&c, wall_ms, 1000000 + elapsed_ms * 1000, out, sizeof(out))) {
        printf("!toolong\n");
        return 0;
    }
    printf("%s\n", out);
    return 0;
}

/* ---- unit: the lifecycle, the gate, and the line bounds ---- */

static const muse_vc_limits_t LIMITS = {
    .open_us = 30000000, .ready_us = 40000000, .idle_us = 45000000,
    .max_us = 900000000, .end_call_us = 10000000, .drain_us = 5000000,
};

static muse_vc_event_t parse(const char *json)
{
    muse_vc_event_t ev;
    assert(muse_vc_parse_event(json, strlen(json), &ev));
    return ev;
}

static uint32_t feed(muse_vc_call_t *c, const char *json, int64_t now)
{
    muse_vc_event_t ev = parse(json);
    return muse_vc_call_event(c, &ev, now);
}

static void go_live(muse_vc_call_t *c, int64_t *now)
{
    muse_vc_call_init(c, &LIMITS, &s_turns);
    muse_vc_call_begin(c, "11111111-2222-4333-8444-555555555555", *now);
    assert(c->state == MUSE_VC_OPENING && c->media_open && c->end_call_needed);
    assert(muse_vc_call_head(c, 200, *now += 1000) == 0 && c->state == MUSE_VC_CONNECTING);
    assert(feed(c, "{\"type\":\"session.created\",\"event_id\":\"e\"}", *now) == 0);
    assert(feed(c, "{\"type\":\"hatch.voice.session\",\"call_id\":\"11111111-2222-4333-8444-555555555555\","
                   "\"session_id\":\"00000000-0000-4000-8000-000000000001\",\"thread_id\":\"thread-1\","
                   "\"request_id\":\"r\"}", *now) == MUSE_VC_ACT_READY);
    assert(c->state == MUSE_VC_LIVE && !strcmp(c->thread_id, "thread-1"));
}

/* Runs an ending call's I/O as a well-behaved server would; returns what happened, in order. */
static void finish(muse_vc_call_t *c, uint32_t acts, int64_t *now, char *log, size_t cap)
{
    log[0] = '\0';
    for (int guard = 0; guard < 20 && c->state != MUSE_VC_IDLE; guard++) {
        if (acts & MUSE_VC_ACT_RESET_MEDIA) strncat(log, "reset ", cap - strlen(log) - 1);
        if (acts & MUSE_VC_ACT_END_CALL) {
            strncat(log, "endcall ", cap - strlen(log) - 1);
            muse_vc_call_end_call_sent(c, *now);
            acts = muse_vc_call_end_call_done(c, *now += 1000);
            continue;
        }
        if (acts & MUSE_VC_ACT_HALF_CLOSE) {
            strncat(log, "halfclose ", cap - strlen(log) - 1);
            acts = muse_vc_call_media_end(c, true, 0, *now += 1000);
            continue;
        }
        if (acts & MUSE_VC_ACT_ENDED) {
            strncat(log, "ended", cap - strlen(log) - 1);
            break;
        }
        acts = muse_vc_call_poll(c, *now += 1000);
    }
    if (acts & MUSE_VC_ACT_ENDED && !strstr(log, "ended")) strncat(log, "ended", cap - strlen(log) - 1);
}

static void unit_lifecycle(void)
{
    muse_vc_call_t c;
    int64_t now = 1000000, t;
    char log[128];

    /* A local hang-up: end-call first, then the half-close, then the media drains. */
    go_live(&c, &now);
    finish(&c, muse_vc_call_hang_up(&c, MUSE_VC_END_LOCAL, now), &now, log, sizeof(log));
    assert(!strcmp(log, "endcall halfclose ended") && c.reason == MUSE_VC_END_LOCAL);

    /* A cancelled response is a turn's status, not the call's. */
    go_live(&c, &now);
    assert(feed(&c, "{\"type\":\"response.done\",\"event_id\":\"e\",\"response\":{\"id\":\"r\",\"status\":\"cancelled\"}}",
                now) == 0);
    assert(c.state == MUSE_VC_LIVE);
    /* speech_started flushes playback; the call goes on. */
    assert(feed(&c, "{\"type\":\"input_audio_buffer.speech_started\",\"event_id\":\"e\",\"item_id\":\"i\"}", now) ==
           MUSE_VC_ACT_FLUSH);
    /* A stop from Muse ends it gracefully, with the end-call, once. */
    const char *stop = "{\"type\":\"conversation.item.added\",\"event_id\":\"evt_0\",\"item\":{\"id\":\"item_0\","
                       "\"type\":\"session_control\",\"role\":\"assistant\",\"status\":\"completed\","
                       "\"call_id\":\"some-control-id\",\"name\":\"stop\",\"arguments\":\"{}\"}}";
    uint32_t acts = feed(&c, stop, now);
    assert(acts == MUSE_VC_ACT_END_CALL && c.reason == MUSE_VC_END_STOP && c.media_open);
    assert(feed(&c, stop, now) == 0);   /* a repeat is ignored */
    finish(&c, acts, &now, log, sizeof(log));
    assert(!strcmp(log, "endcall halfclose ended"));

    /* The server ending the media: remote end, end-call still sent. */
    go_live(&c, &now);
    acts = muse_vc_call_media_end(&c, true, 0, now);
    assert(c.reason == MUSE_VC_END_REMOTE && acts == MUSE_VC_ACT_END_CALL);
    finish(&c, acts, &now, log, sizeof(log));
    assert(!strcmp(log, "endcall ended"));

    /* A reset mid-call: failed, end-call sent. */
    go_live(&c, &now);
    acts = muse_vc_call_media_end(&c, false, 200, now);
    assert(c.reason == MUSE_VC_END_FAILED && acts == MUSE_VC_ACT_END_CALL);

    /* Rejected before the head (HTTP 403): end-call anyway, no reset (the stream is gone). */
    muse_vc_call_init(&c, &LIMITS, &s_turns);
    muse_vc_call_begin(&c, "id", now);
    acts = muse_vc_call_media_end(&c, false, 403, now);
    assert(c.reason == MUSE_VC_END_REJECTED && c.http_status == 403 && acts == MUSE_VC_ACT_END_CALL);
    finish(&c, acts, &now, log, sizeof(log));
    assert(!strcmp(log, "endcall ended"));

    /* A stream dropped before any head: no phantom call either side. */
    muse_vc_call_init(&c, &LIMITS, &s_turns);
    muse_vc_call_begin(&c, "id", now);
    acts = muse_vc_call_media_end(&c, false, 0, now);
    assert(c.reason == MUSE_VC_END_FAILED && (acts & MUSE_VC_ACT_END_CALL) && !(acts & MUSE_VC_ACT_RESET_MEDIA));
    finish(&c, acts, &now, log, sizeof(log));
    assert(c.state == MUSE_VC_IDLE);

    /* Before the call is live an error event fails it (reset + end-call). Once
     * live, only session_dead does; others are advisory. */
    muse_vc_call_init(&c, &LIMITS, &s_turns);
    muse_vc_call_begin(&c, "id", now);
    muse_vc_call_head(&c, 200, now);
    acts = feed(&c, "{\"type\":\"error\",\"error\":{\"type\":\"backend_unavailable\",\"message\":\"m\"}}", now);
    assert(acts == (MUSE_VC_ACT_RESET_MEDIA | MUSE_VC_ACT_END_CALL) && c.reason == MUSE_VC_END_FAILED);
    go_live(&c, &now);
    assert(feed(&c, "{\"type\":\"error\",\"error\":{\"type\":\"server_error\",\"message\":\"queue full\"}}",
                now) == 0);
    assert(feed(&c, "{\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"code\":\"image_unsupported\","
                    "\"message\":\"m\"}}", now) == 0);
    assert(c.state == MUSE_VC_LIVE && c.advisory_errors == 2);
    acts = feed(&c, "{\"type\":\"error\",\"error\":{\"type\":\"server_error\",\"code\":\"session_dead\",\"message\":\"m\"}}",
                now);
    assert(acts == (MUSE_VC_ACT_RESET_MEDIA | MUSE_VC_ACT_END_CALL) && c.reason == MUSE_VC_END_FAILED);

    /* The readiness fence: the exact call id and a session id, or the call fails. */
    static const char *bad_sessions[] = {
        "{\"type\":\"hatch.voice.session\"}",
        "{\"type\":\"hatch.voice.session\",\"session_id\":\"s\"}",
        "{\"type\":\"hatch.voice.session\",\"call_id\":\"\",\"session_id\":\"s\"}",
        "{\"type\":\"hatch.voice.session\",\"call_id\":\"other\",\"session_id\":\"s\"}",
        "{\"type\":\"hatch.voice.session\",\"call_id\":\"11111111-2222-4333-8444-555555555555\"}",
        "{\"type\":\"hatch.voice.session\",\"call_id\":\"11111111-2222-4333-8444-555555555555\",\"session_id\":\"\"}",
        "{\"type\":\"hatch.voice.session\",\"call_id\":\"11111111-2222-4333-8444-555555555555\",\"session_id\":7}",
        "{\"type\":\"hatch.voice.session\",\"call_id\":\"11111111-2222-4333-8444-5555555555556\",\"session_id\":\"s\"}",
        "{\"type\":\"hatch.voice.session\",\"call_id\":\"11111111-2222-4333-8444-555555555555\",\"session_id\":\"s\","
        "\"thread_id\":\"\"}",
        /* An escaped NUL or other control can't make a longer id pass for the exact one. */
        "{\"type\":\"hatch.voice.session\",\"call_id\":\"11111111-2222-4333-8444-555555555555\\u0000x\",\"session_id\":\"s\"}",
        "{\"type\":\"hatch.voice.session\",\"call_id\":\"11111111-2222-4333-8444-555555555555\\u0000\",\"session_id\":\"s\"}",
        "{\"type\":\"hatch.voice.session\",\"call_id\":\"11111111-2222-4333-8444-555555555555\",\"session_id\":\"s\\u0000\"}",
        "{\"type\":\"hatch.voice.session\",\"call_id\":\"11111111-2222-4333-8444-555555555555\",\"session_id\":\"\\u0000\"}",
        "{\"type\":\"hatch.voice.session\",\"call_id\":\"11111111-2222-4333-8444-555555555555\",\"session_id\":\"s\\n\"}",
        "{\"type\":\"hatch.voice.session\",\"call_id\":\"11111111-2222-4333-8444-555555555555\",\"session_id\":\"s\","
        "\"thread_id\":\"t\\u0000x\"}",
        "{\"type\":\"hatch.voice.session\",\"call_id\":\"11111111-2222-4333-8444-555555555555\",\"session_id\":\"s\","
        "\"thread_id\":5}",
        /* Escapes decode first: an over-capacity id is refused, not cut to fit. */
        "{\"type\":\"hatch.voice.session\",\"call_id\":\"\\u0031\\u0031\\u0031\\u0031\\u0031\\u0031\\u0031\\u0031-2222-4333-8444-5555555555551\",\"session_id\":\"s\"}",
        "{\"type\":\"hatch.voice.session\",\"call_id\":true,\"session_id\":\"s\"}",
    };
    for (size_t i = 0; i < sizeof(bad_sessions) / sizeof(bad_sessions[0]); i++) {
        muse_vc_call_init(&c, &LIMITS, &s_turns);
        muse_vc_call_begin(&c, "11111111-2222-4333-8444-555555555555", now);
        muse_vc_call_head(&c, 200, now);
        acts = feed(&c, bad_sessions[i], now);
        assert(!(acts & MUSE_VC_ACT_READY) && c.state == MUSE_VC_ENDING && c.reason == MUSE_VC_END_FAILED);
        assert(acts == (MUSE_VC_ACT_RESET_MEDIA | MUSE_VC_ACT_END_CALL));
    }
    /* No thread id is fine (the primary thread). */
    muse_vc_call_init(&c, &LIMITS, &s_turns);
    muse_vc_call_begin(&c, "id-1", now);
    muse_vc_call_head(&c, 200, now);
    assert(feed(&c, "{\"type\":\"hatch.voice.session\",\"call_id\":\"id-1\",\"session_id\":\"s\"}", now) ==
           MUSE_VC_ACT_READY && c.thread_id[0] == '\0');

    /* Mid-speech isn't idle, however long the caller talks; the cap still applies. */
    go_live(&c, &now);
    feed(&c, "{\"type\":\"input_audio_buffer.speech_started\",\"event_id\":\"e\",\"item_id\":\"i\"}", now);
    for (t = now; t < now + 120000000; t += 1000000) {
        assert(muse_vc_call_poll(&c, t) == 0);
    }
    feed(&c, "{\"type\":\"hatch.voice.input_suppressed\",\"event_id\":\"e\",\"item_id\":\"i\"}", t);
    assert(!c.speaking && muse_vc_call_poll(&c, t + LIMITS.idle_us) == 0);
    assert(muse_vc_call_poll(&c, t + LIMITS.idle_us + 1) != 0 && c.reason == MUSE_VC_END_IDLE);
    go_live(&c, &now);
    feed(&c, "{\"type\":\"input_audio_buffer.speech_started\",\"event_id\":\"e\",\"item_id\":\"i\"}", now);
    for (t = now; t <= now + LIMITS.max_us; t += 10000000) {
        assert(muse_vc_call_poll(&c, t) == 0);
    }
    assert(muse_vc_call_poll(&c, now + LIMITS.max_us + 1) != 0 && c.reason == MUSE_VC_END_MAX);

    /* Only the speaking item's own events end its speech: a delayed reply's
     * turn_started and settlement for an older item leave newer speech open. */
    go_live(&c, &now);
    feed(&c, "{\"type\":\"hatch.voice.turn_started\",\"event_id\":\"e\",\"submission_message_id\":\"sA\",\"item_id\":\"iA\"}", now);
    feed(&c, "{\"type\":\"hatch.voice.turn_settled\",\"event_id\":\"e\",\"response_message_id\":\"sA\"}", now);
    feed(&c, "{\"type\":\"input_audio_buffer.speech_started\",\"event_id\":\"e\",\"item_id\":\"iB\"}", now);
    feed(&c, "{\"type\":\"hatch.voice.turn_started\",\"event_id\":\"e\",\"submission_message_id\":\"sA2\",\"item_id\":\"iA\"}", now);
    feed(&c, "{\"type\":\"hatch.voice.turn_settled\",\"event_id\":\"e\",\"response_message_id\":\"sA2\"}", now);
    feed(&c, "{\"type\":\"input_audio_buffer.speech_stopped\",\"event_id\":\"e\",\"item_id\":\"iA\"}", now);
    assert(c.speaking && !strcmp(c.speaking_item, "iB") && c.turns->n_active == 0);
    for (t = now; t < now + 60000000; t += 1000000) {
        assert(muse_vc_call_poll(&c, t) == 0);
    }
    feed(&c, "{\"type\":\"hatch.voice.turn_started\",\"event_id\":\"e\",\"submission_message_id\":\"sB\",\"item_id\":\"iB\"}", t);
    assert(!c.speaking);

    /* Turns by identity (as the Linux client): a settlement retires its
     * submission and earlier ones for the same item, never newer aliases,
     * other items, unknown or unnamed submissions; repeats are ignored. */
    go_live(&c, &now);
#define STARTED(sub, item) feed(&c, "{\"type\":\"hatch.voice.turn_started\",\"event_id\":\"e\",\"submission_message_id\":\"" \
                                sub "\",\"item_id\":\"" item "\"}", now)
#define SETTLED(sub) feed(&c, "{\"type\":\"hatch.voice.turn_settled\",\"event_id\":\"e\",\"response_message_id\":\"" sub "\"}", now)
    STARTED("s1", "i1");
    STARTED("s2", "i2");
    STARTED("s1b", "i1");    /* a delayed reply for i1 */
    STARTED("s1c", "i1");    /* a newer alias for i1 */
    STARTED("s1", "i1");     /* a repeat */
    assert(c.turns->n_active == 4);
    feed(&c, "{\"type\":\"hatch.voice.turn_settled\",\"event_id\":\"e\"}", now);   /* unnamed */
    SETTLED("nope");
    assert(c.turns->n_active == 4);
    SETTLED("s1b");          /* retires s1 and s1b; s2 and s1c stay */
    assert(c.turns->n_active == 2 && !strcmp(c.turns->active[0].submission, "s2") &&
           !strcmp(c.turns->active[1].submission, "s1c"));
    SETTLED("s1b");          /* a duplicate */
    STARTED("s1", "i1");     /* settled before: not active again */
    assert(c.turns->n_active == 2);
    /* Idle doesn't run while any turn is active; the cap does. */
    now += 10 * LIMITS.idle_us;
    assert(muse_vc_call_poll(&c, now) == 0 && c.state == MUSE_VC_LIVE);
    SETTLED("s2");
    SETTLED("s1c");
    assert(c.turns->n_active == 0);
    t = now;
    assert(muse_vc_call_poll(&c, t + LIMITS.idle_us) == 0);
    assert(muse_vc_call_poll(&c, t + LIMITS.idle_us + 1) != 0 && c.reason == MUSE_VC_END_IDLE);

    /* Working: a live call with a caller turn not yet settled. A settlement
     * with handoffs pending (a spoken approval prompt) leaves Muse waiting on
     * the caller, not working; one reporting nothing pending retires every
     * turn, including one Muse never settled by name. Malformed or absent
     * counts change nothing (older VMs: only named settlements retire). */
#define SETTLED_PENDING(sub, n) feed(&c, "{\"type\":\"hatch.voice.turn_settled\",\"event_id\":\"e\",\"response_message_id\":\"" \
                                     sub "\",\"async_handoffs_pending\":" n "}", now)
    go_live(&c, &now);
    assert(!muse_vc_call_working(&c));
    STARTED("w1", "iw1");
    assert(muse_vc_call_working(&c));
    SETTLED_PENDING("w1", "1");          /* approval prompt: waiting on the caller */
    assert(c.turns->n_active == 0 && !muse_vc_call_working(&c));
    STARTED("w0", "iw0");
    assert(muse_vc_call_working(&c));
    SETTLED_PENDING("prompt", "2");      /* a boundary naming none of the caller's turns */
    assert(c.turns->n_active == 1 && !muse_vc_call_working(&c));   /* open, but waiting on the caller */
    STARTED("w0", "iw0");                /* a repeated start isn't a new turn */
    assert(!muse_vc_call_working(&c));
    t = now;
    assert(muse_vc_call_poll(&c, t + LIMITS.idle_us + 1) == 0);   /* the open turn still holds the idle limit */
    SETTLED_PENDING("w0", "1");
    assert(c.turns->n_active == 0);
    STARTED("w2", "iw2");                /* the caller's answer */
    STARTED("w3", "iw3");                /* a question asked while the handoff runs */
    assert(muse_vc_call_working(&c));
    SETTLED_PENDING("w2", "\"0\"");    /* not a number: only the named turn settles */
    assert(c.turns->n_active == 1 && muse_vc_call_working(&c));
    SETTLED_PENDING("w2", "-1");
    SETTLED_PENDING("w2", "0.5");
    SETTLED_PENDING("w2", "-0");         /* only plain digits count */
    SETTLED_PENDING("w2", "0.0");
    SETTLED_PENDING("w2", "1e-999");
    SETTLED_PENDING("w2", "4294967296");
    SETTLED("w2");                       /* no field: as before */
    assert(c.turns->n_active == 1);
    SETTLED_PENDING("w9", "0");          /* w3 has no reply yet: it stays */
    assert(c.turns->n_active == 1);
    SETTLED_PENDING("w2", "0");          /* a repeat of w2's settlement changes nothing */
    assert(c.turns->n_active == 1 && muse_vc_call_working(&c));
    feed(&c, "{\"type\":\"response.created\",\"event_id\":\"e\",\"response\":{\"id\":\"rw3\"}}", now);
    feed(&c, "{\"type\":\"response.done\",\"event_id\":\"e\",\"response\":{\"id\":\"rw3\"}}", now);
    SETTLED_PENDING("w9", "0");          /* nothing pending: w3 retires too */
    assert(c.turns->n_active == 0 && !muse_vc_call_working(&c));
    t = now;
    assert(muse_vc_call_poll(&c, t + LIMITS.idle_us) == 0);   /* a fresh idle window */
    STARTED("w3", "iw3");                /* settled before: not active again */
    assert(!muse_vc_call_working(&c));
    STARTED("w4", "iw4");
    muse_vc_call_hang_up(&c, MUSE_VC_END_LOCAL, now);
    assert(!muse_vc_call_working(&c));   /* only a live call works */
    go_live(&c, &now);
    assert(!muse_vc_call_working(&c));   /* a new call starts with nothing open */
#undef SETTLED_PENDING

    go_live(&c, &now);
    STARTED("s1", "i1");
    for (t = now; t <= now + LIMITS.max_us; t += 10000000) {
        assert(muse_vc_call_poll(&c, t) == 0);
    }
    assert(muse_vc_call_poll(&c, now + LIMITS.max_us + 1) != 0 && c.reason == MUSE_VC_END_MAX);
    /* A turn that can't be tracked fails the call rather than be guessed at. */
    go_live(&c, &now);
    acts = feed(&c, "{\"type\":\"hatch.voice.turn_started\",\"event_id\":\"e\",\"item_id\":\"i\"}", now);
    assert(c.reason == MUSE_VC_END_FAILED && (acts & MUSE_VC_ACT_END_CALL));
    go_live(&c, &now);
    {
        char line[512];
        snprintf(line, sizeof(line), "{\"type\":\"hatch.voice.turn_started\",\"submission_message_id\":\"%0129d\","
                                     "\"item_id\":\"i\"}", 0);
        acts = feed(&c, line, now);
        assert(c.reason == MUSE_VC_END_FAILED);
    }
    go_live(&c, &now);
    for (int i = 0; i < MUSE_VC_MAX_TURNS; i++) {
        char line[256];
        snprintf(line, sizeof(line), "{\"type\":\"hatch.voice.turn_started\",\"submission_message_id\":\"s%d\","
                                     "\"item_id\":\"i%d\"}", i, i);
        assert(feed(&c, line, now) == 0);
    }
    acts = STARTED("one-more", "i");
    assert(c.reason == MUSE_VC_END_FAILED && (acts & MUSE_VC_ACT_END_CALL));
    /* A submission seen again with another item is a conflict, not a repeat:
     * the call fails, and the conflicting event doesn't end that item's speech. */
    go_live(&c, &now);
    STARTED("s1", "i1");
    feed(&c, "{\"type\":\"input_audio_buffer.speech_started\",\"event_id\":\"e\",\"item_id\":\"i2\"}", now);
    acts = STARTED("s1", "i2");
    assert(c.speaking && !strcmp(c.speaking_item, "i2"));
    assert(c.reason == MUSE_VC_END_FAILED && (acts & MUSE_VC_ACT_END_CALL));
    /* The same after it settled. */
    go_live(&c, &now);
    STARTED("s1", "i1");
    SETTLED("s1");
    acts = STARTED("s1", "i9");
    assert(c.reason == MUSE_VC_END_FAILED);
    /* A NUL-suffixed duplicate submission (or item) isn't the same turn: refused. */
    go_live(&c, &now);
    STARTED("s1", "i1");
    acts = feed(&c, "{\"type\":\"hatch.voice.turn_started\",\"submission_message_id\":\"s1\\u0000x\",\"item_id\":\"i1\"}", now);
    assert(c.reason == MUSE_VC_END_FAILED && c.turns->n_active == 1);
    go_live(&c, &now);
    STARTED("s1", "i1");
    acts = feed(&c, "{\"type\":\"hatch.voice.turn_started\",\"submission_message_id\":\"s2\",\"item_id\":\"i1\\u0000\"}", now);
    assert(c.reason == MUSE_VC_END_FAILED && c.turns->n_active == 1);
    /* ...nor does a NUL-suffixed settlement retire the turn. */
    go_live(&c, &now);
    STARTED("s1", "i1");
    feed(&c, "{\"type\":\"hatch.voice.turn_settled\",\"response_message_id\":\"s1\\u0000x\"}", now);
    assert(c.turns->n_active == 1 && c.state == MUSE_VC_LIVE);
    /* ...nor a NUL-suffixed item end the speech of the item it prefixes. */
    feed(&c, "{\"type\":\"input_audio_buffer.speech_started\",\"item_id\":\"i5\"}", now);
    feed(&c, "{\"type\":\"input_audio_buffer.speech_stopped\",\"item_id\":\"i5\\u0000x\"}", now);
    assert(c.speaking);
#undef STARTED
#undef SETTLED

    /* No head in time: reset the media, end-call. No session in time: the same. */
    muse_vc_call_init(&c, &LIMITS, &s_turns);
    muse_vc_call_begin(&c, "id", now);
    assert(muse_vc_call_poll(&c, now + LIMITS.open_us) == 0);
    acts = muse_vc_call_poll(&c, now + LIMITS.open_us + 1);
    assert(acts == (MUSE_VC_ACT_RESET_MEDIA | MUSE_VC_ACT_END_CALL) && c.reason == MUSE_VC_END_NO_ANSWER);
    muse_vc_call_init(&c, &LIMITS, &s_turns);
    muse_vc_call_begin(&c, "id", now);
    muse_vc_call_head(&c, 200, now);
    acts = muse_vc_call_poll(&c, now + LIMITS.ready_us + 1);
    assert(acts == (MUSE_VC_ACT_RESET_MEDIA | MUSE_VC_ACT_END_CALL) && c.reason == MUSE_VC_END_NO_ANSWER);

    /* Idle: activity restarts the clock; silence alone (no activity calls) runs it out. */
    go_live(&c, &now);
    t = now;
    for (int i = 0; i < 10; i++) {
        t += 10000000;
        muse_vc_call_activity(&c, t);
        assert(muse_vc_call_poll(&c, t) == 0);
    }
    assert(muse_vc_call_poll(&c, t + LIMITS.idle_us) == 0);
    acts = muse_vc_call_poll(&c, t + LIMITS.idle_us + 1);
    assert(c.reason == MUSE_VC_END_IDLE && acts == MUSE_VC_ACT_END_CALL);
    /* Held input isn't idle. */
    go_live(&c, &now);
    assert(feed(&c, "{\"type\":\"hatch.voice.switch_input_hold\",\"event_id\":\"e\",\"held\":true}", now) ==
           MUSE_VC_ACT_HOLD && c.held);
    assert(muse_vc_call_poll(&c, now + 2 * LIMITS.idle_us) == 0 && c.state == MUSE_VC_LIVE);
    assert(feed(&c, "{\"type\":\"hatch.voice.switch_input_hold\",\"event_id\":\"e\",\"held\":false}", now) ==
           MUSE_VC_ACT_HOLD && !c.held);
    /* The length cap. */
    go_live(&c, &now);
    for (t = now; t < now + LIMITS.max_us; t += 10000000) {
        muse_vc_call_activity(&c, t);
        assert(muse_vc_call_poll(&c, t) == 0);
    }
    muse_vc_call_activity(&c, t);
    acts = muse_vc_call_poll(&c, t + 1);
    assert(c.reason == MUSE_VC_END_MAX);

    /* The end-call never answered, the media never drained: both given up on. */
    go_live(&c, &now);
    acts = muse_vc_call_hang_up(&c, MUSE_VC_END_LOCAL, now);
    assert(acts == MUSE_VC_ACT_END_CALL);
    muse_vc_call_end_call_sent(&c, now);
    acts = muse_vc_call_poll(&c, now + LIMITS.end_call_us + 1);
    assert(acts == (MUSE_VC_ACT_RESET_END_CALL | MUSE_VC_ACT_HALF_CLOSE));
    int64_t hc = now + LIMITS.end_call_us + 1;
    assert(muse_vc_call_poll(&c, hc + LIMITS.drain_us) == 0);
    acts = muse_vc_call_poll(&c, hc + LIMITS.drain_us + 1);
    assert(acts == (MUSE_VC_ACT_RESET_MEDIA | MUSE_VC_ACT_ENDED) && c.state == MUSE_VC_IDLE);

    /* The connection lost: over at once, nothing to send. During an ending, too. */
    go_live(&c, &now);
    assert(muse_vc_call_lost(&c, now) == MUSE_VC_ACT_ENDED && c.reason == MUSE_VC_END_LOST);
    assert(muse_vc_call_lost(&c, now) == 0);
    go_live(&c, &now);
    muse_vc_call_hang_up(&c, MUSE_VC_END_LOCAL, now);
    assert(muse_vc_call_lost(&c, now) == MUSE_VC_ACT_ENDED && c.reason == MUSE_VC_END_LOCAL);

    /* A session for another call fails this one; it never goes live. */
    muse_vc_call_init(&c, &LIMITS, &s_turns);
    muse_vc_call_begin(&c, "mine", now);
    muse_vc_call_head(&c, 200, now);
    acts = feed(&c, "{\"type\":\"hatch.voice.session\",\"call_id\":\"theirs\",\"session_id\":\"s\"}", now);
    assert(!(acts & MUSE_VC_ACT_READY) && c.reason == MUSE_VC_END_FAILED);

    /* Nothing happens to an idle call. */
    muse_vc_call_init(&c, &LIMITS, &s_turns);
    assert(muse_vc_call_hang_up(&c, MUSE_VC_END_LOCAL, now) == 0);
    assert(muse_vc_call_media_end(&c, true, 0, now) == 0 && muse_vc_call_poll(&c, now) == 0);
    assert(feed(&c, stop, now) == 0);
}

static void unit_gate(void)
{
    muse_vc_gate_t g;
    int16_t loud[320], quiet[320];
    for (int i = 0; i < 320; i++) {
        loud[i] = (int16_t)((i % 40) < 20 ? 8000 : -8000);
        quiet[i] = (int16_t)(i % 2 ? 40 : -40);   /* keepalive-level noise */
    }
    muse_vc_gate_init(&g, false, 300000);
    assert(muse_vc_gate_mic_open(&g, 0));
    /* Silence, however much, keeps it open. */
    for (int i = 0; i < 1000; i++) {
        muse_vc_gate_playout(&g, quiet, 320, i * 20000, 500000);
    }
    assert(muse_vc_gate_mic_open(&g, 20000000));
    /* Audible audio shuts it until it has played (queue + 20 ms) plus the tail. */
    muse_vc_gate_playout(&g, loud, 320, 30000000, 100000);
    assert(!muse_vc_gate_mic_open(&g, 30000000 + 100000 + 20000 + 300000 - 1));
    assert(muse_vc_gate_mic_open(&g, 30000000 + 100000 + 20000 + 300000));
    /* A barge-in flush leaves only the tail. */
    muse_vc_gate_playout(&g, loud, 320, 40000000, 2000000);
    muse_vc_gate_flush(&g, 40000000);
    assert(!muse_vc_gate_mic_open(&g, 40299999) && muse_vc_gate_mic_open(&g, 40300000));
    /* Full duplex never shuts. */
    muse_vc_gate_init(&g, true, 300000);
    muse_vc_gate_playout(&g, loud, 320, 0, 1000000);
    assert(muse_vc_gate_mic_open(&g, 1));
}

static int lines_seen;
static size_t lines_last;
static void count_line(void *ctx, const char *line, size_t len)
{
    (void)ctx;
    (void)line;
    lines_seen++;
    lines_last = len;
}

static void unit_lines(void)
{
    char buf[16];
    muse_vc_lines_t l;
    muse_vc_lines_init(&l, buf, sizeof(buf));
    const char *in = "short\r\n\n0123456789abcdef_too_long\nok\nexactly16bytes!!\n";
    muse_vc_lines_feed(&l, (const uint8_t *)in, strlen(in), count_line, NULL, NULL);
    assert(lines_seen == 3 && l.skipped == 1 && lines_last == 16);
    /* A long line split across feeds is still skipped whole. */
    lines_seen = 0;
    const char *a = "aaaaaaaaaaaa", *b = "bbbbbbbbbbbb\nfine\n";
    muse_vc_lines_feed(&l, (const uint8_t *)a, strlen(a), count_line, NULL, NULL);
    muse_vc_lines_feed(&l, (const uint8_t *)b, strlen(b), count_line, NULL, NULL);
    assert(lines_seen == 1 && lines_last == 4 && l.skipped == 2);
}

static void unit_misc(void)
{
    uint8_t rnd[16];
    memset(rnd, 0xff, sizeof(rnd));
    char id[37];
    muse_vc_uuid(rnd, id);
    assert(strlen(id) == 36 && id[14] == '4' && (id[19] == 'b' || id[19] == 'f' || id[19] == '9' || id[19] == 'a' ||
                                                 id[19] == '8'));
    char esc[8];
    assert(!muse_vc_json_escape("too long for it", esc, sizeof(esc)));
    assert(muse_vc_json_escape("a\"b", esc, sizeof(esc)) && !strcmp(esc, "a\\\"b"));
    /* Uplink pacing: a second ahead at the start, 1.5x after. */
    muse_vc_uplink_t u;
    muse_vc_uplink_init(&u);
    u.sent = 24000 - 960;
    assert(muse_vc_uplink_may_send(&u, 0, 0));
    u.sent = 24000;
    assert(!muse_vc_uplink_may_send(&u, 0, 0));
    assert(muse_vc_uplink_may_send(&u, 1000000, 0));
}

int main(int argc, char **argv)
{
    if (argc < 2) {
        return 2;
    }
    const char *m = argv[1];
    if (!strcmp(m, "valid")) return mode_valid();
    if (!strcmp(m, "get") && argc == 3) return mode_get(argv[2]);
    if (!strcmp(m, "unescape") && argc == 3) return mode_unescape(atoi(argv[2]));
    if (!strcmp(m, "b64")) return mode_b64();
    if (!strcmp(m, "uplink") && argc == 3) return mode_uplink(atoi(argv[2]));
    if (!strcmp(m, "resample") && argc == 5) return mode_resample(atoi(argv[2]), atoi(argv[3]), (size_t)atol(argv[4]));
    if (!strcmp(m, "down") && argc == 4) return mode_down((unsigned)atoi(argv[2]), argv[3]);
    if (!strcmp(m, "time")) return mode_time();
    if (!strcmp(m, "admission") && argc == 5) return mode_admission(argv[2], argv[3], atoi(argv[4]));
    if (!strcmp(m, "endcall") && argc == 6) return mode_endcall(argv[2], argv[3], atoll(argv[4]), atoll(argv[5]));
    if (!strcmp(m, "unit")) {
        unit_lifecycle();
        unit_gate();
        unit_lines();
        unit_misc();
        printf("ok\n");
        return 0;
    }
    return 2;
}
