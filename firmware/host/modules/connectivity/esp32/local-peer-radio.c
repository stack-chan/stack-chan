#include "xs.h"
#include "xsmc.h"
#include "xsHost.h"
#include "mc.xs.h"

#include "esp_err.h"
#include "esp_idf_version.h"
#include "esp_mac.h"
#include "esp_now.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "mbedtls/md.h"

#define LOCAL_PEER_ID_BYTES 6
#define LOCAL_PEER_ID_CHARS 12
#define LOCAL_PEER_KEY_BYTES 16
#define LOCAL_PEER_AUTH_KEY_BYTES 32
#define LOCAL_PEER_AUTH_TAG_BYTES 16
#define LOCAL_PEER_MAX_FRAME_BYTES 250
#define LOCAL_PEER_MAX_AUTHENTICATED_FRAME_BYTES (LOCAL_PEER_MAX_FRAME_BYTES - LOCAL_PEER_AUTH_TAG_BYTES)
#define LOCAL_PEER_MAX_SHARED_KEY_BYTES 64
#define LOCAL_PEER_RECEIVE_HEADER_BYTES 9

typedef struct {
	xsMachine *the;
	xsSlot object;
	uint8_t id[LOCAL_PEER_ID_BYTES];
	uint8_t key[LOCAL_PEER_KEY_BYTES];
	uint8_t authKey[LOCAL_PEER_AUTH_KEY_BYTES];
	uint8_t hasKey;
	uint8_t closed;
	uint16_t useCount;
} LocalPeerRadioRecord, *LocalPeerRadio;

static LocalPeerRadio gLocalPeerRadio;
static portMUX_TYPE gLocalPeerRadioMux = portMUX_INITIALIZER_UNLOCKED;
static const uint8_t gBroadcastAddress[LOCAL_PEER_ID_BYTES] = {0xff, 0xff, 0xff, 0xff, 0xff, 0xff};
static const uint8_t gEncryptionKeyDomain[] = "stackchan-local-peer-v1:";
static const uint8_t gAuthenticationKeyDomain[] = "stackchan-local-peer-auth-v1:";

static void localPeerRelease(LocalPeerRadio radio)
{
	if (0 == __atomic_sub_fetch(&radio->useCount, 1, __ATOMIC_SEQ_CST))
		c_free(radio);
}

static LocalPeerRadio localPeerAcquire(void)
{
	LocalPeerRadio radio;
	portENTER_CRITICAL(&gLocalPeerRadioMux);
	radio = gLocalPeerRadio;
	if (radio && !radio->closed)
		__atomic_add_fetch(&radio->useCount, 1, __ATOMIC_SEQ_CST);
	else
		radio = NULL;
	portEXIT_CRITICAL(&gLocalPeerRadioMux);
	return radio;
}

static uint8_t localPeerHexNibble(char value)
{
	if ((value >= '0') && (value <= '9')) return (uint8_t)(value - '0');
	if ((value >= 'a') && (value <= 'f')) return (uint8_t)(value - 'a' + 10);
	if ((value >= 'A') && (value <= 'F')) return (uint8_t)(value - 'A' + 10);
	return 0xff;
}

static uint8_t localPeerParseID(xsMachine *the, xsSlot slot, uint8_t *address)
{
	char id[LOCAL_PEER_ID_CHARS + 1];
	xsmcToStringBuffer(slot, id, sizeof(id));
	if (c_strlen(id) != LOCAL_PEER_ID_CHARS)
		return 0;
	for (uint8_t index = 0; index < LOCAL_PEER_ID_BYTES; index++) {
		uint8_t high = localPeerHexNibble(id[index * 2]);
		uint8_t low = localPeerHexNibble(id[(index * 2) + 1]);
		if ((0xff == high) || (0xff == low))
			return 0;
		address[index] = (uint8_t)((high << 4) | low);
	}
	return 1;
}

static uint8_t localPeerDeriveKey(
	const uint8_t *domain,
	size_t domainLength,
	const char *sharedKey,
	size_t sharedKeyLength,
	uint8_t *output,
	size_t outputLength
)
{
	uint8_t input[(sizeof(gAuthenticationKeyDomain) - 1) + LOCAL_PEER_MAX_SHARED_KEY_BYTES];
	uint8_t digest[LOCAL_PEER_AUTH_KEY_BYTES];
	const mbedtls_md_info_t *md = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
	uint8_t success = 0;

	if (!md || (domainLength + sharedKeyLength > sizeof(input)) || (outputLength > sizeof(digest)))
		return 0;
	c_memcpy(input, domain, domainLength);
	c_memcpy(input + domainLength, sharedKey, sharedKeyLength);
	if (0 == mbedtls_md(md, input, domainLength + sharedKeyLength, digest)) {
		c_memcpy(output, digest, outputLength);
		success = 1;
	}
	c_memset(input, 0, sizeof(input));
	c_memset(digest, 0, sizeof(digest));
	return success;
}

static uint8_t localPeerCreateAuthenticationTag(
	LocalPeerRadio radio,
	const uint8_t *sourceAddress,
	const uint8_t *destinationAddress,
	const uint8_t *data,
	size_t dataLength,
	uint8_t *tag
)
{
	uint8_t authenticated[LOCAL_PEER_ID_BYTES * 2 + LOCAL_PEER_MAX_AUTHENTICATED_FRAME_BYTES];
	uint8_t digest[LOCAL_PEER_AUTH_KEY_BYTES];
	const mbedtls_md_info_t *md = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
	uint8_t success = 0;

	if (!md || (dataLength > LOCAL_PEER_MAX_AUTHENTICATED_FRAME_BYTES))
		return 0;
	c_memcpy(authenticated, sourceAddress, LOCAL_PEER_ID_BYTES);
	c_memcpy(authenticated + LOCAL_PEER_ID_BYTES, destinationAddress, LOCAL_PEER_ID_BYTES);
	c_memcpy(authenticated + (LOCAL_PEER_ID_BYTES * 2), data, dataLength);
	if (0 == mbedtls_md_hmac(
		md,
		radio->authKey,
		LOCAL_PEER_AUTH_KEY_BYTES,
		authenticated,
		(LOCAL_PEER_ID_BYTES * 2) + dataLength,
		digest
	)) {
		c_memcpy(tag, digest, LOCAL_PEER_AUTH_TAG_BYTES);
		success = 1;
	}
	c_memset(authenticated, 0, sizeof(authenticated));
	c_memset(digest, 0, sizeof(digest));
	return success;
}

static uint8_t localPeerAuthenticationTagMatches(const uint8_t *actual, const uint8_t *expected)
{
	uint8_t difference = 0;
	for (uint8_t index = 0; index < LOCAL_PEER_AUTH_TAG_BYTES; index++)
		difference |= actual[index] ^ expected[index];
	return 0 == difference;
}

static void localPeerFormatID(const uint8_t *address, char *id)
{
	static const char hex[] = "0123456789ABCDEF";
	for (uint8_t index = 0; index < LOCAL_PEER_ID_BYTES; index++) {
		id[index * 2] = hex[address[index] >> 4];
		id[(index * 2) + 1] = hex[address[index] & 0x0f];
	}
	id[LOCAL_PEER_ID_CHARS] = 0;
}

static void localPeerSetIDResult(xsMachine *the)
{
	uint8_t address[LOCAL_PEER_ID_BYTES];
	char id[LOCAL_PEER_ID_CHARS + 1];
	if (ESP_OK != esp_read_mac(address, ESP_MAC_WIFI_STA))
		xsUnknownError("read local peer identity failed");
	localPeerFormatID(address, id);
	xsmcSetString(xsResult, id);
}

static void localPeerThrowESPError(xsMachine *the, const char *operation, esp_err_t error)
{
	char message[96];
	c_snprintf(message, sizeof(message), "%s failed: %s", operation, esp_err_to_name(error));
	xsUnknownError(message);
}

static esp_err_t localPeerAddOrUpdate(LocalPeerRadio radio, const uint8_t *address, uint8_t secure)
{
	esp_now_peer_info_t peer = {0};
	esp_err_t error;

	c_memcpy(peer.peer_addr, address, LOCAL_PEER_ID_BYTES);
	peer.channel = 0;
	peer.ifidx = WIFI_IF_STA;
	peer.encrypt = secure && radio && radio->hasKey;
	if (peer.encrypt)
		c_memcpy(peer.lmk, radio->key, LOCAL_PEER_KEY_BYTES);

	if (esp_now_is_peer_exist(address))
		error = esp_now_mod_peer(&peer);
	else
		error = esp_now_add_peer(&peer);
	return (ESP_ERR_ESPNOW_EXIST == error) ? ESP_OK : error;
}

static void localPeerSentDeliver(void *the, void *refcon, uint8_t *message, uint16_t messageLength)
{
	LocalPeerRadio radio = refcon;
	if (!radio->closed) {
		xsBeginHost(the);
			xsCall1(radio->object, xsID("onLocalPeerSent"), xsBoolean(messageLength && message[0]));
		xsEndHost(the);
	}
	localPeerRelease(radio);
}

static void localPeerReceiveDeliver(void *the, void *refcon, uint8_t *message, uint16_t messageLength)
{
	LocalPeerRadio radio = refcon;
	if (!radio->closed && (messageLength >= LOCAL_PEER_RECEIVE_HEADER_BYTES)) {
		char id[LOCAL_PEER_ID_CHARS + 1];
		uint16_t dataLength = (uint16_t)(message[7] | (message[8] << 8));
		if ((uint16_t)(dataLength + LOCAL_PEER_RECEIVE_HEADER_BYTES) == messageLength) {
			localPeerFormatID(message, id);
			xsBeginHost(the);
				xsmcVars(1);
				xsmcSetArrayBuffer(xsVar(0), message + LOCAL_PEER_RECEIVE_HEADER_BYTES, dataLength);
				xsCall3(radio->object, xsID("onLocalPeerReceive"), xsString(id), xsVar(0), xsBoolean(message[6]));
			xsEndHost(the);
		}
	}
	localPeerRelease(radio);
}

#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(6, 0, 0)
static void localPeerSentCallback(const esp_now_send_info_t *info, esp_now_send_status_t status)
#else
static void localPeerSentCallback(const uint8_t *address, esp_now_send_status_t status)
#endif
{
	LocalPeerRadio radio = localPeerAcquire();
	uint8_t message = (ESP_NOW_SEND_SUCCESS == status);
	(void)status;
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(6, 0, 0)
	(void)info;
#else
	(void)address;
#endif
	if (!radio) return;
	if (0 != modMessagePostToMachine(radio->the, &message, sizeof(message), localPeerSentDeliver, radio))
		localPeerRelease(radio);
}

#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
static void localPeerReceiveCallback(const esp_now_recv_info_t *info, const uint8_t *data, int dataLength)
#else
static void localPeerReceiveCallback(const uint8_t *legacyAddress, const uint8_t *data, int dataLength)
#endif
{
	LocalPeerRadio radio;
	uint8_t message[LOCAL_PEER_RECEIVE_HEADER_BYTES + LOCAL_PEER_MAX_FRAME_BYTES];
	const uint8_t *sourceAddress;
	uint8_t expectedTag[LOCAL_PEER_AUTH_TAG_BYTES];
	uint8_t secure = 0;
	uint8_t unicast = 0;

	if ((dataLength < 0) || (dataLength > LOCAL_PEER_MAX_FRAME_BYTES)) return;
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
	if (!info || !info->src_addr || !info->des_addr) return;
	sourceAddress = info->src_addr;
	unicast = 0 != c_memcmp(info->des_addr, gBroadcastAddress, LOCAL_PEER_ID_BYTES);
#else
	if (!legacyAddress) return;
	sourceAddress = legacyAddress;
#endif
	radio = localPeerAcquire();
	if (!radio) return;
	if (radio->hasKey && (dataLength >= LOCAL_PEER_AUTH_TAG_BYTES)) {
		int authenticatedLength = dataLength - LOCAL_PEER_AUTH_TAG_BYTES;
		if (
			localPeerCreateAuthenticationTag(
				radio,
				sourceAddress,
				radio->id,
				data,
				(size_t)authenticatedLength,
				expectedTag
			) &&
			localPeerAuthenticationTagMatches(data + authenticatedLength, expectedTag)
		) {
			dataLength = authenticatedLength;
			secure = 1;
		}
	}
	// ESP-NOW receive metadata does not expose whether a frame passed LMK
	// authentication. Never infer authenticity from our local peer-table setting;
	// reject keyed unicast unless its transport tag proves the sender and target.
	if (radio->hasKey && unicast && !secure) {
		localPeerRelease(radio);
		return;
	}
	c_memcpy(message, sourceAddress, LOCAL_PEER_ID_BYTES);
	message[6] = secure;
	message[7] = (uint8_t)dataLength;
	message[8] = (uint8_t)(dataLength >> 8);
	c_memcpy(message + LOCAL_PEER_RECEIVE_HEADER_BYTES, data, dataLength);

	if (0 != modMessagePostToMachine(
		radio->the,
		message,
		(uint16_t)(LOCAL_PEER_RECEIVE_HEADER_BYTES + dataLength),
		localPeerReceiveDeliver,
		radio
	))
		localPeerRelease(radio);
}

static void localPeerNativeClose(LocalPeerRadio radio)
{
	uint8_t deinitialize = 0;
	uint8_t releaseOwner = 0;
	if (!radio) return;
	portENTER_CRITICAL(&gLocalPeerRadioMux);
	if (!radio->closed) {
		radio->closed = 1;
		releaseOwner = 1;
		if (gLocalPeerRadio == radio) {
			gLocalPeerRadio = NULL;
			deinitialize = 1;
		}
	}
	portEXIT_CRITICAL(&gLocalPeerRadioMux);
	if (!releaseOwner) return;
	if (deinitialize) {
		esp_now_unregister_send_cb();
		esp_now_unregister_recv_cb();
		esp_now_deinit();
	}
	localPeerRelease(radio);
}

void xs_local_peer_radio_destructor(void *data)
{
	localPeerNativeClose(data);
}

void xs_local_peer_radio_constructor(xsMachine *the)
{
	LocalPeerRadio radio;
	esp_err_t error;
	uint8_t connected = 0;
	int32_t offlineChannel = 1;
	uint8_t occupied;
	xsSlot value;

	portENTER_CRITICAL(&gLocalPeerRadioMux);
	occupied = (NULL != gLocalPeerRadio);
	portEXIT_CRITICAL(&gLocalPeerRadioMux);
	if (occupied)
		xsUnknownError("a local peer radio is already open");
	if (xsmcGet(value, xsArg(0), xsID("connected")))
		connected = xsmcToBoolean(value);
	if (xsmcGet(value, xsArg(0), xsID("offlineChannel")))
		offlineChannel = xsmcToInteger(value);
	if ((offlineChannel < 1) || (offlineChannel > 13))
		xsRangeError("invalid offline channel");

	wifi_mode_t mode;
	if (ESP_OK != esp_wifi_get_mode(&mode))
		xsUnknownError("Wi-Fi must be initialized before local peer radio");
	if (!connected) {
		error = esp_wifi_set_channel((uint8_t)offlineChannel, WIFI_SECOND_CHAN_NONE);
		if (ESP_OK != error)
			localPeerThrowESPError(the, "set local peer channel", error);
	}

	radio = c_calloc(1, sizeof(LocalPeerRadioRecord));
	if (!radio)
		xsUnknownError("no memory for local peer radio");
	radio->the = the;
	radio->object = xsThis;
	radio->useCount = 1;
	if (ESP_OK != esp_read_mac(radio->id, ESP_MAC_WIFI_STA)) {
		c_free(radio);
		xsUnknownError("read local peer identity failed");
	}

	if (xsmcGet(value, xsArg(0), xsID("sharedKey")) && xsmcTest(value)) {
		char sharedKey[65];
		size_t keyLength;
		xsmcToStringBuffer(value, sharedKey, sizeof(sharedKey));
		keyLength = c_strlen(sharedKey);
		if (
			!localPeerDeriveKey(
				gEncryptionKeyDomain,
				sizeof(gEncryptionKeyDomain) - 1,
				sharedKey,
				keyLength,
				radio->key,
				LOCAL_PEER_KEY_BYTES
			) ||
			!localPeerDeriveKey(
				gAuthenticationKeyDomain,
				sizeof(gAuthenticationKeyDomain) - 1,
				sharedKey,
				keyLength,
				radio->authKey,
				LOCAL_PEER_AUTH_KEY_BYTES
			)
		) {
			c_memset(sharedKey, 0, sizeof(sharedKey));
			c_free(radio);
			xsUnknownError("derive local peer key failed");
		}
		c_memset(sharedKey, 0, sizeof(sharedKey));
		radio->hasKey = 1;
	}

	error = esp_now_init();
	if (ESP_OK != error) {
		c_free(radio);
		localPeerThrowESPError(the, "initialize local peer radio", error);
	}
	portENTER_CRITICAL(&gLocalPeerRadioMux);
	gLocalPeerRadio = radio;
	portEXIT_CRITICAL(&gLocalPeerRadioMux);
	if (radio->hasKey) {
		error = esp_now_set_pmk(radio->key);
		if (ESP_OK != error) goto fail;
	}
	error = esp_now_register_send_cb(localPeerSentCallback);
	if (ESP_OK != error) goto fail;
	error = esp_now_register_recv_cb(localPeerReceiveCallback);
	if (ESP_OK != error) goto fail;
	error = localPeerAddOrUpdate(radio, gBroadcastAddress, 0);
	if (ESP_OK != error) goto fail;

	xsmcSetHostData(xsThis, radio);
	xsRemember(radio->object);
	return;

fail:
	localPeerNativeClose(radio);
	localPeerThrowESPError(the, "configure local peer radio", error);
}

void xs_local_peer_radio_close(xsMachine *the)
{
	LocalPeerRadio radio = xsmcGetHostData(xsThis);
	if (!radio) return;
	xsmcSetHostData(xsThis, NULL);
	xsForget(radio->object);
	localPeerNativeClose(radio);
}

void xs_local_peer_radio_get_id(xsMachine *the)
{
	LocalPeerRadio radio = xsmcGetHostDataValidate(xsThis, xs_local_peer_radio_destructor);
	(void)radio;
	localPeerSetIDResult(the);
}

void xs_local_peer_get_id(xsMachine *the)
{
	localPeerSetIDResult(the);
}

void xs_local_peer_radio_add_peer(xsMachine *the)
{
	LocalPeerRadio radio = xsmcGetHostDataValidate(xsThis, xs_local_peer_radio_destructor);
	uint8_t address[LOCAL_PEER_ID_BYTES];
	uint8_t secure = xsmcToBoolean(xsArg(1));
	if (!localPeerParseID(the, xsArg(0), address))
		xsRangeError("invalid peer ID");
	if (secure && !radio->hasKey)
		xsUnknownError("secure peer requires a shared key");
	esp_err_t error = localPeerAddOrUpdate(radio, address, secure);
	if (ESP_OK != error)
		localPeerThrowESPError(the, "add local peer", error);
}

void xs_local_peer_radio_remove_peer(xsMachine *the)
{
	LocalPeerRadio radio = xsmcGetHostDataValidate(xsThis, xs_local_peer_radio_destructor);
	uint8_t address[LOCAL_PEER_ID_BYTES];
	esp_err_t error;
	(void)radio;
	if (!localPeerParseID(the, xsArg(0), address))
		xsRangeError("invalid peer ID");
	error = esp_now_del_peer(address);
	if ((ESP_OK != error) && (ESP_ERR_ESPNOW_NOT_FOUND != error))
		localPeerThrowESPError(the, "remove local peer", error);
}

void xs_local_peer_radio_send(xsMachine *the)
{
	LocalPeerRadio radio = xsmcGetHostDataValidate(xsThis, xs_local_peer_radio_destructor);
	uint8_t address[LOCAL_PEER_ID_BYTES];
	uint8_t *data;
	uint8_t authenticatedData[LOCAL_PEER_MAX_FRAME_BYTES];
	uint8_t *sendData;
	xsUnsignedValue dataLength;
	size_t sendLength;
	esp_err_t error;
	if (radio->closed)
		xsUnknownError("local peer radio is closed");
	if (xsmcTest(xsArg(0))) {
		if (!localPeerParseID(the, xsArg(0), address))
			xsRangeError("invalid peer ID");
	} else {
		c_memcpy(address, gBroadcastAddress, LOCAL_PEER_ID_BYTES);
	}
	xsmcGetBufferReadable(xsArg(1), (void **)&data, &dataLength);
	if ((0 == dataLength) || (dataLength > LOCAL_PEER_MAX_FRAME_BYTES))
		xsRangeError("invalid local peer frame length");
	sendData = data;
	sendLength = dataLength;
	if (radio->hasKey && (0 != c_memcmp(address, gBroadcastAddress, LOCAL_PEER_ID_BYTES))) {
		if (dataLength > LOCAL_PEER_MAX_AUTHENTICATED_FRAME_BYTES)
			xsRangeError("authenticated local peer frame is too large");
		c_memcpy(authenticatedData, data, dataLength);
		if (!localPeerCreateAuthenticationTag(
			radio,
			radio->id,
			address,
			data,
			dataLength,
			authenticatedData + dataLength
		))
			xsUnknownError("authenticate local peer frame failed");
		sendData = authenticatedData;
		sendLength += LOCAL_PEER_AUTH_TAG_BYTES;
	}
	error = esp_now_send(address, sendData, sendLength);
	if (ESP_OK != error)
		localPeerThrowESPError(the, "send local peer frame", error);
}
