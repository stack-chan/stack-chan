#include "aq_synth.h"

/* Source-filter (Klatt-lite) synthesis.
 *
 * Vowels: a polynomial glottal flow pulse at the speaker F0 is differentiated
 * (radiation) and passed through a cascade of three formant resonators whose
 * coefficients come from public Japanese formant values (offline-computed,
 * unity peak-gain so the cascade cannot blow up). Vowel identity lives in the
 * formants, not in the oscillator frequency.
 *
 * Consonants are split by source: fricatives/sibilants use high-band shaped
 * noise, plosives a mid-band noise burst, nasals a low voiced resonance.
 *
 * The sample-rate path is float mul/add only -- no libm, no heap. Durations
 * are unchanged from the calibrated model so this change is timbre-only. */

#define AQ_SAMPLE_RATE 8000u
#define AQ_DEFAULT_FRAME 32u
#define AQ_ENV_RAMP_SAMPLES 24u
#define AQ_VOWEL_MS 95u
#define AQ_CONSONANT_MS 38u
#define AQ_CLOSURE_MS 24u   /* plosive closure (silence) ... */
#define AQ_GEMINATE_HOLD_MS 72u /* sokuon (促音 っ) held closure: ~1 extra mora of
                                 * silence for the FIRST copy of a doubled consonant,
                                 * with NO burst; the second copy renders the single
                                 * release (kk/pp/tt/cc) or frication (ss). */
#define AQ_BURST_MS 14u     /* ... + burst = AQ_CONSONANT_MS, so duration holds */
#define AQ_BURST_VEL_MS 22u /* back-velar burst is longer (slow dorsal release) */
#define AQ_BURST_AFFR_MS 6u /* T1: /tɕ/ affricate stop is a brief release into the /ɕ/ sibilant */
/* Graded pause hierarchy: real speech does not give every break the same gap.
 * accent-phrase break '/' ';' is a light beat, a comma is a breath, and a
 * sentence end '.' '。' '?' '!' is a full stop.
 *
 * The review suggested 40/85/160. Measured ASR (kana-CER A/B) hard-vetoed any
 * SHORT below 120: at 40/65/90/105/110ms the '/'-sentences collapse (また/あした
 * decoded as mush; full-corpus mean +0.02..+0.05) -- Whisper needs the full
 * ~120ms gap to segment this 8kHz synthetic voice. So the hierarchy is graded
 * UPWARD from the legacy 120ms anchor instead: '/' stays the (shortest) 120ms
 * beat, comma and sentence-end get longer. A trailing pause (utterance end,
 * nothing follows) keeps the legacy 120ms -- past the last word it adds no
 * prosody, only dead air (and ASR-chaos surface). */
#define AQ_PAUSE_SHORT_MS  120u  /* accent-phrase break: '/' ';' */
#define AQ_PAUSE_MEDIUM_MS 140u  /* comma: ',' '、' */
#define AQ_PAUSE_LONG_MS   170u  /* sentence end: '.' '。' '?' '!' (mid-utterance) */
#define AQ_PAUSE_TRAIL_MS  120u  /* any break with no text after it */
/* Question-final rise: a natural yes/no rise lifts F0 only over the tail of the
 * final vowel (not across the whole mora), by a modest amount. */
#define AQ_QRISE_PCT      18u    /* +18% F0 by the end of the vowel */
#define AQ_QRISE_TAIL_MS  35u    /* applied only over the last 35ms */
#define AQ_BASE_F0 300u       /* voice 0: AquesTalk F1-like high female voice */
#define AQ_BASE_F0_HIGH 440u  /* voice 1 (cute): F0; paired with up-shifted formants */

/* per-segment output scale mapping the filtered signal to int16 range.
 * Vowel gains are per-vowel because unity-peak formants deliver very
 * different energy from a fixed glottal source (front vowels are weakest);
 * these equalize sustained-vowel RMS to a common target. */
#define AQ_GAIN_NASAL   20000.0f
#define AQ_GAIN_GLIDE   10500.0f
#define AQ_GAIN_FRIC_S  7000.0f
#define AQ_GAIN_FRIC_SH 7500.0f
#define AQ_GAIN_FRIC_H  4600.0f
/* Vowel-colored aspiration (open-glottis /h/ before a vowel) runs through the
 * wide-band ASPIRATION table. Widening B1/B2/B3 lowers the resonant PEAKS but
 * spreads energy; net segment RMS came out ~13% below the old narrow-band
 * rendering, so this gain compensates (measured 4600/0.87) to keep は/ひ/ふ/へ/ほ
 * loudness matched. The AQ_FRIC_H fallback path keeps AQ_GAIN_FRIC_H untouched. */
#define AQ_GAIN_ASP     5300.0f
#define AQ_GAIN_FRIC_F  4600.0f
#define AQ_GAIN_BURST   22000.0f
/* velar (dorsal) bursts were lengthened 14->22ms at unchanged 22000 gain (~57%
 * more burst energy), which the user's ear flagged as noisy/harsh. A lower gain
 * for the velar places energy-compensates the lengthening without touching the
 * pole frequencies (place cue) or the length (the intelligibility win). */
#define AQ_GAIN_BURST_VEL 8000.0f
/* Fix 2: burst-noise high-pass. Raw PRNG bursts are WHITE, so a chunk of energy
 * lands below ~400 Hz as low-frequency "gravel" (the ザリッ grit). It must be
 * drained WITHOUT disturbing the compact 1.5-2.5kHz velar "pinch" that carries
 * place: a first-difference HPF (y=x-a*x[-1]) rises toward Nyquist, boosting the
 * 2.5-4kHz band and BROADENING the pinch -- velars then read as alveolar
 * (measured A/B: kokoro 0.33->0.75). A LOWPASS tilt was likewise rejected. So use
 * a POLE-FORM one-pole HPF that is FLAT above its cutoff: it removes only the
 * sub-formant rumble and leaves the place band untouched.
 * y[n] = a*(y[n-1] + x[n] - x[n-1]); fc ~ (1-a)*fs/(2*pi). RMS-compensated. */
#define AQ_BURST_HP_A 0.80f         /* pole -> fc ~ 250Hz at fs=8000 */
#define AQ_BURST_HP_COMP 1.20f      /* RMS re-normalisation (measured, loudness-matched) */
/* Independent A/B toggles for the two burst fixes (see notes at each site). */

/* Voiceless-velar aspiration gap (か行 VOT). Spectrogram analysis (burst_spectro)
 * shows the real-AquesTalk か行 releases its burst, then holds ~34ms of voiceless
 * ASPIRATION (breath) before the vowel voices; OUR burst runs straight into the
 * vowel (gap ~0), so loud burst noise and voicing onset OVERLAP -- the ザリッ grit.
 * After a voiceless-velar (/k/, NOT /g/) burst we insert a short aspiration
 * segment coloured toward the FOLLOWING vowel (the same wide-band ASPIRATION
 * table /h/ and devoiced vowels use), at a gain well BELOW the burst so the burst
 * can be separated in time from the vowel instead of masking it. This is an ONSET
 * consonant segment: its scaled duration is added to onset_ms_used so the vowel's
 * mora budget ABSORBS it and mora rhythm is unchanged (unlike the pre-budget-model
 * VOT experiment that lengthened the whole mora). Voiced /g/ has no aspiration. */
#define AQ_ASPGAP_MS 20u
/* た行 (/t/) and ぱ行 (/p/) VOT: burst_spectro on the real AquesTalk shows these
 * ALSO release the burst then hold a voiceless breath before voicing (ref gap
 * ~24ms for /t/,/p/ vs ~34ms for /k/), but Japanese /t/,/p/ have a SHORTER VOT
 * than /k/ and their burst is not lengthened (14ms, unlike the 22ms velar), so
 * the gap is shorter. Excludes the /c/ affricate (see plosive_is_c). */
#define AQ_ASPGAP_TP_MS 12u
/* /t/,/p/ bursts at the old 22000 gain measured ~2x too prominent vs the vowel
 * (loudness probe: our burst/vowel ~2.0-2.4 vs ref ~0.4-1.5). Cut toward the
 * reference balance; /t/ (sharp alveolar) a touch more than /p/. Voiced /d/,/b/
 * and the /c/ affricate keep the full AQ_GAIN_BURST. */
#define AQ_GAIN_BURST_ALV 13000.0f  /* た行 */
#define AQ_GAIN_BURST_LAB 14000.0f  /* ぱ行 */
#define AQ_GAIN_ASPGAP 3200.0f

/* order: a, i, u, e, o. DC-unity cascade output is O(0.2-0.7); these equalize
 * sustained-vowel RMS to ~5500. The spread is ~4x (was ~16x with unity-peak),
 * so gain interpolation across a formant transition no longer overshoots. */
static const float AQ_VOWEL_GAIN[5] = {
    14598.0f, 83842.0f, 25941.0f, 26582.0f, 24675.0f
};

/* Intrinsic per-vowel amplitude (a,o open/loud; i,u close/soft) de-uniformizes
 * the mora stream so it reads as speech, not a constant-volume melody. Intrinsic
 * DURATION now lives in the per-vowel mora budget below (AQ_MORA_BUDGET). */
static const float AQ_VOWEL_AMP[5]       = {1.15f, 0.85f, 0.85f, 1.0f, 1.10f};

/* Mora-budget model (VERSION 2): Japanese is mora-timed, so each CV mora should
 * occupy a roughly constant slot regardless of how much time its onset consonant
 * eats. Instead of ADDING a full intrinsic vowel onto the consonant (か=151,
 * ちゃ=173, な=157 vs bare あ=105 -- a lurching rhythm), each mora gets a BUDGET;
 * the onset consonants consume their real (scaled) duration via onset_ms_used and
 * the VOWEL takes the remainder, floored so it never vanishes. Budgets are
 * per-vowel (a longest, i/u shortest -- intrinsic vowel-length variation survives
 * inside the slot) and set slightly ABOVE the old intrinsic table so a bare-vowel
 * mora does not shrink. Long vowels (a repeated vowel = a second full-budget
 * mora), moraic ん, the sokuon held closure, and devoiced vowels keep their own
 * full duration and do NOT draw from this budget (they RESET the accumulator).
 * Phrase-final lengthening applies AFTER the budget. Sized so a light-onset CV
 * mora lands on the same ~130ms slot the heavy-onset morae (ちゃ/つ/きょ) floor
 * at, which is what evens the rhythm, while whole-sentence durations stay within
 * ~+-7% of the old additive model. */
static const uint16_t AQ_MORA_BUDGET[5] = {134u, 118u, 118u, 126u, 130u};   /* a,i,u,e,o */
#define AQ_VOWEL_FLOOR_MS 64u  /* a vowel never shrinks below this inside its budget */

/* A devoiced /i,u/ (Tokyo-dialect: between voiceless C, or after a voiceless C
 * at phrase end) is a WHISPERED vowel -- open glottis, noise-excited -- not a
 * voicing gap. Rendered through the same wide-band ASPIRATION table as /h/ (see
 * ASPTBL): the vowel's frequencies with widened bandwidths read as an open
 * breathy vowel, whereas the vowel's OWN narrow bandwidths excited by noise made
 * a thin whistle-peaked hiss that carried no vowel identity (the user heard ちゅ
 * as bare "ch"). Length +9ms and gain up so the whisper is actually PERCEPTIBLE,
 * but it stays noise-excited (never a glottal source) so it can never read as a
 * voiced "desU" -- a louder noise segment is a clearer whisper, not voicing. */
#define AQ_DEVOICE_MS 64u
#define AQ_GAIN_DEVOICED 4200.0f

/* Singing-note rendering (koe '#' annotations). A note-carrying mora holds its
 * pitch FLAT (the melody replaces the accent contour, declination, and final
 * lengthening) after a short portamento from the previous pitch, and sustained
 * notes get a delayed, eased-in vibrato so a long vowel reads as singing rather
 * than a held test tone. Rate/depth are conservative (~5.5 Hz, +-2% ~= +-0.35
 * semitone). Note LENGTHS are output-ms exact -- not scaled by speed/dur_scale
 * -- so the tempo is what the score says regardless of the voice preset. */
#define AQ_NOTE_GLIDE_MS 30u        /* portamento into each note */
#define AQ_NOTE_VOWEL_FLOOR_MS 30u  /* sung vowel survives even a heavy onset */
#define AQ_NOTE_LEN_DEFAULT_MS 500u /* before any explicit ",ms" is given */
#define AQ_NOTE_LEN_MIN_MS 20u
#define AQ_NOTE_LEN_MAX_MS 8000u
#define AQ_VIB_DELAY_MS 150u        /* vibrato starts this far into the note */
#define AQ_VIB_RAMP_MS 200u         /* depth eases in (no sudden wobble) */
#define AQ_VIB_DEPTH 0.02f          /* +-2% F0 */
#define AQ_VIB_STEP_Q16 45u         /* ~5.5 Hz LFO at fs=8000 (5.5*65536/8000) */

/* Equal-tempered octave 4 (A4 = 440 Hz); other octaves are powers of two
 * (float multiply, no libm). Index = semitones above C. */
static const float AQ_NOTE_HZ_OCT4[12] = {
    261.63f, 277.18f, 293.66f, 311.13f, 329.63f, 349.23f,
    369.99f, 392.00f, 415.30f, 440.00f, 466.16f, 493.88f
};

/* amplitude declination across the accent phrase (~ -2.4 dB over 12 morae) */
static float declination(uint16_t n) {
    uint32_t m = n > 12u ? 12u : n;
    return 1.0f - 0.02f * (float)m;
}

typedef struct {
    float a1;
    float a2;
    float b0;
} aq_reson_t;

/* [vowel a,i,u,e,o][section]{a1,a2,b0}, unity peak-gain at fs=8000 */
/* Japanese adult-female vowel formants (F1/F2/F3), DC-unity cascade. Values
 * coordinate-descent fitted to the AquesTalk reference vowels (eval oracle;
 * initialized from published female formants). Notably /u/ is unrounded [ɯ]
 * with a HIGH F2 (~2230), which the earlier published-value table got wrong. */
static const aq_reson_t AQ_VOWEL_FORMANTS[5][3] = {
    {{1.543830f,-0.931755f,0.387924f},{0.135282f,-0.917233f,1.781951f},{-1.705091f,-0.875012f,3.580103f}},
    {{1.921815f,-0.946506f,0.024691f},{-1.306654f,-0.895874f,3.202528f},{-1.702579f,-0.854636f,3.557215f}},
    {{1.859754f,-0.946506f,0.086752f},{-0.344130f,-0.917233f,2.261363f},{-1.739464f,-0.875012f,3.614476f}},
    {{1.802042f,-0.939101f,0.137060f},{-1.604612f,-0.902938f,3.507550f},{-0.884899f,-0.868167f,2.753066f}},
    {{1.807590f,-0.939101f,0.131512f},{0.952758f,-0.924465f,0.971707f},{-1.698992f,-0.875012f,3.574004f}},
};
/* "Cute" voice: the same vowels with formants shifted UP ~15% (a shorter vocal
 * tract = a small/young speaker) -- the key cute cue, not just higher F0.
 * High formants are soft-capped BELOW Nyquist (~3350 max) with widened
 * bandwidths: a naive x1.15 pushed /i/,/e/ F2/F3 into the 3850 clamp, piling up
 * a sharp near-Nyquist resonance heard as a metallic "キン" ring on い-row.
 * Selected by the voice preset; gains are shared (front vowels stay loud). */
/* Harshness fix round 2 (user ear: still piercing after source tilt alone):
 * the piercing 2-3.3 kHz band is re-amplified by the cute table's own F2/F3
 * resonances (e.g. /a/ F2 at 2196 Hz with a needle-thin 110 Hz bandwidth), so
 * source tilt alone hits diminishing returns. F2/F3 bandwidths are widened
 * 1.8x (F1 untouched -- vowel identity and loudness live there), dropping
 * each peak ~5 dB exactly in the piercing band. Center frequencies unchanged
 * (the cute cue is formant POSITION), DC-unity preserved (b0 = 1 - a1 - a2). */
static const aq_reson_t AQ_VOWEL_FORMANTS_CUTE[5][3] = {
    {{1.424828f,-0.931755f,0.506927f},{-0.284439f,-0.855980f,2.140418f},{-1.318240f,-0.654348f,2.972588f}},
    {{1.914110f,-0.946506f,0.032396f},{-1.157757f,-0.654348f,2.812106f},{-1.308447f,-0.636107f,2.944554f}},
    {{1.832286f,-0.946506f,0.114220f},{-0.793767f,-0.855980f,2.649747f},{-1.335791f,-0.654348f,2.990139f}},
    {{1.758837f,-0.939101f,0.180264f},{-1.262767f,-0.654348f,2.917115f},{-1.029852f,-0.654348f,2.684200f}},
    {{1.766119f,-0.939101f,0.172982f},{0.657334f,-0.868166f,1.210832f},{-1.315268f,-0.654348f,2.969616f}},
};

/* Aspiration (/h/) formants: SAME frequencies as each vowel, but with the
 * glottis OPEN -- Klatt 1980's aspiration approximation. B1 is widened to ~280
 * Hz and B2/B3 to ~1.75x the vowel's. Exciting a vowel's OWN narrow bandwidths
 * with noise makes a whistle-peaked "vowel spoken as noise"; the wide-band
 * version reads as open-glottis breath colored toward the vowel. Precomputed
 * offline (no libm in the C hot path) from AQ_VOWEL_FORMANTS[_CUTE] via the
 * DC-unity resonator formula. Selected per-voice by the active vowel table. */
static const aq_reson_t AQ_ASPIRATION[5][3] = {
    {{1.432833f,-0.802590f,0.369757f},{0.130969f,-0.859685f,1.728716f},{-1.621821f,-0.791634f,3.413455f}},
    {{1.769688f,-0.802590f,0.032902f},{-1.253872f,-0.824959f,3.078831f},{-1.605185f,-0.759656f,3.364842f}},
    {{1.712540f,-0.802590f,0.090050f},{-0.333160f,-0.859685f,2.192845f},{-1.654515f,-0.791634f,3.446149f}},
    {{1.665926f,-0.802590f,0.136664f},{-1.544336f,-0.836376f,3.380712f},{-0.839209f,-0.780829f,2.620037f}},
    {{1.671054f,-0.802590f,0.131535f},{0.925106f,-0.871582f,0.946476f},{-1.616019f,-0.791634f,3.407654f}},
};
/* Cute aspiration follows the round-2/3 harshness fix: with the cute VOWEL
 * F2/F3 widened 1.8x, this table (derived from the old, narrow vowels) was no
 * longer wider than the vowels it whispers -- white noise through its
 * 2.2/3.2 kHz poles made the か VOT gap the loudest >2kHz spike left (82.5%
 * of frame energy). F2/F3 widened 1.8x here too (F1/B1 unchanged, same
 * center frequencies, DC-unity), so /h/, VOT gaps, and devoiced vowels
 * soften in step with the widened vowels. */
static const aq_reson_t AQ_ASPIRATION_CUTE[5][3] = {
    {{1.322386f,-0.802590f,0.480203f},{-0.268326f,-0.761747f,2.030073f},{-1.124405f,-0.476065f,2.600470f}},
    {{1.762593f,-0.802590f,0.039997f},{-0.987520f,-0.476065f,2.463585f},{-1.104282f,-0.453083f,2.557365f}},
    {{1.687246f,-0.802590f,0.115344f},{-0.748801f,-0.761747f,2.510549f},{-1.139376f,-0.476065f,2.615441f}},
    {{1.625984f,-0.802590f,0.176606f},{-1.077089f,-0.476065f,2.553154f},{-0.878422f,-0.476065f,2.354487f}},
    {{1.632716f,-0.802590f,0.169874f},{0.623393f,-0.780827f,1.157434f},{-1.121871f,-0.476065f,2.597936f}},
};

/* Speaker voice presets. Adding a voice is one row here; aq_synth_set_voice
 * copies the row into runtime state and it persists across set_koe. */
typedef struct {
    uint16_t base_f0;                /* speaker pitch (Hz) */
    uint8_t  accent_range;           /* pitch-excursion scale % (liveliness) */
    uint8_t  dur_scale;              /* duration scale % (>100 = slower) */
    float    breath;                 /* aspiration noise mixed into voiced source */
    float    tilt;                   /* voiced-source spectral tilt (0 = off) */
    float    gain_scale;             /* output loudness trim (1.0 = unchanged) */
    const aq_reson_t (*vowels)[3];   /* vowel formant set */
} aq_voice_preset_t;

/* Cute-voice harshness fix (user ear report: 音圧が強くて耳障り). The high F0
 * (440) drives harmonics straight into the up-shifted F2/F3 around 2.5-3.3 kHz
 * -- measured >2 kHz energy was 10.7% of total vs 0.6% for the normal voice,
 * i.e. ~18x more power in the ear's most sensitive band, plus ~1.4% of samples
 * in the soft-clip knee (audible grit). Two per-voice knobs, both 0/1.0 (off)
 * for the normal voice so its output stays byte-identical:
 * - tilt: one-pole lowpass MIX on the voiced excitation
 *   (y = (1-t)*x + t*y1): t=0.30 is ~-5 dB at 3 kHz, ~-0.4 dB at 500 Hz --
 *   a gentle source-tilt (softer phonation), not a formant change.
 * - gain_scale: overall trim so the cute voice sits at/below the normal
 *   voice's RMS instead of above it (also clears the clip knee). */
static const aq_voice_preset_t AQ_VOICES[2] = {
    { AQ_BASE_F0,      100u, 100u, 0.00f, 0.00f, 1.00f, AQ_VOWEL_FORMANTS },       /* 0: normal */
    { AQ_BASE_F0_HIGH, 150u, 122u, 0.05f, 0.35f, 0.80f, AQ_VOWEL_FORMANTS_CUTE },  /* 1: cute */
};
/* /n/ (alveolar) and /m/ (bilabial) are DISTINCT: different F2 locus (m~1000,
 * n~1700) and anti-resonance frequency (m~900, n~1600 Hz). One shared table
 * made な行 sound like ま行. Published phonetics values -- NOT fit to the
 * reference (the eval AquesTalk corrupts every nasal to one sound). */
static const aq_reson_t AQ_NASAL_M[3] = {{1.871278f,-0.910057f,0.038779f},{1.317700f,-0.868167f,0.550467f},{-0.286974f,-0.841316f,2.128290f}};
static const aq_reson_t AQ_NASAL_N[3] = {{1.871278f,-0.910057f,0.038779f},{0.148524f,-0.895874f,1.747350f},{-0.958506f,-0.841316f,2.799822f}};
/* Japanese /w/ = labiovelar approximant [ɰ]: LOW F2 (~800), unlike the oracle
 * /u/ table [ɯ] whose F2 is high (~2230). F1 low (~300), F3 ~2300. Shared
 * (not per-voice); the following vowel glides out of this labial locus. */
static const aq_reson_t AQ_GLIDE_W[3] = {{1.855222f,-0.910057f,0.054835f},{1.525477f,-0.888865f,0.363388f},{-0.428248f,-0.841316f,2.269564f}};
/* T2: palatal ONGLIDE for Cy clusters (きょ/びょ/にゃ ...). A full /i/ glide
 * (VOWTBL[1], F2~2970) makes the F2 track zigzag C-locus -> 2970 -> vowel, a
 * spurious extra /i/ mora. This is a milder palatal target (F2~2400, low F1)
 * that reads as the -y- transition and blends into the following vowel. Gain
 * is matched offline to the old /i/-onglide RMS. Standalone や/ゆ/よ keep the
 * full /i/ onset (they are real vowels, not a glide). */
static const aq_reson_t AQ_ONGLIDE_Y[3] = {{1.877207f,-0.931755f,0.054547f},{-0.580397f,-0.881911f,2.462308f},{-1.191390f,-0.841316f,3.032707f}};
#define AQ_GAIN_ONGLIDE_Y 12158.0f
/* Japanese /r/ = alveolar tap [ɾ]: an alveolar locus (F1 low ~300, F2 ~1800,
 * F3 ~2600) so the following vowel glides from the right place, replacing the
 * old /e/-vowel table (F2 too high). Kept short and voiced. */
static const aq_reson_t AQ_TAP_R[3] = {{1.847951f,-0.902938f,0.054987f},{0.291517f,-0.868167f,1.576650f},{-0.826315f,-0.828204f,2.654519f}};
/* Nasal anti-resonance (zero/notch): a spectral NULL an all-pole cascade can't
 * make. The notch frequency is a place cue, so it is per-nasal (state->zero_b1).
 * y = x + b1*x[-1] + b2*x[-2], zeros at r=0.92. */
#define AQ_NASAL_ZERO_M_B1 (-1.3991f)  /* notch ~900 Hz (bilabial /m/) */
#define AQ_NASAL_ZERO_N_B1 (-0.7040f)  /* notch ~1600 Hz (alveolar /n/) */
#define AQ_NASAL_ZERO_B2 (0.8464f)     /* r*r */
/* Fricative spectra (noise-excited, DC-unity). Split by place/manner so the
 * recognizer gets consonant cues instead of one generic hiss. */
/* Each fricative has 3 REAL resonators (a low anchor near vowel F1 + the
 * frication peaks). Never a pass-through {0,0,1} section: interpolating a pole
 * radius to the origin and back across a CV boundary makes a "mush" frame
 * exactly where the transition cue must be. */
/* F2 is placed at the consonant's place LOCUS (alveolar ~1750, palatal ~2100,
 * labial ~1000) so the following vowel's F2 glides from the right place -- the
 * CV formant transition that carries place of articulation. F3 keeps frication
 * energy. /h/ is vowel-colored at render time (takes the next vowel's formants). */
static const aq_reson_t AQ_FRIC_S[3]  = {{1.425406f,-0.577077f,0.151672f},{0.333462f,-0.730403f,1.396940f},{-1.278378f,-0.624228f,2.902607f}};
static const aq_reson_t AQ_FRIC_SH[3] = {{1.425406f,-0.577077f,0.151672f},{-0.128944f,-0.675232f,1.804176f},{-0.986714f,-0.577077f,2.563792f}};
static const aq_reson_t AQ_FRIC_H[3]  = {{1.548457f,-0.702276f,0.153819f},{1.068029f,-0.493191f,0.425162f},{0.180550f,-0.333018f,1.152469f}};
static const aq_reson_t AQ_FRIC_F[3]  = {{1.425406f,-0.577077f,0.151672f},{1.162095f,-0.675232f,0.513137f},{0.000000f,-0.533488f,1.533488f}};

/* Plosive bursts at place loci (F1 low + F2 locus + F3). The following vowel
 * glides from the locus via the continuous filter, giving the CV transition
 * that carries place of articulation. */
static const aq_reson_t AQ_BURST_LAB[3] = {{1.793305f,-0.888865f,0.095560f},{1.317700f,-0.868167f,0.550467f},{0.000000f,-0.841316f,1.841316f}};
static const aq_reson_t AQ_BURST_ALV[3] = {{1.793305f,-0.888865f,0.095560f},{0.291517f,-0.868167f,1.576650f},{-1.182070f,-0.828204f,3.010274f}};
/* Velar burst is a "pinch": F2 and F3 close together, and the locus is strongly
 * vowel-dependent -- HIGH (~2300) before front vowels /i,e/, mid (~1500) before
 * back /a,o,u/. A single fixed velar burst read as labial (げ->べ, き->ぴ) because
 * before front vowels its F2 was too low. Split front/back. */
static const aq_reson_t AQ_BURST_VEL_FRONT[3] = {{1.772303f,-0.868167f,0.095864f},{-0.435028f,-0.868167f,2.303194f},{-1.027211f,-0.854636f,2.881847f}};
/* BACK keeps the previously-tuned velar (F2~1900, F3~2300) that worked for /a,o,u/;
 * lowering it regressed が (d_ganbare). Only front vowels needed the higher pinch. */
static const aq_reson_t AQ_BURST_VEL_BACK[3]  = {{1.793305f,-0.888865f,0.095560f},{0.145065f,-0.854636f,1.709571f},{-0.431624f,-0.854636f,2.286260f}};

/* per-voice vowel formant set (normal or cute), stored type-erased in state */
#define VOWTBL(s) ((const aq_reson_t (*)[3])(s)->vowel_tbl)
/* matching per-voice aspiration set (wide-band /h/), picked by the active vowel
 * table so /h/ tracks the same speaker as the vowels it colors toward. */
#define ASPTBL(s) ((s)->vowel_tbl == (const void *)AQ_VOWEL_FORMANTS_CUTE \
                   ? AQ_ASPIRATION_CUTE : AQ_ASPIRATION)

static int vowel_index(uint8_t c) {
    switch (c) {
        case 'a': case 'A': return 0;
        case 'i': case 'I': return 1;
        case 'u': case 'U': return 2;
        case 'e': case 'E': return 3;
        case 'o': case 'O': return 4;
        default: return -1;
    }
}

static uint32_t step_from_freq_pct(uint32_t freq, uint32_t pct) {
    return ((freq * pct) << 16) / (AQ_SAMPLE_RATE * 100u);
}

/* Tokyo-dialect pitch accent, as a percentage of the base F0.
 * - phrase-initial mora is low, rising to high by the second mora
 * - stays high until the accent nucleus, then drops (post-accent low)
 * - gentle declination across the phrase
 * voiced_count is the mora index within the accent phrase; accent_passed is
 * set once the accent-nucleus mark (') has been seen in this phrase. */
static uint32_t accent_pitch_pct(uint16_t voiced_count, uint8_t accent_passed, uint8_t range) {
    uint32_t n = voiced_count;
    uint32_t decl;
    int32_t pct;
    if (n > 12u) {
        n = 12u;
    }
    decl = n / 2u;  /* ~0.5% per mora declination */
    if (accent_passed) {
        pct = 86;             /* post-accent low */
    } else if (n == 0u) {
        pct = 90;             /* phrase-initial low */
    } else {
        pct = 103;            /* high plateau */
    }
    pct -= (int32_t)decl;
    /* widen the pitch excursion around 100% for a livelier (cuter) voice */
    if (range != 100u) {
        pct = 100 + (pct - 100) * (int32_t)range / 100;
    }
    if (pct < 70) pct = 70;
    return (uint32_t)pct;
}

static uint32_t scale_ms(const aq_synth_t *s, uint32_t ms) {
    uint32_t sp = s->speed == 0u ? 100u : (uint32_t)s->speed;
    uint32_t dur = s->dur_scale == 0u ? 100u : (uint32_t)s->dur_scale;
    if (sp < 50u) sp = 50u;
    if (sp > 300u) sp = 300u;
    return (ms * dur) / sp;   /* dur_scale>100 lengthens (slower voice) */
}

/* Accumulate an onset consonant's (already scaled) duration onto the running
 * budget the next vowel will draw from. Saturating add so it can never wrap. */
static void add_onset(aq_synth_t *s, uint32_t scaled_ms) {
    uint32_t v = (uint32_t)s->onset_ms_used + scaled_ms;
    s->onset_ms_used = v > 65535u ? 65535u : (uint16_t)v;
}

/* Set the resonator TARGETS (filter state is left running for coarticulation).
 * Always 3 sections: sections beyond n are pass-through (a1=a2=0, b0=1). */
static void set_reson_targets(aq_synth_t *s, const aq_reson_t *tbl, uint8_t n) {
    uint8_t i;
    for (i = 0u; i < AQ_MAX_RES; ++i) {
        if (i < n) {
            s->res_ta1[i] = tbl[i].a1;
            s->res_ta2[i] = tbl[i].a2;
            s->res_tb0[i] = tbl[i].b0;
        } else {
            s->res_ta1[i] = 0.0f;
            s->res_ta2[i] = 0.0f;
            s->res_tb0[i] = 1.0f;
        }
    }
    if (!s->filter_primed) {
        /* Utterance start: SNAP the filter to the first segment's spectrum
         * instead of gliding from the reset pass-through state -- the same
         * "never interpolate through pass-through" rule as everywhere else,
         * which was missing exactly here. Without this the first ~20ms of
         * EVERY utterance is spectral mush and initial consonants misread
         * (また -> ばた). The gain still ramps from 0, so no click. */
        for (i = 0u; i < AQ_MAX_RES; ++i) {
            s->res_a1[i] = s->res_ta1[i];
            s->res_a2[i] = s->res_ta2[i];
            s->res_b0[i] = s->res_tb0[i];
        }
        s->filter_primed = 1u;
    }
}

/* Per-glottal-period micro-perturbation (Task B: anti-buzzer). A perfectly
 * periodic source is what reads as a robotic "buzzer"; real voicing has small
 * cycle-to-cycle variation in period (jitter) and amplitude (shimmer). Both are
 * updated ONCE PER GLOTTAL CYCLE (detected by the phase-accumulator wrap), never
 * per sample -- per-sample randomness reads as roughness/hoarseness, not life.
 * Each is a slow random walk CLAMPED to its range and stepped by ~1/4 of that
 * range per cycle, so it drifts over ~4 periods instead of jumping each cycle.
 * Applied to BOTH voices (the buzzer is a property of the shared glottal source,
 * not a per-speaker timbre): the jitter factor scales the phase increment for
 * the whole cycle (period perturbation), the shimmer factor scales the source
 * amplitude for the whole cycle. Draws from a DEDICATED PRNG (s->jrng), NOT the
 * shared s->rng: consuming the shared rng in voiced segments would shift the
 * fricative/burst noise sequence and scramble the consonants (that shift, not
 * the jitter magnitude, dominates the ASR regression -- measured mean +0.084
 * with kokoro/kirei anchors broken -- because the draw COUNT is identical for
 * any nonzero magnitude). With a separate PRNG the noise path stays byte-
 * identical to baseline and only the voiced source is perturbed. */
#define AQ_JITTER_MAX  0.005f          /* +-0.5% period jitter (user ear pick) */
#define AQ_JITTER_STEP (AQ_JITTER_MAX * 0.25f)  /* ~4-period drift */
#define AQ_SHIMMER_MAX  0.015f         /* +-1.5% amplitude shimmer */
#define AQ_SHIMMER_STEP (AQ_SHIMMER_MAX * 0.25f)

/* rate at which current coefficients/gain approach their targets, per sample:
 * ~0.02 gives a ~25 ms formant glide, the natural CV transition timescale. */
#define AQ_COEF_RATE 0.022f
#define AQ_GAIN_RATE 0.015f  /* <= coef rate so gain never outpaces the formant glide */

static void interp_toward(float *cur, float tgt, float rate) {
    *cur += (tgt - *cur) * rate;
}

/* Soft limiter (libm-free): above the knee, compress smoothly toward full
 * scale so brief transition transients saturate gracefully instead of
 * clicking. Below the knee it is exactly linear. */
static float soft_clip(float y) {
    const float knee = 26000.0f;
    const float m = 32767.0f - knee;
    if (y > knee) {
        float d = y - knee;
        return knee + m * d / (d + m);
    }
    if (y < -knee) {
        float d = -y - knee;
        return -(knee + m * d / (d + m));
    }
    return y;
}

/* polynomial glottal flow pulse (0 -> 1 -> 0), libm-free */
static float glottal_flow(uint32_t phase_q16) {
    float p = (float)(phase_q16 & 0xffffu) * (1.0f / 65536.0f);
    const float Tp = 0.40f;
    const float Tn = 0.16f;
    if (p < Tp) {
        float q = p / Tp;
        return q * q * (3.0f - 2.0f * q);
    }
    if (p < Tp + Tn) {
        float q = (p - Tp) / Tn;
        return 1.0f - q * q * (3.0f - 2.0f * q);
    }
    return 0.0f;
}

static float run_resonators(aq_synth_t *s, float x) {
    uint8_t i;
    for (i = 0u; i < AQ_MAX_RES; ++i) {
        float y = s->res_b0[i] * x + s->res_a1[i] * s->res_y1[i] + s->res_a2[i] * s->res_y2[i];
        s->res_y2[i] = s->res_y1[i];
        s->res_y1[i] = y;
        x = y;
    }
    return x;
}

/* set the current segment's length (>= 1 sample) and reset its play position */
static void set_seg_duration(aq_synth_t *s, uint32_t ms) {
    s->seg_remaining = (AQ_SAMPLE_RATE * ms) / 1000u;
    if (s->seg_remaining == 0u) s->seg_remaining = 1u;
    s->seg_total = s->seg_remaining;
    s->seg_pos = 0u;
}

static void start_voiced(aq_synth_t *s, const aq_reson_t *tbl, uint8_t n, uint32_t ms, float gain,
                         int count_it) {
    uint32_t start_step;
    uint32_t end_step;
    s->seg_kind = AQ_SEG_VOICED;
    s->voiced_source = 1u;
    set_seg_duration(s, ms);
    /* F0 continuity: glide from the carried F0 (end of the previous mora, held
     * across intervening consonants) toward this mora's accent target, instead
     * of snapping -- otherwise the pitch is a sequence of discrete notes and
     * the whole utterance reads as music, not speech. */
    if (s->note_pending) {
        /* sung mora (and its voiced onsets): the melody owns the pitch */
        end_step = s->note_step_q16;
    } else {
        end_step = step_from_freq_pct(s->base_f0,
            accent_pitch_pct(s->voiced_count, s->accent_passed, s->accent_range));
    }
    start_step = (s->step_q16 == 0u) ? end_step : s->step_q16;
    /* speech glides across the whole segment; a sung note glides only through
     * a short portamento then HOLDS flat (synth_one clamps at the ramp end) */
    s->pitch_ramp_total = s->seg_total;
    s->sing_seg = 0u;
    if (s->note_pending) {
        uint32_t glide = (AQ_SAMPLE_RATE * AQ_NOTE_GLIDE_MS) / 1000u;
        if (glide < s->seg_total) s->pitch_ramp_total = glide;
        s->sing_seg = 1u;
        s->vib_phase_q16 = 0u;
    }
    s->rise_tail = 0u;
    if (s->rise_final) {
        /* Question-final rising intonation: keep the mora's normal accent target
         * for most of the vowel, then lift F0 by ~+18% only over the last ~35ms
         * (a second slope applied in synth_one). A tail-only rise reads as a
         * natural yes/no question; the old whole-mora +25% sweep read as a
         * drawn-out sing-song glide. */
        uint32_t tail = (AQ_SAMPLE_RATE * AQ_QRISE_TAIL_MS) / 1000u;
        if (tail >= s->seg_total) tail = s->seg_total - 1u;   /* keep a pre-rise region */
        s->rise_tail_start = s->seg_total - tail;
        s->rise_step_extra = (end_step * AQ_QRISE_PCT) / 100u;
        s->rise_tail = 1u;
        s->rise_final = 0u;
    }
    s->step_start_q16 = start_step;
    s->step_q16 = start_step;
    s->step_delta_q16 = (int32_t)end_step - (int32_t)start_step;
    s->target_gain = gain;
    s->use_antireson = 0u;
    s->soft_attack = 0u;
    set_reson_targets(s, tbl, n);
    if (count_it && s->voiced_count < 65535u) {
        s->voiced_count++;
    }
}

static void start_noise(aq_synth_t *s, const aq_reson_t *tbl, uint8_t n, uint32_t ms, float gain) {
    s->seg_kind = AQ_SEG_NOISE;
    s->voiced_source = 0u;
    set_seg_duration(s, ms);
    s->target_gain = gain;
    s->use_antireson = 0u;
    s->soft_attack = 0u;
    s->burst_decay = 0u;
    s->burst_env = 0u;
    set_reson_targets(s, tbl, n);
}

/* fricative/aspiration noise whose amplitude swells IN across the segment
 * (soft_attack), so /h,f,s,sh,z,j/ breath eases in instead of stabbing on onset. */
static void start_breath_noise(aq_synth_t *s, const aq_reson_t *tbl, uint8_t n, uint32_t ms, float gain) {
    start_noise(s, tbl, n, ms, gain);
    s->soft_attack = 1u;
}

/* plosive closure: silence, with the filter pre-positioned at the burst locus
 * (inaudible while gain is 0) so the burst and following vowel start there. */
static void start_closure(aq_synth_t *s, uint32_t ms, const aq_reson_t *tbl) {
    s->seg_kind = AQ_SEG_SILENCE;
    s->voiced_source = 0u;
    s->target_gain = 0.0f;
    set_seg_duration(s, ms);
    set_reson_targets(s, tbl, 3u);
}

/* place codes for a queued plosive burst */
#define AQ_PLACE_LABIAL      1u
#define AQ_PLACE_ALVEOLAR    2u
#define AQ_PLACE_VELAR       3u  /* velar before back vowels /a,o,u/ */
#define AQ_PLACE_VELAR_FRONT 4u  /* velar before front vowels /i,e/ (high pinch) */

static const aq_reson_t *burst_table(uint8_t place) {
    if (place == AQ_PLACE_LABIAL) return AQ_BURST_LAB;
    if (place == AQ_PLACE_ALVEOLAR) return AQ_BURST_ALV;
    if (place == AQ_PLACE_VELAR_FRONT) return AQ_BURST_VEL_FRONT;
    return AQ_BURST_VEL_BACK;
}

/* next significant koe char (skipping spaces / accent marks), without consuming */
static uint8_t peek_next(const aq_synth_t *s) {
    size_t p = s->pos;
    uint8_t c;
    while ((c = s->koe[p]) != 0u) {
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\'') {
            p++;
            continue;
        }
        return c;
    }
    return 0u;
}

/* vowel index of the next vowel from the current read position, skipping a
 * palatal 'y' glide (きゃ = k+y+a colours toward /a/) and layout chars, without
 * consuming. Returns -1 if no vowel follows directly (some other consonant or
 * end), so the aspiration gap can fall back to plain /h/ frication. */
static int next_vowel_index(const aq_synth_t *s) {
    size_t p = s->pos;
    uint8_t c;
    while ((c = s->koe[p]) != 0u) {
        int vi = vowel_index(c);
        if (vi >= 0) {
            return vi;
        }
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\'' ||
            c == 'y' || c == 'Y') {
            p++;
            continue;
        }
        return -1;
    }
    return -1;
}

/* previous significant koe char before index `from` (skipping spaces / accent
 * marks), without consuming. Used to tell a Cy cluster's -y- (preceded by a
 * consonant) from a standalone や/ゆ/よ (preceded by a vowel, pause, or start). */
static uint8_t prev_sig(const aq_synth_t *s, size_t from) {
    size_t p = from;
    while (p > 0u) {
        uint8_t c = s->koe[p - 1u];
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\'') {
            p--;
            continue;
        }
        return c;
    }
    return 0u;
}

/* A labial consonant (bilabial/labiodental). The Cy palatal onglide is gated to
 * these: after a labial burst (F2 locus ~1000) the old full /i/ glide swept F2
 * 1000->2970->vowel, a wild wobble the milder onglide calms (びょ improves).
 * After a velar-front burst (き: F2 already ~2300) the milder onglide has no F2
 * sweep and reads as an extra steady vowel -- Whisper then loops (こんにちわ
 * exploded), so velar/other clusters keep the full /i/ onset. */
static int is_labial_consonant(uint8_t c) {
    uint8_t lc = (c >= 'A' && c <= 'Z') ? (uint8_t)(c + 32) : c;
    return lc == 'b' || lc == 'p' || lc == 'm' || lc == 'f' || lc == 'v';
}

static int is_consonant_letter(uint8_t c) {
    uint8_t lc = (c >= 'A' && c <= 'Z') ? (uint8_t)(c + 32) : c;
    return lc >= 'a' && lc <= 'z' && vowel_index(lc) < 0;
}

static int is_voiceless_onset(uint8_t c) {
    return c == 'k' || c == 's' || c == 't' || c == 'c' || c == 'h' || c == 'f' || c == 'p';
}

static int is_phrase_end(uint8_t c) {
    return c == 0u || c == '.' || c == '?' || c == '!' || c == ';' || c == '/' || c == ',';
}

/* graded pause length for a break char (used by the punctuation branch);
 * `trailing` = no text follows, so the pause carries no prosody */
static uint32_t pause_ms_for(uint8_t c, int trailing) {
    if (trailing) return AQ_PAUSE_TRAIL_MS;
    if (c == '/' || c == ';') return AQ_PAUSE_SHORT_MS;
    if (c == ',') return AQ_PAUSE_MEDIUM_MS;
    return AQ_PAUSE_LONG_MS;   /* '.', '?', '!' */
}

/* Optional ",<ms>" after a note/rest annotation. Remembers the last explicit
 * length so a run of equal notes can omit it. Consumes the ',' ONLY when digits
 * follow (a bare ',' stays a pause char). Clamped so segments stay bounded. */
static uint32_t parse_note_len(aq_synth_t *s) {
    uint32_t ms = s->note_default_ms;
    if (s->koe[s->pos] == ',') {
        size_t p = s->pos + 1u;
        uint8_t d = s->koe[p];
        if (d >= '0' && d <= '9') {
            uint32_t v = 0u;
            while ((d = s->koe[p]) >= '0' && d <= '9') {
                v = v * 10u + (uint32_t)(d - '0');
                if (v > AQ_NOTE_LEN_MAX_MS) v = AQ_NOTE_LEN_MAX_MS;
                p++;
            }
            s->pos = p;
            ms = v < AQ_NOTE_LEN_MIN_MS ? AQ_NOTE_LEN_MIN_MS : v;
            s->note_default_ms = (uint16_t)ms;
        }
    }
    return ms;
}

static int start_next_segment(aq_synth_t *s) {
    uint8_t c;
    if (s->koe == 0 || s->eod) {
        return 1;
    }

    if (s->pending_burst) {
        uint8_t place = s->pending_burst;
        s->pending_burst = 0u;
        /* Velar (dorsal) bursts are physically longer than alveolar/labial: the
         * back closure releases slowly, giving a sustained "pinch" spectrum. The
         * short shared burst let Whisper mistake こ for と; lengthening only the
         * back-velar burst holds the velar cue long enough to register without
         * touching the (well-tuned) pole frequencies. */
        uint32_t bms = (place == AQ_PLACE_VELAR) ? AQ_BURST_VEL_MS : AQ_BURST_MS;
        if (s->affricate_burst) {
            /* T1: /tɕ/ affricate (ちゃ/ちゅ/ちょ). A full 14ms alveolar burst before
             * the SH frication adds a spurious /t/ percept (おちゃ -> おた...); a real
             * affricate releases the closure DIRECTLY into the sibilant. Keep only a
             * ~6ms release transient so the burst tucks into the /ɕ/ onset. */
            bms = AQ_BURST_AFFR_MS;
            s->affricate_burst = 0u;
        }
        {
            int is_velar = (place == AQ_PLACE_VELAR || place == AQ_PLACE_VELAR_FRONT);
            int is_alveolar = (place == AQ_PLACE_ALVEOLAR);
            int is_labial = (place == AQ_PLACE_LABIAL);
            /* VOT gap recipe, decided per place. Voiceless stops only, and NOT
             * the /c/ affricate. 0 = no gap (voiced stops, /c/). */
            uint8_t gap_ms = 0u;
            float bgain = is_velar ? AQ_GAIN_BURST_VEL : AQ_GAIN_BURST;
            uint32_t bscaled;
            if (s->prev_voiceless && !s->plosive_is_c) {
                if (is_velar) {
                    gap_ms = AQ_ASPGAP_MS;          /* か行: 20ms (unchanged) */
                } else if (is_alveolar) {
                    gap_ms = AQ_ASPGAP_TP_MS;       /* た行: shorter VOT */
                    bgain = AQ_GAIN_BURST_ALV;      /* cut toward ref prominence */
                } else if (is_labial) {
                    gap_ms = AQ_ASPGAP_TP_MS;       /* ぱ行 */
                    bgain = AQ_GAIN_BURST_LAB;
                }
            }
            bscaled = scale_ms(s, bms);
            start_noise(s, burst_table(place), 3u, bscaled, bgain);
            /* mark the segment as a plosive burst (drives the burst HPF) */
            s->burst_decay = 1u;
            s->bhp_x1 = 0.0f;   /* clean HPF state per burst */
            s->bhp_y1 = 0.0f;
            /* V2 velar protection: the burst is an onset -> it consumes mora
             * budget, BUT a VELAR burst counts at HALF weight. The dorsal release
             * is intrinsically long (back-velar 22ms vs 14ms alveolar/labial) and
             * that extra length is a consonant-place cue, not mora content: in v1,
             * counting it in full compounded with the closure to starve the k/g-row
             * vowels (kokoro/ganbare regressed in every config). Halving the velar
             * burst gives those vowels back ~7-11ms -- enough for the burst->vowel
             * place transition to register -- without touching the pinch pole
             * frequencies (place) or the burst length (intelligibility). Alveolar
             * and labial bursts count in full. */
            add_onset(s, is_velar ? (bscaled / 2u) : bscaled);
            /* Voiceless-stop VOT gap (か行/た行/ぱ行): the burst is followed by a
             * short voiceless aspiration segment before the vowel voices. gap_ms
             * was decided per place above (0 = none: voiced stops, /c/ affricate).
             * Rendered by the pending_aspiration block on the next segment fetch.
             * The early-peak decay (1.0->0.65, applied in synth_one) reads as a
             * quick reference-like release instead of a sustained noise plateau;
             * the gap breath carries the burst->vowel transition, so decaying the
             * burst no longer starves the place cue (it did before the gap). */
            if (gap_ms) {
                s->pending_aspiration = 1u;
                s->aspgap_ms = gap_ms;
                s->burst_env = 1u;
            }
            s->plosive_is_c = 0u;
        }
        return 0;
    }

    if (s->pending_aspiration) {
        /* Voiceless-stop VOT gap: breath noise through the following vowel's
         * wide-band ASPIRATION formants (or plain /h/ frication if no vowel
         * follows), at a gain well below the burst. Length is place-specific
         * (aspgap_ms, set at the burst site). No soft_attack -- it follows a
         * burst, not silence. Onset segment: consumes the mora budget. */
        int avi = next_vowel_index(s);
        uint32_t ams = scale_ms(s, s->aspgap_ms);
        s->pending_aspiration = 0u;
        if (avi >= 0) {
            start_noise(s, ASPTBL(s)[avi], 3u, ams, AQ_GAIN_ASPGAP);
        } else {
            start_noise(s, AQ_FRIC_H, 3u, ams, AQ_GAIN_ASPGAP);
        }
        add_onset(s, ams);
        return 0;
    }

    while ((c = s->koe[s->pos]) != 0u) {
        int vi;
        s->pos++;
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
            continue;
        }
        if (c == '\'') {
            /* accent nucleus: pitch falls on the following morae */
            s->accent_passed = 1u;
            continue;
        }
        if (c == '#') {
            /* Singing note annotation: '#'<A-G>['+'|'#' sharp / '-' flat]
             * <octave 0-8>[,<ms>] pins the NEXT mora to that pitch/length;
             * '#R[,<ms>]' is a rest (silence). Unknown forms are skipped. */
            uint8_t nc = s->koe[s->pos];
            uint8_t uc = (nc >= 'a' && nc <= 'z') ? (uint8_t)(nc - 32) : nc;
            if (uc == 'R') {
                uint32_t ms;
                s->pos++;
                ms = parse_note_len(s);
                s->seg_kind = AQ_SEG_SILENCE;
                s->voiced_source = 0u;
                s->target_gain = 0.0f;
                set_seg_duration(s, ms);
                s->note_pending = 0u;
                s->onset_ms_used = 0u;  /* a rest breaks any pending mora budget */
                return 0;
            }
            if (uc >= 'A' && uc <= 'G') {
                /* semitones above C for A..G */
                static const uint8_t SEMI[7] = {9u, 11u, 0u, 2u, 4u, 5u, 7u};
                int semi = (int)SEMI[uc - 'A'];
                int oct = 4;
                float freq;
                s->pos++;
                nc = s->koe[s->pos];
                if (nc == '+' || nc == '#') { semi++; s->pos++; }
                else if (nc == '-') { semi--; s->pos++; }
                nc = s->koe[s->pos];
                if (nc >= '0' && nc <= '8') { oct = (int)(nc - '0'); s->pos++; }
                if (semi < 0) { semi += 12; oct--; }
                if (semi >= 12) { semi -= 12; oct++; }
                freq = AQ_NOTE_HZ_OCT4[semi];
                while (oct > 4) { freq *= 2.0f; oct--; }
                while (oct < 4) { freq *= 0.5f; oct++; }
                /* phase step = f0 * 65536 / 8000 */
                s->note_step_q16 = (uint32_t)(freq * 8.192f + 0.5f);
                s->note_len_ms = (uint16_t)parse_note_len(s);
                s->note_pending = 1u;
            }
            continue;
        }
        vi = vowel_index(c);
        if (vi >= 0) {
            uint8_t nx = peek_next(s);
            if (s->note_pending) {
                /* Sung mora: the note length is this mora's budget (output-ms
                 * exact, deliberately NOT speed/dur_scale-scaled -- tempo is
                 * what the score says); the onset consonants already emitted
                 * ate into it exactly like the speech mora budget. Declination,
                 * final lengthening, and devoicing are bypassed: the melody
                 * owns the prosody. start_voiced reads note_pending for the
                 * pitch, so clear it only after the call. */
                uint32_t used = (uint32_t)s->onset_ms_used;
                uint32_t vms = ((uint32_t)s->note_len_ms > used + AQ_NOTE_VOWEL_FLOOR_MS)
                             ? ((uint32_t)s->note_len_ms - used)
                             : AQ_NOTE_VOWEL_FLOOR_MS;
                float g = AQ_VOWEL_GAIN[vi] * AQ_VOWEL_AMP[vi];
                start_voiced(s, VOWTBL(s)[vi], 3u, vms, g, 1);
                s->note_pending = 0u;
                s->prev_voiceless = 0u;
                s->prev_devoiced = 0u;
                s->onset_ms_used = 0u;
                return 0;
            }
            /* Devoice /i,u/ between voiceless consonants, or after a voiceless
             * consonant at phrase end (です/ます, あshita): render as a short
             * whispered vowel (noise through the vowel's own formants) -- a
             * voicing gap that de-uniformizes the mora stream. */
            if ((vi == 1 || vi == 2) && s->prev_voiceless && !s->prev_devoiced &&
                (is_voiceless_onset(nx) || is_phrase_end(nx))) {
                start_noise(s, ASPTBL(s)[vi], 3u, scale_ms(s, AQ_DEVOICE_MS),
                            AQ_GAIN_DEVOICED);
                if (s->voiced_count < 65535u) s->voiced_count++;  /* still a mora */
                s->prev_devoiced = 1u;
                s->prev_voiceless = 1u;
                s->onset_ms_used = 0u;   /* devoiced vowel is a fixed-length mora: close it */
                return 0;
            }
            {
                /* Mora budget: the vowel gets the mora's budget MINUS the onset
                 * consonants already emitted for this mora (scaled ms), floored so
                 * it can never vanish. This is what makes CV morae even -- a heavy
                 * onset (ちゃ, つ) eats into the vowel instead of adding on top. */
                uint32_t budget = scale_ms(s, AQ_MORA_BUDGET[vi]);
                uint32_t floor_ms = scale_ms(s, AQ_VOWEL_FLOOR_MS);
                uint32_t used = (uint32_t)s->onset_ms_used;
                uint32_t vms = (budget > used + floor_ms) ? (budget - used) : floor_ms;
                float g = AQ_VOWEL_GAIN[vi] * AQ_VOWEL_AMP[vi] * declination(s->voiced_count);
                if (is_phrase_end(nx)) {
                    vms = (vms * 140u) / 100u;   /* phrase-final lengthening (after budget) */
                }
                if (nx == '?') {
                    s->rise_final = 1u;          /* question-final rising intonation */
                }
                start_voiced(s, VOWTBL(s)[vi], 3u, vms, g, 1);
                s->prev_voiceless = 0u;
                s->prev_devoiced = 0u;
                s->onset_ms_used = 0u;   /* mora closed: next onset accumulates fresh */
                return 0;
            }
        }
        if (c == '.' || c == '?' || c == '!' || c == ';' || c == '/' || c == ',') {
            uint32_t ms = scale_ms(s, pause_ms_for(c, peek_next(s) == 0u));
            s->seg_kind = AQ_SEG_SILENCE;
            s->voiced_source = 0u;
            s->target_gain = 0.0f;
            set_seg_duration(s, ms);
            s->voiced_count = 0u;       /* new accent phrase */
            s->accent_passed = 0u;
            s->onset_ms_used = 0u;      /* pause breaks any pending mora budget */
            return 0;
        }
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
            uint32_t ms = scale_ms(s, AQ_CONSONANT_MS);
            uint8_t lc = (c >= 'A' && c <= 'Z') ? (uint8_t)(c + 32) : c;
            uint8_t place;
            switch (lc) {
                case 'n':
                    /* alveolar /n/: onset before a vowel/glide; moraic N (~1 mora)
                     * before a consonant or phrase end -- "てんき" is 3 morae. */
                    if (vowel_index(peek_next(s)) >= 0 || peek_next(s) == 'y') {
                        uint32_t nms = scale_ms(s, 52u);
                        start_voiced(s, AQ_NASAL_N, 3u, nms, AQ_GAIN_NASAL, 0);
                        add_onset(s, nms);   /* /n/ murmur is an onset -> budget */
                    } else if (s->note_pending) {
                        /* sung moraic ん: a note of its own (a hummed beat) */
                        start_voiced(s, AQ_NASAL_N, 3u, s->note_len_ms,
                                     AQ_GAIN_NASAL, 1);
                        s->note_pending = 0u;
                        s->onset_ms_used = 0u;
                    } else {
                        /* moraic ん: a full mora of its own -- untouched by the budget */
                        start_voiced(s, AQ_NASAL_N, 3u, scale_ms(s, AQ_VOWEL_MS),
                                     AQ_GAIN_NASAL, 1);
                        s->onset_ms_used = 0u;
                    }
                    s->use_antireson = 1u;
                    s->zero_b1 = AQ_NASAL_ZERO_N_B1;
                    s->prev_voiceless = 0u;
                    return 0;
                case 'm': {
                    /* bilabial /m/: lower F2 locus + lower anti-resonance */
                    uint32_t nms = scale_ms(s, 52u);
                    start_voiced(s, AQ_NASAL_M, 3u, nms, AQ_GAIN_NASAL, 0);
                    add_onset(s, nms);
                    s->use_antireson = 1u;
                    s->zero_b1 = AQ_NASAL_ZERO_M_B1;
                    s->prev_voiceless = 0u;
                    return 0;
                }
                case 'y':
                    /* palatal glide. In a Cy cluster (きょ/びょ: 'y' right after a
                     * consonant) use the milder palatal ONGLIDE that blends into the
                     * following vowel instead of a full /i/ that adds a spurious mora.
                     * A standalone や/ゆ/よ (preceded by a vowel/pause/start) keeps the
                     * full /i/ onset. Gated to labial clusters (see is_labial_consonant). */
                    if (is_labial_consonant(prev_sig(s, s->pos - 1u))) {
                        start_voiced(s, AQ_ONGLIDE_Y, 3u, ms, AQ_GAIN_ONGLIDE_Y, 0);
                        add_onset(s, ms);
                    } else {
                        /* T3: at phrase onset (voiced_count==0) lengthen the /i/ onglide
                         * and lift its gain so a STANDALONE や/ゆ/よ onset survives
                         * (yukkuri's や). Restricted to standalone (prev is not a
                         * consonant): a phrase-onset velar Cy cluster きょ shares this
                         * branch, and boosting it regressed こんにちわ. */
                        uint32_t yms = ms;
                        float yg = AQ_VOWEL_GAIN[1] * 0.6f;
                        if (s->voiced_count == 0u &&
                            !is_consonant_letter(prev_sig(s, s->pos - 1u))) {
                            yms = scale_ms(s, 55u);
                            yg *= 1.2f;
                        }
                        start_voiced(s, VOWTBL(s)[1], 3u, yms, yg, 0);
                        add_onset(s, yms);
                    }
                    s->prev_voiceless = 0u;
                    return 0;
                case 'w':
                    /* labiovelar glide [ɰ]: low-F2 labial locus, then glides to
                     * the vowel. Uses the dedicated AQ_GLIDE_W, not the /u/ [ɯ]
                     * table (whose high F2 gave わ/を the wrong place cue).
                     * (T3 tried phrase-onset lengthening+gain here; it REGRESSED
                     * わ -- wakuwaku 0.75->0.83 and kawaii 0.43->0.64 -- so /w/ is
                     * left unchanged. Only the /y/ phrase-onset boost was kept.) */
                    start_voiced(s, AQ_GLIDE_W, 3u, ms, AQ_VOWEL_GAIN[2] * 0.7f, 0);
                    add_onset(s, ms);
                    s->prev_voiceless = 0u;
                    return 0;
                case 'r':
                    /* alveolar tap [ɾ]: short voiced segment at the alveolar
                     * locus so the following vowel glides from the right place
                     * (was the /e/ vowel table, whose F2 was too high). */
                    {
                        uint32_t rms = scale_ms(s, 30u);
                        start_voiced(s, AQ_TAP_R, 3u, rms, AQ_GAIN_GLIDE, 0);
                        add_onset(s, rms);
                    }
                    s->prev_voiceless = 0u;
                    return 0;
                case 'p': case 'b':
                case 't': case 'd': case 'c':
                case 'k': case 'g':
                    /* plosive: closure (silence) then a place-specific burst.
                     * (c only occurs in 'ch'; treated as an alveolar stop, with
                     * the following 'h' becoming frication -> affricate.) */
                    if (lc == 'p' || lc == 'b') {
                        place = AQ_PLACE_LABIAL;
                    } else if (lc == 'k' || lc == 'g') {
                        /* velar pinch is vowel-dependent: high before front /i,e/
                         * (incl. palatal 'y' glide of きゃ), mid before back. */
                        uint8_t nv = peek_next(s);
                        place = (nv == 'i' || nv == 'e' || nv == 'y')
                              ? AQ_PLACE_VELAR_FRONT : AQ_PLACE_VELAR;
                    } else {
                        place = AQ_PLACE_ALVEOLAR;
                    }
                    {
                        /* Sokuon (促音 っ) geminate stop: the frontend doubles the
                         * stop letter (っこ->kko, って->tte, っぱ->ppa, っちゃ->ccha).
                         * Render this FIRST copy as an extra-long HELD closure (silence)
                         * with NO burst and return; the second copy then renders its
                         * normal closure+burst. The pair becomes one held closure + a
                         * SINGLE release, replacing the old double closure+burst (two
                         * audible stop releases). */
                        uint8_t nx = s->koe[s->pos];
                        uint8_t nlc = (nx >= 'A' && nx <= 'Z') ? (uint8_t)(nx + 32) : nx;
                        if (nlc == lc) {
                            /* sokuon held closure IS the extra mora: it replaces the
                             * first consonant copy and must NOT draw from the next
                             * mora's budget. The SECOND copy's closure+burst below
                             * counts normally, so reset the accumulator here. */
                            start_closure(s, scale_ms(s, AQ_GEMINATE_HOLD_MS),
                                          burst_table(place));
                            s->onset_ms_used = 0u;
                            s->prev_voiceless =
                                (lc == 'p' || lc == 't' || lc == 'k' || lc == 'c');
                            return 0;
                        }
                    }
                    if (lc == 'c') {
                        /* T1: detect the /tɕ/ yoon ちゃ/ちゅ/ちょ = c + h + non-'i' vowel
                         * (the same case the 'h' branch renders as SH frication). Flag
                         * the queued burst to be short so the closure releases into the
                         * sibilant. Plain ち (c+h+i) and た/て/と are left untouched. */
                        uint8_t hc = s->koe[s->pos];
                        if ((hc == 'h' || hc == 'H')) {
                            int avi = vowel_index(s->koe[s->pos + 1u]);
                            if (avi >= 0 && avi != 1) {
                                s->affricate_burst = 1u;
                            }
                        }
                    }
                    {
                        /* The closure is SILENCE: the perceived mora beat runs
                         * vowel-onset to vowel-onset and a silent gap reads half as
                         * pause, half as mora content. Counting it in FULL starved
                         * the k/t-row vowels, so it counts HALF; the audible burst
                         * counts by its own (velar-halved) rule at the burst site. */
                        uint32_t cms = scale_ms(s, AQ_CLOSURE_MS);
                        start_closure(s, cms, burst_table(place));
                        add_onset(s, cms / 2u);
                    }
                    s->pending_burst = place;
                    /* /c/ (ち/ちゃ) is an alveolar voiceless stop but an affricate:
                     * it releases into /ɕ/ frication, so it must NOT get a VOT gap
                     * (that would split off a spurious /t/). Mark it here; the flag
                     * persists to the burst site and is cleared there. */
                    s->plosive_is_c = (uint8_t)(lc == 'c');
                    s->prev_voiceless = (lc == 'p' || lc == 't' || lc == 'k' || lc == 'c');
                    return 0;
                case 's':
                    if (s->koe[s->pos] == 's' || s->koe[s->pos] == 'S') {
                        /* Sokuon geminate fricative (っさ->ssa, っし->sshi,
                         * っしょ->ssho, ざっし->zasshi): render the FIRST 's' as a held
                         * silence, and let the second 's' render the actual frication
                         * (incl. the /sh/ of っしょ). One held closure + one fricative,
                         * instead of two fricatives. */
                        /* sokuon geminate fricative: held closure is the extra mora */
                        start_closure(s, scale_ms(s, AQ_GEMINATE_HOLD_MS), AQ_FRIC_S);
                        s->onset_ms_used = 0u;
                        s->prev_voiceless = 1u;
                        return 0;
                    }
                    if (s->koe[s->pos] == 'h' || s->koe[s->pos] == 'H') {
                        s->pos++;  /* s + h -> /sh/ */
                        start_breath_noise(s, AQ_FRIC_SH, 3u, ms, AQ_GAIN_FRIC_SH);
                    } else {
                        start_breath_noise(s, AQ_FRIC_S, 3u, ms, AQ_GAIN_FRIC_S);
                    }
                    add_onset(s, ms);
                    s->prev_voiceless = 1u;
                    return 0;
                case 'z':
                    start_breath_noise(s, AQ_FRIC_S, 3u, ms, AQ_GAIN_FRIC_S);   /* voiced /z/ ~ /s/ */
                    add_onset(s, ms);
                    s->prev_voiceless = 0u;
                    return 0;
                case 'j':
                    start_breath_noise(s, AQ_FRIC_SH, 3u, ms, AQ_GAIN_FRIC_SH); /* /j/ ~ voiced /sh/ */
                    add_onset(s, ms);
                    s->prev_voiceless = 0u;
                    return 0;
                case 'h': {
                    /* The 'h' of "ch" is the sibilant release of the /tɕ/
                     * affricate: after the alveolar 'c' burst, render palatal
                     * /ɕ/ frication (like し/しゃ), NOT the next vowel's
                     * aspiration. Without this ちゃ = t-burst + breathy-a ("たは")
                     * with no sibilant at all. Restricted to the yoon ちゃ/ちゅ/ちょ
                     * (non-'i' vowel); plain ち keeps its /i/-colored aspiration,
                     * which already decodes well (SH there regresses こんにち...). */
                    if (s->pos >= 2u &&
                        (s->koe[s->pos - 2u] == 'c' || s->koe[s->pos - 2u] == 'C') &&
                        peek_next(s) != 'i') {
                        start_breath_noise(s, AQ_FRIC_SH, 3u, ms, AQ_GAIN_FRIC_SH);
                        add_onset(s, ms);
                        s->prev_voiceless = 1u;
                        return 0;
                    }
                    /* /h/ is the whispered onset of the following vowel: shape
                     * the aspiration with that vowel's FREQUENCIES but OPEN-GLOTTIS
                     * (wide-band) formants (は/ひ/ふ differ). Using the vowel's own
                     * narrow bandwidths made a whistle-peaked "vowel-as-noise";
                     * ASPTBL widens B1->~280, B2/B3->~1.75x per Klatt 1980. */
                    int hv = vowel_index(peek_next(s));
                    if (hv >= 0) {
                        start_breath_noise(s, ASPTBL(s)[hv], 3u, ms, AQ_GAIN_ASP);
                    } else {
                        start_breath_noise(s, AQ_FRIC_H, 3u, ms, AQ_GAIN_FRIC_H);
                    }
                    add_onset(s, ms);
                    s->prev_voiceless = 1u;
                    return 0;
                }
                case 'f':
                    start_breath_noise(s, AQ_FRIC_F, 3u, ms, AQ_GAIN_FRIC_F);
                    add_onset(s, ms);
                    s->prev_voiceless = 1u;
                    return 0;
                default:
                    start_breath_noise(s, AQ_FRIC_H, 3u, ms, AQ_GAIN_FRIC_H);
                    add_onset(s, ms);
                    s->prev_voiceless = 0u;
                    return 0;
            }
        }
    }

    if (!s->final_pause_started) {
        uint32_t ms = s->len_pause == 256u ? 20u : 120u;
        s->final_pause_started = 1u;
        s->seg_kind = AQ_SEG_SILENCE;
        s->voiced_source = 0u;
        s->target_gain = 0.0f;
        set_seg_duration(s, ms);
        return 0;
    }

    s->eod = 1u;
    return 1;
}

static int16_t synth_one(aq_synth_t *s) {
    float x;
    float y;
    uint8_t i;
    if (s->seg_remaining == 0u) {
        if (start_next_segment(s) != 0) {
            return 0;
        }
    }

    /* glide current filter coefficients and gain toward the segment targets;
     * the filter state itself is never reset, giving formant transitions. */
    for (i = 0u; i < AQ_MAX_RES; ++i) {
        interp_toward(&s->res_a1[i], s->res_ta1[i], AQ_COEF_RATE);
        interp_toward(&s->res_a2[i], s->res_ta2[i], AQ_COEF_RATE);
        interp_toward(&s->res_b0[i], s->res_tb0[i], AQ_COEF_RATE);
    }
    interp_toward(&s->cur_gain, s->target_gain, AQ_GAIN_RATE);

    if (s->voiced_source) {
        float flow;
        if (s->seg_total != 0u) {
            /* F0 glides over pitch_ramp_total samples, then holds. Speech sets
             * the ramp to the whole segment (the clamp never engages -- byte-
             * identical to the old whole-segment glide); a sung note sets a
             * short portamento so the pitch then sits flat on the note. */
            uint32_t ramp = s->pitch_ramp_total != 0u ? s->pitch_ramp_total : s->seg_total;
            uint32_t pp = s->seg_pos < ramp ? s->seg_pos : ramp;
            s->step_q16 = (uint32_t)((int32_t)s->step_start_q16 +
                (s->step_delta_q16 * (int32_t)pp) / (int32_t)ramp);
            if (s->rise_tail && s->seg_pos >= s->rise_tail_start) {
                /* question-final tail rise: add a second slope over the last ~35ms */
                uint32_t span = s->seg_total - s->rise_tail_start;
                if (span != 0u) {
                    s->step_q16 += (s->rise_step_extra * (s->seg_pos - s->rise_tail_start)) / span;
                }
            }
        }
        /* Advance the phase by the JITTERED increment. jit_factor is held
         * constant for the whole cycle, so scaling the per-sample step scales
         * the cycle LENGTH -- genuine per-period jitter, not per-sample noise.
         * On each cycle wrap (high 16 bits of the phase change) refresh the two
         * clamped random walks and recompute the factors for the next period. */
        {
            uint32_t prev_phase = s->phase_q16;
            float eff = (float)s->step_q16 * s->jit_factor;
            if (s->sing_seg && s->seg_pos >= (AQ_SAMPLE_RATE * AQ_VIB_DELAY_MS) / 1000u) {
                /* Sung-note vibrato: a slow LFO on the phase step, starting
                 * only after the note has settled and easing its depth in so
                 * short notes stay straight and long ones bloom. Parabolic
                 * sine approximation (libm-free). */
                uint32_t el = s->seg_pos - (AQ_SAMPLE_RATE * AQ_VIB_DELAY_MS) / 1000u;
                uint32_t rampv = (AQ_SAMPLE_RATE * AQ_VIB_RAMP_MS) / 1000u;
                float p, xx, v, depth;
                s->vib_phase_q16 += AQ_VIB_STEP_Q16;
                p = (float)(s->vib_phase_q16 & 0xffffu) * (1.0f / 65536.0f);
                xx = (p < 0.5f) ? (2.0f * p) : (2.0f * (p - 0.5f));
                v = 4.0f * xx * (1.0f - xx);
                if (p >= 0.5f) v = -v;
                depth = AQ_VIB_DEPTH;
                if (el < rampv) depth *= (float)el / (float)rampv;
                eff *= 1.0f + depth * v;
            }
            s->phase_q16 = prev_phase + (uint32_t)(eff + 0.5f);
            if (((s->phase_q16 ^ prev_phase) & 0xffff0000u) != 0u) {
                float rj, rs;
                s->jrng = s->jrng * 1664525u + 1013904223u;
                rj = (float)((int32_t)((s->jrng >> 9) & 0x7fffffu) - 0x400000) * (1.0f / 4194304.0f);
                s->jrng = s->jrng * 1664525u + 1013904223u;
                rs = (float)((int32_t)((s->jrng >> 9) & 0x7fffffu) - 0x400000) * (1.0f / 4194304.0f);
                s->jit_walk += AQ_JITTER_STEP * rj;
                if (s->jit_walk > AQ_JITTER_MAX) s->jit_walk = AQ_JITTER_MAX;
                if (s->jit_walk < -AQ_JITTER_MAX) s->jit_walk = -AQ_JITTER_MAX;
                s->shm_walk += AQ_SHIMMER_STEP * rs;
                if (s->shm_walk > AQ_SHIMMER_MAX) s->shm_walk = AQ_SHIMMER_MAX;
                if (s->shm_walk < -AQ_SHIMMER_MAX) s->shm_walk = -AQ_SHIMMER_MAX;
                s->jit_factor = 1.0f + s->jit_walk;
                s->shm_factor = 1.0f + s->shm_walk;
            }
        }
        flow = glottal_flow(s->phase_q16);
        x = flow - s->src_prev;   /* radiation: glottal flow derivative */
        s->src_prev = flow;
        if (s->breath > 0.0f) {
            /* aspiration: turbulent noise mixed into the glottal source and
             * shaped by the same formants -- a soft, breathy (younger) timbre.
             * breath==0 skips this entirely, so the normal voice is unchanged. */
            float nz;
            s->rng = s->rng * 1664525u + 1013904223u;
            nz = (float)((int32_t)((s->rng >> 9) & 0x7fffffu) - 0x400000) * (1.0f / 4194304.0f);
            nz = 0.7f * (nz + s->nz1);   /* same -6dB/oct tilt: breath, not hiss */
            s->nz1 = nz;
            x += s->breath * nz;
        }
        if (s->tilt > 0.0f) {
            /* per-voice source tilt: one-pole lowpass mix softens the phonation
             * (see AQ_VOICES note). Off (0.0) for the normal voice -> this
             * branch is skipped and the output stays byte-identical. */
            float t = (1.0f - s->tilt) * x + s->tilt * s->tilt_y1;
            s->tilt_y1 = t;
            x = t;
        }
        if (s->use_antireson) {   /* nasal anti-resonance (spectral null) */
            float z = x + s->zero_b1 * s->zx1 + AQ_NASAL_ZERO_B2 * s->zx2;
            s->zx2 = s->zx1;
            s->zx1 = x;
            x = z;
        }
        x *= s->shm_factor;   /* per-period amplitude shimmer (held across cycle) */
    } else if (s->seg_kind == AQ_SEG_NOISE) {
        s->rng = s->rng * 1664525u + 1013904223u;
        x = (float)((int32_t)((s->rng >> 9) & 0x7fffffu) - 0x400000) * (1.0f / 4194304.0f);
        if (s->soft_attack) {
            /* Breath-class noise (/s,sh,z,j,h,f/): real turbulence falls off
             * ~-6 dB/oct, but a raw PRNG is WHITE -- half its energy lands in
             * 2-4 kHz where the ear is most sensitive, which is the piercing
             * "刺さる" quality no gain cut can fix. 2-tap average = zero at
             * Nyquist (Klatt-style source tilt). 0.7*(sum) keeps RMS ~unity. */
            float sm = 0.7f * (x + s->nz1);
            s->nz1 = x;
            x = sm;
        } else if (s->burst_decay) {
            /* Plosive burst: one-pole high-pass (flat above cutoff) drains the
             * sub-400Hz rumble ("ザリッ" gravel) without boosting highs or
             * broadening the velar pinch. NOTE: a decaying amplitude envelope
             * was tested and REJECTED (starves the burst->vowel place
             * transition; kokoro 0.33->0.75, mata 0.00->0.82). */
            float y0 = AQ_BURST_HP_A * (s->bhp_y1 + x - s->bhp_x1);
            s->bhp_x1 = x;
            s->bhp_y1 = y0;
            x = y0 * AQ_BURST_HP_COMP;
        }
        if (s->tilt > 0.0f) {
            /* Cute-voice round 3 (user ear: か still pierces): the k-burst and
             * especially its VOT aspiration gap are NOISE segments, so they
             * bypassed the voiced-source tilt -- measured, the gap frame hit
             * 82.5% >2kHz energy (white noise through the cute aspiration
             * table's 2.2/3.2 kHz poles) while the widened vowels now sit at
             * ~5%. Apply the same per-voice tilt to the noise excitation so
             * consonant noise softens with the vowels around it. Normal
             * voice: tilt 0, branch skipped, byte-identical. */
            float t = (1.0f - s->tilt) * x + s->tilt * s->tilt_y1;
            s->tilt_y1 = t;
            x = t;
        }
    } else {
        x = 0.0f;   /* silence: filter rings down while gain fades to 0 */
    }

    {
        /* per-voice loudness trim BEFORE the soft clip, so trimming also pulls
         * peaks out of the knee (multiply by 1.0f is exact: voice 0 unchanged) */
        float g = s->cur_gain * s->gain_scale;
        if (s->soft_attack && s->seg_total != 0u) {
            /* gradual breath onset: ramp the noise amplitude 0.30 -> 1.0 across
             * the segment so /h/,/f/ swell in instead of bursting. A hard noise
             * attack over a short frame reads as exhaling too forcefully. */
            float t = (float)s->seg_pos / (float)s->seg_total;
            g *= 0.30f + 0.70f * t;
        } else if (s->burst_env && s->seg_total != 0u) {
            /* voiceless-velar burst: early-peak decay (1.0 -> 0.4 linear across
             * the segment) so the burst reads as a quick reference-like release
             * instead of a sustained noise plateau. The following aspiration gap
             * carries the transition, so decaying the burst no longer starves
             * the place cue (which is why this shape failed before the gap).
             * The steeper 1.0->0.4 decay regressed the precious kokoro anchor
             * (0.08->0.33): the burst's later half still carries part of the
             * velar->vowel F2 transition. 1.0->0.65 quiets the sustained tail
             * (the ザリッ plateau) while leaving that place cue intact. */
            float t = (float)s->seg_pos / (float)s->seg_total;
            g *= 1.0f - 0.35f * t;
        }
        y = soft_clip(run_resonators(s, x) * g);
    }
    s->seg_remaining--;
    s->seg_pos++;

    if (y > 32767.0f) y = 32767.0f;
    if (y < -32768.0f) y = -32768.0f;
    return (int16_t)(y >= 0.0f ? y + 0.5f : y - 0.5f);
}

static void reset_runtime(aq_synth_t *s) {
    uint8_t i;
    s->pos = 0u;
    s->final_pause_started = 0u;
    s->eod = 0u;
    s->seg_kind = AQ_SEG_SILENCE;
    s->seg_remaining = 0u;
    s->seg_total = 0u;
    s->seg_pos = 0u;
    s->phase_q16 = 0u;
    s->step_start_q16 = 0u;
    s->step_q16 = 0u;
    s->step_delta_q16 = 0;
    s->jrng = 0x9e3779b9u;   /* dedicated jitter/shimmer PRNG seed (deterministic) */
    s->jit_walk = 0.0f;
    s->jit_factor = 1.0f;
    s->shm_walk = 0.0f;
    s->shm_factor = 1.0f;
    s->rng = 1u;
    s->nz1 = 0.0f;
    s->tilt_y1 = 0.0f;
    s->bhp_x1 = 0.0f;
    s->bhp_y1 = 0.0f;
    s->filter_primed = 0u;
    s->voiced_count = 0u;
    s->accent_passed = 0u;
    s->pending_burst = 0u;
    s->pending_aspiration = 0u;
    s->aspgap_ms = 0u;
    s->plosive_is_c = 0u;
    s->affricate_burst = 0u;
    s->prev_voiceless = 0u;
    s->prev_devoiced = 0u;
    s->onset_ms_used = 0u;
    s->note_pending = 0u;
    s->note_step_q16 = 0u;
    s->note_len_ms = AQ_NOTE_LEN_DEFAULT_MS;
    s->note_default_ms = AQ_NOTE_LEN_DEFAULT_MS;
    s->pitch_ramp_total = 0u;
    s->sing_seg = 0u;
    s->vib_phase_q16 = 0u;
    s->rise_final = 0u;
    s->rise_tail = 0u;
    s->rise_tail_start = 0u;
    s->rise_step_extra = 0u;
    s->voiced_source = 0u;
    s->src_prev = 0.0f;
    s->cur_gain = 0.0f;
    s->target_gain = 0.0f;
    s->use_antireson = 0u;
    s->soft_attack = 0u;
    s->burst_decay = 0u;
    s->burst_env = 0u;
    s->zero_b1 = 0.0f;
    s->zx1 = 0.0f;
    s->zx2 = 0.0f;
    for (i = 0u; i < AQ_MAX_RES; ++i) {
        s->res_a1[i] = 0.0f;   /* current + target = pass-through */
        s->res_a2[i] = 0.0f;
        s->res_b0[i] = 1.0f;
        s->res_ta1[i] = 0.0f;
        s->res_ta2[i] = 0.0f;
        s->res_tb0[i] = 1.0f;
        s->res_y1[i] = 0.0f;
        s->res_y2[i] = 0.0f;
    }
}

void aq_synth_reset(aq_synth_t *s, uint16_t frame_len) {
    if (s == 0) {
        return;
    }
    s->frame_len = frame_len == 0u ? AQ_DEFAULT_FRAME : frame_len;
    s->speed = 100u;
    s->len_pause = 256u;
    aq_synth_set_voice(s, 0u);   /* default voice; set_koe preserves it */
    s->koe = 0;
    s->initialized = 1u;
    reset_runtime(s);
}

/* Select a speaker voice preset. Persists across set_koe (which only resets
 * runtime state), so call it any time after reset/Init. */
void aq_synth_set_voice(aq_synth_t *s, uint8_t voice) {
    const aq_voice_preset_t *v;
    if (s == 0) {
        return;
    }
    /* voice 1 (cute) = higher F0 + up-shifted formants (small speaker) + livelier
     * pitch + slower delivery. The formant shift is the key cue, not F0 alone. */
    v = &AQ_VOICES[voice ? 1u : 0u];
    s->base_f0 = v->base_f0;
    s->accent_range = v->accent_range;
    s->dur_scale = v->dur_scale;
    s->breath = v->breath;
    s->tilt = v->tilt;
    s->tilt_y1 = 0.0f;
    s->gain_scale = v->gain_scale;
    s->vowel_tbl = (const void *)v->vowels;
}

int aq_synth_set_koe(aq_synth_t *s, const uint8_t *koe, uint16_t speed, uint16_t len_pause) {
    if (s == 0 || koe == 0 || !s->initialized) {
        return -1;
    }
    s->koe = koe;
    s->speed = speed == 0u ? 100u : speed;
    s->len_pause = len_pause;
    reset_runtime(s);
    return 0;
}

int aq_synth_read_frame(aq_synth_t *s, int16_t *dst, uint16_t *samples) {
    uint16_t i;
    if (s == 0 || dst == 0 || samples == 0 || !s->initialized) {
        return -1;
    }
    if (s->eod) {
        *samples = 0u;
        return 1;
    }
    for (i = 0u; i < s->frame_len; ++i) {
        if (s->eod) {
            break;
        }
        dst[i] = synth_one(s);
    }
    *samples = i;
    if (i == 0u && s->eod) {
        return 1;
    }
    return 0;
}
