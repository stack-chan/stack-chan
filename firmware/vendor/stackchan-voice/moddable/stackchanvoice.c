/*
 * Stack-chan voice — Moddable native glue.
 *
 * Binds the clean-room formant synth (aq_synth) and the limited text->koe
 * frontend (CAqK2R) to the JS class in stackchanvoice.js. One instance owns one
 * aq_synth_t plus a persistent koe buffer (the synth holds a pointer INTO it, so
 * it must outlive rendering -- hence host DATA via c_malloc, which is not moved
 * by the GC, rather than a movable host chunk).
 */
#include "xsmc.h"
#include "xsHost.h"

#include "aq_synth.h"
#include "aqk2r.h"

#define SCV_KOE_MAX 2048u   /* max koe (romaji) bytes per utterance */
#define SCV_SOURCE_SAMPLES 256u

typedef struct {
	aq_synth_t synth;
	uint8_t koe[SCV_KOE_MAX];
	const uint8_t *dictionary;
	uint32_t dictionarySize;
	int16_t source[SCV_SOURCE_SAMPLES];
	uint16_t sourceCount;
	uint16_t sourceIndex;
	int16_t resamplePrevious;
	int16_t resampleTriplet[3];
	uint8_t resampleIndex;
} scv_t;

static const uint8_t *g_dictionary;
static uint32_t g_dictionary_size;

size_t aqdic_open(void)
{
	return g_dictionary ? 4u : 0u;
}

size_t aqdic_read(size_t pos, size_t size, void *buf)
{
	if (!g_dictionary || pos < 4u || pos - 4u > g_dictionary_size ||
		size > g_dictionary_size - (pos - 4u))
		return 0u;
	c_memcpy(buf, g_dictionary + pos - 4u, size);
	return size;
}

void aqdic_close(void)
{
	/* Resource storage remains owned by the XS archive. */
}

void xs_scv_destructor(void *data)
{
	if (data)
		c_free(data);
}

static void scv_reset_resampler(scv_t *m)
{
	m->sourceCount = 0u;
	m->sourceIndex = 0u;
	m->resamplePrevious = 0;
	m->resampleIndex = 3u;
}

void xs_scv(xsMachine *the)
{
	scv_t *m = c_malloc(sizeof(scv_t));
	uint8_t voice = 0u;
	void *dictionary = NULL;
	xsUnsignedValue dictionarySize = 0;
	if (!m)
		xsUnknownError("stackchanvoice: no memory");
	if (xsmcArgc > 0)
		voice = (uint8_t)xsmcToInteger(xsArg(0));
	if ((xsmcArgc < 2) || !xsmcTest(xsArg(1)) ||
		(xsmcGetBufferReadable(xsArg(1), &dictionary, &dictionarySize) != 0)) {
		c_free(m);
		xsUnknownError("stackchanvoice: dictionary Resource required");
	}
	xsmcSetHostData(xsThis, m);
	aq_synth_reset(&m->synth, 32u);        /* frame_len is overridden per read() */
	aq_synth_set_voice(&m->synth, voice);
	m->koe[0] = 0u;
	m->dictionary = dictionary;
	m->dictionarySize = dictionarySize;
	scv_reset_resampler(m);
}

void xs_scv_setVoice(xsMachine *the)
{
	scv_t *m = xsmcGetHostData(xsThis);
	aq_synth_set_voice(&m->synth, (uint8_t)xsmcToInteger(xsArg(0)));
}

/* copy a NUL-terminated C string into the instance koe buffer (truncating) */
static void scv_store_koe(scv_t *m, const char *src)
{
	uint16_t i = 0u;
	while (src[i] && i < (SCV_KOE_MAX - 1u)) {
		m->koe[i] = (uint8_t)src[i];
		i++;
	}
	m->koe[i] = 0u;
}

void xs_scv_koe(xsMachine *the)
{
	scv_t *m = xsmcGetHostData(xsThis);
	int speed = (xsmcArgc > 1) ? xsmcToInteger(xsArg(1)) : 100;
	scv_store_koe(m, xsmcToString(xsArg(0)));
	if (aq_synth_set_koe(&m->synth, m->koe, (uint16_t)speed, 256u) != 0)
		xsUnknownError("stackchanvoice: set koe failed");
	scv_reset_resampler(m);
}

void xs_scv_say(xsMachine *the)
{
	scv_t *m = xsmcGetHostData(xsThis);
	int speed = (xsmcArgc > 1) ? xsmcToInteger(xsArg(1)) : 100;
	const char *text = xsmcToString(xsArg(0));
	uint8_t *work = c_malloc(SIZE_AQK2R_MIN_WORK_BUF);   /* ~21 KB, transient */
	uint8_t error;
	if (!work)
		xsUnknownError("stackchanvoice: no memory for text conversion");
	g_dictionary = m->dictionary;
	g_dictionary_size = m->dictionarySize;
	error = CAqK2R_Create(work, SIZE_AQK2R_MIN_WORK_BUF);
	if (error == AQK2R_OK)
		error = CAqK2R_Convert(text, (char *)m->koe, SCV_KOE_MAX);
	CAqK2R_Release();
	c_free(work);
	if (error != AQK2R_OK)
		xsUnknownError("stackchanvoice: text->koe conversion failed (%u)", error);
	if (aq_synth_set_koe(&m->synth, m->koe, (uint16_t)speed, 256u) != 0)
		xsUnknownError("stackchanvoice: set koe failed");
	scv_reset_resampler(m);
}

/*
 * Pull one 8 kHz sample at a time from a persistent native batch. Keeping the
 * unconsumed source samples in the instance makes read24() independent of the
 * caller's buffer length without allocating in the AudioOut callback.
 */
static int scv_next_source(scv_t *m, int16_t *sample)
{
	if (m->sourceIndex >= m->sourceCount) {
		uint16_t got = 0u;
		m->synth.frame_len = SCV_SOURCE_SAMPLES;
		(void)aq_synth_read_frame(&m->synth, m->source, &got);
		m->sourceCount = got;
		m->sourceIndex = 0u;
		if (got == 0u)
			return 0;
	}
	*sample = m->source[m->sourceIndex++];
	return 1;
}

void xs_scv_read24(xsMachine *the)
{
	scv_t *m = xsmcGetHostData(xsThis);
	int byte_len = xsmcGetArrayBufferLength(xsArg(0));
	int16_t *out = xsmcToArrayBuffer(xsArg(0));
	int cap = byte_len / 2;
	int written = 0;

	while (written < cap) {
		if (m->resampleIndex >= 3u) {
			int16_t sample;
			if (!scv_next_source(m, &sample))
				break;
			m->resampleTriplet[0] = m->resamplePrevious;
			m->resampleTriplet[1] = (int16_t)(((int32_t)m->resamplePrevious + (int32_t)sample) / 2);
			m->resampleTriplet[2] = sample;
			m->resamplePrevious = sample;
			m->resampleIndex = 0u;
		}
		out[written++] = m->resampleTriplet[m->resampleIndex++];
	}
	xsmcSetInteger(xsResult, written);
}

void xs_scv_read(xsMachine *the)
{
	scv_t *m = xsmcGetHostData(xsThis);
	int byte_len = xsmcGetArrayBufferLength(xsArg(0));
	int16_t *out = xsmcToArrayBuffer(xsArg(0));
	int cap = byte_len / 2;
	uint16_t got = 0u;
	if (cap <= 0) {
		xsmcSetInteger(xsResult, 0);
		return;
	}
	/* fill the whole caller buffer in one shot: frame_len bounds one read */
	m->synth.frame_len = (cap > 65535) ? 65535u : (uint16_t)cap;
	(void)aq_synth_read_frame(&m->synth, out, &got);
	xsmcSetInteger(xsResult, got);   /* 0 => utterance finished */
}
