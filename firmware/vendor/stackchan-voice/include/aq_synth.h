#ifndef AQ_SYNTH_H
#define AQ_SYNTH_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    AQ_SEG_SILENCE = 0,
    AQ_SEG_VOICED = 1,  /* glottal source through formant/nasal resonators */
    AQ_SEG_NOISE = 2    /* noise source through fricative/plosive filter */
} aq_segment_kind_t;

#define AQ_MAX_RES 3

/* Source-filter (Klatt-lite) synthesizer state. All state is caller-owned and
 * statically bounded; the sample-rate path uses only float mul/add (no libm,
 * no heap). Resonator coefficients come from const tables computed offline. */
typedef struct {
    uint16_t frame_len;
    uint16_t speed;
    uint16_t len_pause;
    uint16_t base_f0;        /* speaker pitch (Hz); voice preset selects it */
    uint8_t accent_range;    /* pitch-excursion scale % (voice liveliness); 100 = default */
    uint8_t dur_scale;       /* per-voice duration scale %; 100 = normal, >100 = slower */
    float breath;            /* aspiration noise mixed into voiced source; 0 = none */
    const void *vowel_tbl;   /* aq_reson_t[5][3] vowel set for this voice (normal/cute) */
    const uint8_t *koe;
    size_t pos;
    uint8_t initialized;
    uint8_t final_pause_started;
    uint8_t eod;
    aq_segment_kind_t seg_kind;
    uint32_t seg_remaining;
    uint32_t seg_total;
    uint32_t seg_pos;

    /* glottal source (F0 contour) */
    uint32_t phase_q16;
    uint32_t step_start_q16;
    uint32_t step_q16;
    int32_t step_delta_q16;
    /* per-glottal-period micro-perturbation (anti-buzzer): small pitch-period
     * jitter + amplitude shimmer, each a slow clamped random walk refreshed once
     * per cycle (never per-sample). factors are held constant across a cycle. */
    uint32_t jrng;     /* DEDICATED PRNG for jitter/shimmer, kept SEPARATE from
                        * s->rng so perturbing the voiced source does not shift the
                        * fricative/burst noise sequence (that scramble, not the
                        * jitter magnitude, is what regresses ASR). */
    float jit_walk;    /* jitter random walk, clamped to +-AQ_JITTER_MAX */
    float jit_factor;  /* current period-scale factor (1 +- jitter); 1.0 = none */
    float shm_walk;    /* shimmer random walk, clamped to +-AQ_SHIMMER_MAX */
    float shm_factor;  /* current source-amplitude factor (1 +- shimmer) */
    uint16_t voiced_count;   /* mora index within the current accent phrase */
    uint8_t accent_passed;   /* 1 after the accent nucleus mark in this phrase */
    uint8_t pending_burst;   /* plosive burst place queued after a closure: 1=lab 2=alv 3=vel */
    uint8_t pending_aspiration; /* voiceless-stop aspiration segment queued after the burst,
                                 * before the vowel (VOT gap for /k/,/t/,/p/); 0=none, 1=queued */
    uint8_t aspgap_ms;       /* scaled-unaware ms length of the queued VOT gap (place-specific:
                              * か行 20ms, た/ぱ行 shorter); read by the pending_aspiration block */
    uint8_t plosive_is_c;    /* queued plosive is /c/ (ち/ちゃ affricate) -> NO VOT gap (it releases
                              * directly into /ɕ/ frication; a gap would split off a spurious /t/) */
    uint8_t affricate_burst; /* T1: queued burst is the /tɕ/ stop of ちゃ/ちゅ/ちょ -> keep it short */
    uint8_t prev_voiceless;  /* previous consonant was voiceless (for /i,u/ devoicing) */
    uint8_t prev_devoiced;   /* previous mora was devoiced (block consecutive devoicing) */
    uint16_t onset_ms_used;  /* scaled-ms of onset consonants since the last vowel/pause,
                              * consumed from the next vowel's mora budget (mora-timed rhythm) */

    /* noise source */
    uint32_t rng;
    float nz1;               /* previous noise sample (spectral-tilt lowpass state) */
    float bhp_x1;            /* burst high-pass: previous input sample */
    float bhp_y1;            /* burst high-pass: previous output sample */

    /* formant / filter bank. Coefficients and gain are interpolated toward
     * per-segment targets while the filter state (y1,y2) runs continuously
     * across boundaries, so formants glide (coarticulation) instead of
     * resetting every phoneme. Always 3 sections; unused ones are pass-through. */
    uint8_t voiced_source;
    float res_a1[AQ_MAX_RES];    /* current (interpolated) coefficients */
    float res_a2[AQ_MAX_RES];
    float res_b0[AQ_MAX_RES];
    float res_ta1[AQ_MAX_RES];   /* per-segment targets */
    float res_ta2[AQ_MAX_RES];
    float res_tb0[AQ_MAX_RES];
    float res_y1[AQ_MAX_RES];    /* filter state (continuous) */
    float res_y2[AQ_MAX_RES];
    float src_prev;      /* radiation differentiator memory */
    float cur_gain;      /* current (interpolated) output scale */
    float target_gain;   /* per-segment output scale target */
    uint8_t use_antireson; /* apply the nasal anti-resonance notch this segment */
    uint8_t soft_attack;   /* ramp noise amplitude up across the segment (/h/,/f/ breath) */
    uint8_t burst_decay;   /* segment is a plosive burst (gates the burst HPF / optional decay env) */
    uint8_t burst_env;     /* voiceless-velar burst: apply the early-peak amplitude decay envelope */
    /* singing (koe '#' note annotations: '#'<A-G>[+/-]<oct>[,<ms>], '#R,<ms>' rest).
     * A note pins the NEXT mora's pitch flat at the note frequency for the note
     * length (output-ms exact: NOT scaled by speed/dur_scale, so tempo follows
     * the score), with a short portamento in and a delayed vibrato. */
    uint8_t note_pending;      /* a parsed note awaits its mora */
    uint32_t note_step_q16;    /* phase step of the pending/current note's F0 */
    uint16_t note_len_ms;      /* pending note length (output ms) */
    uint16_t note_default_ms;  /* last explicit length, used when ",ms" is omitted */
    uint32_t pitch_ramp_total; /* samples of F0 glide toward the segment target
                                * (speech: the whole segment; sung: short portamento,
                                * then the pitch HOLDS flat) */
    uint8_t sing_seg;          /* current voiced segment holds a note (flat F0 + vibrato) */
    uint32_t vib_phase_q16;    /* vibrato LFO phase (sung segments) */
    uint8_t rise_final;    /* mark this mora for question-final intonation (nx=='?') */
    uint8_t rise_tail;     /* apply the question rise only in this segment's tail */
    uint32_t rise_tail_start; /* sample index where the tail rise begins */
    uint32_t rise_step_extra; /* max extra F0 step added by the end of the tail */
    uint8_t filter_primed; /* first segment snaps coefficients (no glide from pass-through) */
    float zero_b1;       /* per-nasal anti-resonance notch coefficient (place cue) */
    float zx1;           /* anti-resonance (zero) state */
    float zx2;
} aq_synth_t;

void aq_synth_reset(aq_synth_t *s, uint16_t frame_len);
void aq_synth_set_voice(aq_synth_t *s, uint8_t voice);  /* 0 = normal, 1 = higher pitch */
int aq_synth_set_koe(aq_synth_t *s, const uint8_t *koe, uint16_t speed, uint16_t len_pause);
int aq_synth_read_frame(aq_synth_t *s, int16_t *dst, uint16_t *samples);

#ifdef __cplusplus
}
#endif

#endif
