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

/*
 * The protocol side of a realtime voice call, with no ESP-IDF or FreeRTOS in
 * it so the host tests compile it as is (tests/test_muse_voice_call.py).
 * muse_voice_call.cpp moves bytes between it, the session's streams and the
 * voice task.
 *
 * The wire, over the Muse session's HTTP-over-Noise connection:
 *   POST /voice/realtime?call_id=ID, body left open (NDJSON both ways):
 *     up:   one hatch.voice.call.start admission record, then
 *           input_audio_buffer.append lines: 40 ms (960 samples) of 24 kHz
 *           mono PCM16LE each, base64, paced to real time;
 *     down: server events, one per line. Audio arrives as
 *           continuous_audio_video.delta audio_delta.audio_frames (or the
 *           older response.output_audio.delta delta), 24 kHz PCM16LE base64.
 *   POST /voice/end-call {call_id, call_started_at, call_ended_at, thread_id?}
 *     on every way out of a call while the connection is up: closing the
 *     media alone doesn't end the call. Server policy may also end a call
 *     before the client's own limits.
 */

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define MUSE_VC_MIC_RATE 16000
#define MUSE_VC_WIRE_RATE 24000
#define MUSE_VC_FRAME 960                     /* samples per append: 40 ms at 24 kHz */
#define MUSE_VC_FRAME_B64 (4 * ((MUSE_VC_FRAME * 2 + 2) / 3))
#define MUSE_VC_APPEND_MAX (MUSE_VC_FRAME_B64 + 64)
#define MUSE_VC_LINE_MAX (32 * 1024)          /* longer downlink lines are skipped */
#define MUSE_VC_JSON_DEPTH 32
#define MUSE_VC_CALL_ID_MAX 40
#define MUSE_VC_ID_MAX 96
#define MUSE_VC_TURN_ID_MAX 129               /* a turn's ids: 1..128 bytes */
#define MUSE_VC_MAX_TURNS 16                  /* active turns tracked; more fails the call */
#define MUSE_VC_ADMISSION_MAX 512
#define MUSE_VC_END_CALL_MAX 512
/* Peak above which played audio counts as sound: the server streams silent
 * keepalive frames all call long, and those must neither hold the mic shut
 * nor count as activity. About -42 dBFS. */
#define MUSE_VC_AUDIBLE_PEAK 256

typedef struct {
    const char *p;
    size_t n;
} muse_vc_span_t;

/* ---- JSON: a bounded structural scanner ----
 * Walks a line as JSON without building a tree, so a 3 KB audio line costs no
 * allocation. Keys only match where the path says (an "audio_frames" inside
 * some string or another object doesn't). */

typedef enum {
    MUSE_VC_J_NONE,      /* absent, or the line isn't valid JSON */
    MUSE_VC_J_STRING,    /* span: the raw contents between the quotes, escapes intact */
    MUSE_VC_J_NUMBER,
    MUSE_VC_J_TRUE,
    MUSE_VC_J_FALSE,
    MUSE_VC_J_NULL,
    MUSE_VC_J_OBJECT,    /* span: the whole value, braces included */
    MUSE_VC_J_ARRAY,
} muse_vc_jkind_t;

/* True if `json` is one well-formed JSON value (nesting up to MUSE_VC_JSON_DEPTH). */
bool muse_vc_json_valid(const char *json, size_t len);
/* The member at dotted `path` ("audio_delta.audio_frames") of the object `json`. */
muse_vc_jkind_t muse_vc_json_get(const char *json, size_t len, const char *path, muse_vc_span_t *out);
/* Unescapes a raw string span into out (NUL-terminated, truncated at a UTF-8
 * boundary to fit). False on a bad escape. */
bool muse_vc_json_unescape(muse_vc_span_t raw, char *out, size_t cap);
/* Writes `s` as a JSON string body (no quotes); returns false if it didn't fit. */
bool muse_vc_json_escape(const char *s, char *out, size_t cap);

/* ---- base64 ---- */

/* Strict standard base64 from a raw JSON string span (a "\/" escape is
 * accepted). Returns the decoded length, or -1 if invalid or over cap. */
long muse_vc_b64_decode(muse_vc_span_t raw, uint8_t *out, size_t cap);
size_t muse_vc_b64_encode(const uint8_t *in, size_t n, char *out);

/* ---- Server events ---- */

typedef enum {
    MUSE_VC_EV_OTHER,             /* valid, but nothing a gadget acts on */
    MUSE_VC_EV_SESSION,           /* hatch.voice.session: the call is live */
    MUSE_VC_EV_AUDIO,             /* audio: base64 PCM16LE 24 kHz */
    MUSE_VC_EV_SPEECH_STARTED,    /* the caller started talking: drop queued playback */
    MUSE_VC_EV_SPEECH_STOPPED,
    MUSE_VC_EV_RESPONSE_CREATED,
    MUSE_VC_EV_RESPONSE_DONE,     /* status may be "cancelled": a turn status, not the call's */
    MUSE_VC_EV_TURN_STARTED,
    MUSE_VC_EV_TURN_SETTLED,
    MUSE_VC_EV_HOLD,              /* hatch.voice.switch_input_hold: held */
    MUSE_VC_EV_REPLY_TEXT,        /* text: a piece of the spoken reply's transcript */
    MUSE_VC_EV_REPLY_DONE,        /* text: the whole transcript of that reply */
    MUSE_VC_EV_USER_TEXT,         /* text: what the caller said (delta or final) */
    MUSE_VC_EV_STOP,              /* conversation.item.added session_control "stop" */
    MUSE_VC_EV_ERROR,             /* text: message; code, etype. Fatal before the call is live,
                                   * or with code "session_dead"; otherwise advisory */
    MUSE_VC_EV_INPUT_SUPPRESSED,  /* the caller's speech was side speech: no turn */
} muse_vc_ev_kind_t;

typedef struct {
    muse_vc_ev_kind_t kind;
    muse_vc_span_t audio;         /* raw base64 */
    bool audio_rate_ok;           /* no format.rate, or it's 24000 */
    bool audio_cavd;              /* AUDIO from continuous_audio_video.delta */
    muse_vc_span_t response_id;   /* AUDIO (CAVD only): the provider's response_id, raw */
    bool held;
    muse_vc_span_t text;          /* raw JSON string */
    muse_vc_span_t status;        /* RESPONSE_DONE: response.status */
    muse_vc_span_t code, etype;   /* ERROR: error.code, error.type */
    muse_vc_span_t call_id, session_id, thread_id;   /* SESSION */
    muse_vc_span_t item_id;       /* SPEECH_*, INPUT_SUPPRESSED, TURN_STARTED */
    muse_vc_span_t submission_id; /* TURN_STARTED: submission_message_id */
    muse_vc_span_t response_message_id;              /* TURN_SETTLED */
    /* TURN_SETTLED's async_handoffs_pending as plain digits, absent from VMs
     * that predate it: 0 (no delegated work in the call is open), or 1 or
     * more (a boundary, such as a spoken approval prompt). */
    bool handoffs_none;
    bool handoffs_open;
    muse_vc_span_t mapper_response_id;               /* RESPONSE_CREATED, RESPONSE_DONE: response.id */
    /* RESPONSE_CREATED: response.submission_message_id, the caller turn the
     * response answers (absent for early or trailing media, older VMs). */
    muse_vc_span_t response_submission_id;
} muse_vc_event_t;

/* False for a line that isn't one JSON object with a string "type". */
bool muse_vc_parse_event(const char *line, size_t len, muse_vc_event_t *ev);

/* ---- NDJSON lines, bounded ---- */

typedef struct {
    char *buf;         /* caller's, cap bytes */
    size_t cap;
    size_t len;
    bool skipping;     /* the current line outgrew cap: dropped up to its newline */
    uint32_t skipped;
} muse_vc_lines_t;

typedef void (*muse_vc_line_fn)(void *ctx, const char *line, size_t len);
void muse_vc_lines_init(muse_vc_lines_t *l, char *buf, size_t cap);
/* Calls fn for each complete line ("\r\n" tolerated, empty lines skipped). fn
 * may return early by setting *stop (checked between lines). */
void muse_vc_lines_feed(muse_vc_lines_t *l, const uint8_t *data, size_t len, muse_vc_line_fn fn, void *ctx,
                        const volatile bool *stop);

/* ---- Audio ---- */

typedef struct {
    uint32_t step;     /* Q16 input samples per output sample, rounded up */
    uint32_t pos;      /* Q16, below step between calls */
    int16_t prev;
} muse_vc_resampler_t;

void muse_vc_resampler_init(muse_vc_resampler_t *r, int in_rate, int out_rate);
/* The most samples one call resampling n input samples writes: n*out/in + 2,
 * for any n (the step rounds up, so rounding never adds more). */
size_t muse_vc_resample_bound(int in_rate, int out_rate, size_t n);
/* Linear interpolation, state carried across calls; any n. out must hold
 * muse_vc_resample_bound(in_rate, out_rate, n) samples. Splitting the input
 * across calls gives the same output as one call. */
size_t muse_vc_resample(muse_vc_resampler_t *r, const int16_t *in, size_t n, int16_t *out);
int muse_vc_peak(const int16_t *pcm, size_t n);

/* Mic (16 kHz) -> append lines (24 kHz, MUSE_VC_FRAME samples each). */
typedef struct {
    muse_vc_resampler_t up;
    int16_t frame[MUSE_VC_FRAME];
    int16_t piece[490];   /* one resampled piece of input (320 samples in) */
    size_t fill;
    uint64_t sent;     /* 24 kHz samples sent */
} muse_vc_uplink_t;

void muse_vc_uplink_init(muse_vc_uplink_t *u);
/* Drops any partial frame (after a hold, say). */
void muse_vc_uplink_discard(muse_vc_uplink_t *u);
/* Never more than a second ahead of real time since `live_us`: the server
 * drops appends on a full queue. */
bool muse_vc_uplink_may_send(const muse_vc_uplink_t *u, int64_t now_us, int64_t live_us);
/* Takes up to n samples, stopping after the first completed frame; when one
 * completes, writes its append line (with the trailing newline) to `line`
 * (MUSE_VC_APPEND_MAX) and sets *line_len. Returns samples consumed. */
size_t muse_vc_uplink_push(muse_vc_uplink_t *u, const int16_t *pcm16, size_t n, char *line, size_t *line_len);

/* A decoded audio event, resampled to the speaker's 16 kHz. scratch holds
 * scratch_cap bytes of 24 kHz PCM; out must hold scratch_cap / 3 + 2 samples.
 * Returns samples written to out, or -1 if the audio was invalid (bad
 * base64, odd byte count, too long). *audible: not just silence. */
long muse_vc_decode_audio(muse_vc_resampler_t *down, muse_vc_span_t b64, uint8_t *scratch, size_t scratch_cap,
                          int16_t *out, bool *audible);

/* ---- Half duplex ----
 * Without echo cancellation the speaker leaks into the mic and the server's
 * VAD would barge in on Muse's own voice, so the mic stays shut while
 * anything audible is playing and for a settle tail after. Silent keepalive
 * audio doesn't shut it. */

typedef struct {
    bool full_duplex;
    int64_t tail_us;
    int64_t audible_until_us;
} muse_vc_gate_t;

void muse_vc_gate_init(muse_vc_gate_t *g, bool full_duplex, int64_t tail_us);
/* n samples (16 kHz) handed to the speaker at now_us with queued_us of audio
 * still ahead of them. */
void muse_vc_gate_playout(muse_vc_gate_t *g, const int16_t *pcm, size_t n, int64_t now_us, int64_t queued_us);
/* Playback was dropped (barge-in): only the tail of what already sounded remains. */
void muse_vc_gate_flush(muse_vc_gate_t *g, int64_t now_us);
bool muse_vc_gate_mic_open(const muse_vc_gate_t *g, int64_t now_us);

/* ---- Push-to-talk reply gate ----
 *
 * After a press, the reply that was playing must never come back, and only
 * replies to speech from a later hold may play. Reply audio is identified by
 * the provider's response_id on each continuous_audio_video.delta (not the
 * response.created id, which the server mints itself and reissues when
 * trailing audio of a closed response arrives). PCM carries no link to the
 * caller's input item, so attribution is by order, and conservative:
 *
 *  - A press marks every response_id seen so far stale, for the rest of the
 *    call, and leaves no item current.
 *  - Speech starting on an input item makes it the current item (only the
 *    latest), unconfirmed, and marks stale whatever was playing or waiting
 *    (the server's own barge-in).
 *  - Until hatch.voice.turn_started names the current item, a new id waits
 *    (HOLD: the caller buffers it, bounded) so the reply's first words
 *    aren't lost. That turn_started confirms the item: what waits plays, and
 *    new ids after it play too, without a turn_started of its own (a turn can
 *    have several provider responses: tool continuations, companion replies;
 *    not all of them get an alias turn_started).
 *  - One id plays (or waits) at a time: a newer one takes over, the older
 *    goes stale, and what's queued of it is flushed (FLUSH), so two replies
 *    never interleave. Once the current reply's response.done has come, its
 *    ids play what still arrives until a new id plays; then they stop
 *    without a flush, so what they queued plays first.
 *  - A turn_started naming an older item, one from before the last press,
 *    once the current item's reply has played and finished (its
 *    response.created came, its audio played and its response.done
 *    followed, and nothing waits) makes that item
 *    current and confirmed: older work reporting back (a delegated task's
 *    result, the outcome of a spoken approval) plays. The finished reply's
 *    ids keep playing what still arrives but never take over or flush, and
 *    a continuation that played without a turn of its own is that older
 *    work's. A turn_started naming the latest hold's item again (its own
 *    continuation) makes it current again; the adopted reply stops, after
 *    what it queued. A press that heard no speech
 *    still lets nothing play, and an earlier item of the same hold is never
 *    adopted. A reply cut off by a press never comes back, but the work it
 *    started may report back this way: that is the point, since answering
 *    an approval question with a press is how the user says yes. Audio
 *    carries no link to its item, so a continuation of the latest hold's
 *    reply that arrives without its own turn_started after older work was
 *    adopted counts as that work's (a filler line, then a tool call, then the
 *    real answer as a continuation), and audio of the finished reply that
 *    arrives after the adopted reply starts is cut. turn_settled can't mark
 *    the end instead: it waits for that older work's reply too.
 *  - Otherwise, a turn_started naming any other item (a late reply to older
 *    work) marks stale what waits and what plays without a turn of its own (a
 *    continuation whose audio came before its alias turn: it was that older
 *    work's), flushing it, and blocks new ids, which go stale, until a
 *    turn_started names the current item again. input_suppressed for the
 *    current item leaves none.
 *  - Audio without a response_id, and any new id with no current item, is
 *    dropped. A press that heard no speech so plays nothing until a later one
 *    does; there's no timer.
 *  - Every id is remembered for the whole call. Past MUSE_VC_GATE_IDS
 *    distinct ids the gate can't tell old from new any more: it drops
 *    everything new and says so (muse_vc_reply_gate_full), and the caller
 *    ends the call.
 *
 * Late output of older work that carries no turn_started, arriving while
 * the current item is confirmed, can't be told from a continuation, and
 * plays.
 *
 * The current reply is also tied to the latest turn that named the current
 * item: its submission_message_id, and the response.created id that
 * followed, so muse_vc_reply_gate_done can tell its own completion from an
 * older one's. */

#define MUSE_VC_GATE_IDS 128
#define MUSE_VC_GATE_HOLD_ITEMS 4   /* input items one hold can start */

typedef enum { MUSE_VC_GATE_DROP, MUSE_VC_GATE_HOLD, MUSE_VC_GATE_PLAY } muse_vc_gate_verdict_t;

typedef struct {
    char id[MUSE_VC_TURN_ID_MAX];
    uint8_t state;     /* stale, waiting, playing (confirmed), playing (a continuation, unconfirmed) */
} muse_vc_gate_id_t;

/* muse_vc_reply_gate_take_flush: what the caller must drop now. */
enum {
    MUSE_VC_GATE_FLUSH_PLAYING = 1 << 0,   /* queued playback (an id went stale or was replaced) */
    MUSE_VC_GATE_FLUSH_WAITING = 1 << 1,   /* the waiting id's held audio */
};

typedef struct {
    muse_vc_gate_id_t ids[MUSE_VC_GATE_IDS];   /* every id seen this call */
    uint8_t n_ids;
    bool full;                                 /* an id didn't fit: fail closed */
    char item[MUSE_VC_TURN_ID_MAX];            /* the current input item, or "" */
    bool confirmed;                            /* a turn_started named it */
    bool blocked;                              /* a later turn_started named another item */
    bool turn_fresh;                           /* the next new id is that turn's own */
    uint8_t flush;                             /* MUSE_VC_GATE_FLUSH_* pending */
    bool response_open;                        /* response (below) hasn't reported done */
    char turn[MUSE_VC_TURN_ID_MAX];            /* that turn's submission_message_id */
    char response[MUSE_VC_TURN_ID_MAX];        /* the response.created id after it */
    bool want_response;                        /* the next response.created is its */
    char hold[MUSE_VC_GATE_HOLD_ITEMS][MUSE_VC_TURN_ID_MAX];   /* items since the last press */
    uint8_t n_hold;
    bool hold_full;                            /* more than fit: adopt nothing */
    char hold_last[MUSE_VC_TURN_ID_MAX];       /* the newest of them */
    bool reply_played;                         /* the current turn's reply played audio */
} muse_vc_reply_gate_t;

/* A new call: forgets every id. */
void muse_vc_reply_gate_init(muse_vc_reply_gate_t *g);
/* A press: every id seen so far is stale, and no item is eligible. */
void muse_vc_reply_gate_press(muse_vc_reply_gate_t *g);
/* What to do with an audio event's PCM. HOLD: keep it until the wait ends:
 * then it plays if muse_vc_reply_gate_playing, else it's dropped. */
muse_vc_gate_verdict_t muse_vc_reply_gate_audio(muse_vc_reply_gate_t *g, const muse_vc_event_t *ev);
/* Speech start, turn start, input suppression, response.created. */
void muse_vc_reply_gate_event(muse_vc_reply_gate_t *g, const muse_vc_event_t *ev);
/* An id is waiting for the current item's confirmation. */
bool muse_vc_reply_gate_waiting(const muse_vc_reply_gate_t *g);
/* Some id's audio plays. */
bool muse_vc_reply_gate_playing(const muse_vc_reply_gate_t *g);
/* The waiting ids' held audio outgrew the caller's buffer: they're dropped, stale. */
void muse_vc_reply_gate_overflow(muse_vc_reply_gate_t *g);
/* Muse answers the last hold: its item is confirmed and not blocked. */
bool muse_vc_reply_gate_captions(const muse_vc_reply_gate_t *g);
/* MUSE_VC_GATE_FLUSH_* bits raised since the last call, cleared. */
uint8_t muse_vc_reply_gate_take_flush(muse_vc_reply_gate_t *g);
/* The current reply's response.created id while it's open (no response.done
 * yet), else NULL: what a press may send response.cancel for. */
const char *muse_vc_reply_gate_open_response(const muse_vc_reply_gate_t *g);
/* The id table is full: the call can't go on safely. */
bool muse_vc_reply_gate_full(const muse_vc_reply_gate_t *g);
/* This response.done or turn_settled completes the turn that opened the
 * current reply (not an older one's). Not PCM finality. */
bool muse_vc_reply_gate_done(const muse_vc_reply_gate_t *g, const muse_vc_event_t *ev);

/* ---- Call lifecycle ---- */

typedef enum {
    MUSE_VC_IDLE,
    MUSE_VC_OPENING,       /* admission sent, no response head yet */
    MUSE_VC_CONNECTING,    /* 2xx head, waiting for hatch.voice.session */
    MUSE_VC_LIVE,
    MUSE_VC_ENDING,        /* end-call and media teardown in flight */
} muse_vc_state_t;

typedef enum {
    MUSE_VC_END_NONE,
    MUSE_VC_END_LOCAL,         /* the gadget hung up */
    MUSE_VC_END_STOP,          /* session_control stop */
    MUSE_VC_END_REMOTE,        /* the media stream ended without us */
    MUSE_VC_END_REJECTED,      /* HTTP error before the call was admitted */
    MUSE_VC_END_FAILED,        /* reset, error event, or a send that failed */
    MUSE_VC_END_NO_ANSWER,     /* no head, or no session, in time */
    MUSE_VC_END_IDLE,          /* nothing said or played for the idle limit */
    MUSE_VC_END_MAX,           /* the call length cap */
    MUSE_VC_END_LOST,          /* the connection dropped: the server ends the call itself */
} muse_vc_end_t;

typedef struct {
    int64_t open_us;           /* admission -> response head */
    int64_t ready_us;          /* head -> hatch.voice.session */
    int64_t idle_us;
    int64_t max_us;
    int64_t end_call_us;       /* end-call -> its response */
    int64_t drain_us;          /* half-close -> media end */
} muse_vc_limits_t;

/* What the I/O side must do next (bits). */
enum {
    MUSE_VC_ACT_END_CALL = 1 << 0,     /* POST /voice/end-call (muse_vc_end_call_body) */
    MUSE_VC_ACT_HALF_CLOSE = 1 << 1,   /* empty body chunk with end_body on the media */
    MUSE_VC_ACT_RESET_MEDIA = 1 << 2,  /* reset the media stream */
    MUSE_VC_ACT_RESET_END_CALL = 1 << 3, /* give up on the end-call stream */
    MUSE_VC_ACT_FLUSH = 1 << 4,        /* drop queued playback */
    MUSE_VC_ACT_READY = 1 << 5,        /* tell the voice task the call is live */
    MUSE_VC_ACT_ENDED = 1 << 6,        /* the call is over (reason in .reason) */
    MUSE_VC_ACT_HOLD = 1 << 7,         /* .held changed */
};

/* Turns Muse is working on, by identity (PSRAM-sized, the caller's storage).
 * hatch.voice.turn_started names a submission and the caller input item it
 * answers; a delayed reply gets its own submission for the same item. A
 * turn_settled names the submission that settled and retires it plus earlier
 * submissions for the same item, never another item's or a later alias. */
typedef struct {
    char submission[MUSE_VC_TURN_ID_MAX];
    char item[MUSE_VC_TURN_ID_MAX];
} muse_vc_turn_t;

typedef struct {
    muse_vc_turn_t active[MUSE_VC_MAX_TURNS];   /* oldest first */
    uint8_t n_active;
    muse_vc_turn_t settled[MUSE_VC_MAX_TURNS];  /* a ring: settled turns, ignored if seen again */
    uint8_t n_settled, settled_next;
} muse_vc_turns_t;

typedef struct {
    muse_vc_state_t state;
    muse_vc_turns_t *turns;
    muse_vc_limits_t limits;
    char call_id[MUSE_VC_CALL_ID_MAX];
    char session_id[MUSE_VC_ID_MAX];
    char thread_id[MUSE_VC_ID_MAX];
    int64_t start_us, head_us, live_us, activity_us, end_us;
    int64_t end_call_at_us, half_closed_at_us;
    int http_status;
    bool media_open;           /* our media request stream exists */
    bool half_closed;
    bool end_call_pending;     /* to send */
    bool end_call_open;        /* sent, no answer yet */
    bool end_call_needed;
    bool held;
    bool speaking;             /* the server heard speech start and no end yet */
    bool awaiting_caller;      /* settled at a boundary with work open; until a new turn */
    char speaking_item[MUSE_VC_TURN_ID_MAX];   /* the item speech started on ("" if unnamed) */
    /* A caller turn for a new item opened and its reply hasn't finished: Muse
     * is about to answer, not off working (hands-free WORKING waits, and one
     * nothing-pending settlement keeps that turn). */
    bool awaiting_reply;
    bool reply_kept;                            /* one settlement kept it already */
    char reply_item[MUSE_VC_TURN_ID_MAX];
    char reply_response[MUSE_VC_TURN_ID_MAX];   /* its reply: the latest response for it */
    char open_response[MUSE_VC_TURN_ID_MAX];    /* the response created and not done */
    bool open_unmarked;                         /* ...without a submission (early media) */
    uint32_t advisory_errors;
    muse_vc_end_t reason;
} muse_vc_call_t;

/* turns: storage for the turn table, kept for the call's lifetime. */
void muse_vc_call_init(muse_vc_call_t *c, const muse_vc_limits_t *limits, muse_vc_turns_t *turns);
/* A new call: the admission record went out with the media request. */
void muse_vc_call_begin(muse_vc_call_t *c, const char *call_id, int64_t now_us);
uint32_t muse_vc_call_head(muse_vc_call_t *c, int status, int64_t now_us);
uint32_t muse_vc_call_event(muse_vc_call_t *c, const muse_vc_event_t *ev, int64_t now_us);
/* A live call where Muse still has work open: a caller turn that hasn't
 * settled. Muse waiting on the caller (a boundary settlement with delegated
 * work open, such as a spoken approval, until the next turn) isn't working. */
bool muse_vc_call_working(const muse_vc_call_t *c);
/* Audible audio played or speech heard: the idle clock restarts. The idle
 * limit doesn't run while the input is held, the caller is mid-speech, or a
 * turn is active; max_us always applies. */
void muse_vc_call_activity(muse_vc_call_t *c, int64_t now_us);
uint32_t muse_vc_call_hang_up(muse_vc_call_t *c, muse_vc_end_t why, int64_t now_us);
/* The media stream ended: ok for a clean end_body, else a reset or HTTP error
 * (http_status, 0 if none). */
uint32_t muse_vc_call_media_end(muse_vc_call_t *c, bool ok, int http_status, int64_t now_us);
/* The end-call request was sent; its answer (or failure) arrived. */
void muse_vc_call_end_call_sent(muse_vc_call_t *c, int64_t now_us);
uint32_t muse_vc_call_end_call_done(muse_vc_call_t *c, int64_t now_us);
/* The connection is gone: nothing left to send, and the server finalizes the call. */
uint32_t muse_vc_call_lost(muse_vc_call_t *c, int64_t now_us);
/* Deadlines, and the next step of an ending call. */
uint32_t muse_vc_call_poll(muse_vc_call_t *c, int64_t now_us);

/* The admission record line (newline-terminated). device_id may be empty. */
bool muse_vc_admission(const char *call_id, const char *device_id, bool greeting, char *out, size_t cap);
/* The capability offer that follows the admission record: the gadget ends the
 * call on a session_control stop (it drains playback, then sends end-call), so
 * Muse may end a call that way when the caller says goodbye, instead of a
 * ui.set.voice.end_call command the gadget has no channel for. A VM that
 * doesn't know the key ignores it, and the call goes on as before. */
#define MUSE_VC_CAPABILITY_OFFER "{\"type\":\"hatch.voice.capability.offer\",\"end_call_stop\":1}\n"
/* The end-call body. ended_wall_ms is the wall clock now; the call started
 * (now_us - start_us) before it, and always ends at least 1 ms after its start. */
bool muse_vc_end_call_body(const muse_vc_call_t *c, int64_t ended_wall_ms, int64_t now_us, char *out, size_t cap);
const char *muse_vc_end_caption(muse_vc_end_t why);

/* ---- Time and ids ---- */

/* "YYYY-MM-DDTHH:MM:SS.mmmZ" (RFC 3339, UTC); out holds 25 bytes. */
void muse_vc_rfc3339(int64_t unix_ms, char out[25]);
/* An HTTP Date header (IMF-fixdate, RFC 9110) as Unix ms, or -1. */
int64_t muse_vc_http_date(const char *s, size_t len);
/* A version 4 UUID from 16 random bytes; out holds 37 bytes. */
void muse_vc_uuid(const uint8_t random[16], char out[37]);

#ifdef __cplusplus
}
#endif
