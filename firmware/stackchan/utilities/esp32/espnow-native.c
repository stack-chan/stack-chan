#include "xs.h"
#include "xsmc.h"
#include "esp_check.h"
#include "esp_err.h"
#include "esp_event.h"
#include "esp_idf_version.h"
#include "esp_now.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include "freertos/FreeRTOS.h"
#include "freertos/portmacro.h"
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#define STACKCHAN_ESPNOW_MAX_PACKET_SIZE 250

static bool g_wifi_started = false;
static bool g_espnow_started = false;
static bool g_broadcast_peer_added = false;
static bool g_has_packet = false;
static uint8_t g_packet[STACKCHAN_ESPNOW_MAX_PACKET_SIZE];
static size_t g_packet_size = 0;
static portMUX_TYPE g_packet_lock = portMUX_INITIALIZER_UNLOCKED;
static const uint8_t g_broadcast_address[ESP_NOW_ETH_ALEN] = {0xff, 0xff, 0xff, 0xff, 0xff, 0xff};

static int stackchanClampChannel(int channel)
{
	if (channel < 1)
		return 1;
	if (channel > 13)
		return 13;
	return channel;
}

static void stackchanStoreEspNowPacket(const uint8_t* data, int length)
{
	if (!data || (length <= 0))
		return;

	if (length > STACKCHAN_ESPNOW_MAX_PACKET_SIZE)
		length = STACKCHAN_ESPNOW_MAX_PACKET_SIZE;

	portENTER_CRITICAL(&g_packet_lock);
	memcpy(g_packet, data, length);
	g_packet_size = (size_t)length;
	g_has_packet = true;
	portEXIT_CRITICAL(&g_packet_lock);
}

#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
static void stackchanEspNowReceiveCallback(const esp_now_recv_info_t* info, const uint8_t* data, int length)
{
	(void)info;
	stackchanStoreEspNowPacket(data, length);
}
#else
static void stackchanEspNowReceiveCallback(const uint8_t* mac, const uint8_t* data, int length)
{
	(void)mac;
	stackchanStoreEspNowPacket(data, length);
}
#endif

static void stackchanCheckEspError(xsMachine* the, esp_err_t err, char* message)
{
	if ((err != ESP_OK) && (err != ESP_ERR_INVALID_STATE))
		xsUnknownError(message);
}

static void stackchanAddBroadcastPeer(xsMachine* the, int channel)
{
	if (g_broadcast_peer_added)
		return;

	esp_now_peer_info_t peer;
	memset(&peer, 0, sizeof(peer));
	memcpy(peer.peer_addr, g_broadcast_address, ESP_NOW_ETH_ALEN);
	peer.channel = (uint8_t)channel;
	peer.ifidx = WIFI_IF_STA;
	peer.encrypt = false;

	esp_err_t err = esp_now_add_peer(&peer);
	if ((err != ESP_OK) && (err != ESP_ERR_ESPNOW_EXIST))
		xsUnknownError("esp_now_add_peer failed");

	g_broadcast_peer_added = true;
}

void xs_stackchan_espnow_start(xsMachine* the)
{
	int channel = stackchanClampChannel(xsmcToInteger(xsArg(0)));
	esp_err_t err;

	if (!g_wifi_started) {
		err = esp_netif_init();
		stackchanCheckEspError(the, err, "esp_netif_init failed");

		err = esp_event_loop_create_default();
		stackchanCheckEspError(the, err, "esp_event_loop_create_default failed");

		wifi_init_config_t config = WIFI_INIT_CONFIG_DEFAULT();
		err = esp_wifi_init(&config);
		stackchanCheckEspError(the, err, "esp_wifi_init failed");

		err = esp_wifi_set_mode(WIFI_MODE_STA);
		stackchanCheckEspError(the, err, "esp_wifi_set_mode failed");

		err = esp_wifi_start();
		stackchanCheckEspError(the, err, "esp_wifi_start failed");

		g_wifi_started = true;
	}

	err = esp_wifi_set_channel((uint8_t)channel, WIFI_SECOND_CHAN_NONE);
	if (err != ESP_OK)
		xsUnknownError("esp_wifi_set_channel failed");

	if (!g_espnow_started) {
		err = esp_now_init();
		if (err != ESP_OK)
			xsUnknownError("esp_now_init failed");

		err = esp_now_register_recv_cb(stackchanEspNowReceiveCallback);
		if (err != ESP_OK)
			xsUnknownError("esp_now_register_recv_cb failed");

		g_espnow_started = true;
	}

	stackchanAddBroadcastPeer(the, channel);
}

void xs_stackchan_espnow_read(xsMachine* the)
{
	uint8_t packet[STACKCHAN_ESPNOW_MAX_PACKET_SIZE];
	size_t packet_size = 0;

	portENTER_CRITICAL(&g_packet_lock);
	if (g_has_packet) {
		packet_size = g_packet_size;
		memcpy(packet, g_packet, packet_size);
		g_has_packet = false;
		g_packet_size = 0;
	}
	portEXIT_CRITICAL(&g_packet_lock);

	if (packet_size == 0) {
		xsmcSetUndefined(xsResult);
		return;
	}

	xsmcSetArrayBuffer(xsResult, packet, packet_size);
}

void xs_stackchan_espnow_send(xsMachine* the)
{
	void* data = NULL;
	xsUnsignedValue data_size = 0;
	esp_err_t err;

	if (!g_espnow_started)
		xsUnknownError("esp_now is not started");

	xsmcGetBufferReadable(xsArg(0), &data, &data_size);
	if ((data == NULL) || (data_size == 0) || (data_size > STACKCHAN_ESPNOW_MAX_PACKET_SIZE))
		xsUnknownError("invalid esp_now packet");

	err = esp_now_send(g_broadcast_address, (const uint8_t*)data, data_size);
	if (err != ESP_OK)
		xsUnknownError("esp_now_send failed");
}

void xs_stackchan_espnow_close(xsMachine* the)
{
	if (g_espnow_started) {
		esp_now_unregister_recv_cb();
		esp_now_deinit();
		g_espnow_started = false;
		g_broadcast_peer_added = false;
	}

	portENTER_CRITICAL(&g_packet_lock);
	g_has_packet = false;
	g_packet_size = 0;
	portEXIT_CRITICAL(&g_packet_lock);
}
