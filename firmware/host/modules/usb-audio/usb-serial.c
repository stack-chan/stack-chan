#include "xsPlatform.h"
#include "xsmc.h"
#include "xsHost.h"
#include "mc.xs.h"
#include "builtinCommon.h"

#include "driver/usb_serial_jtag.h"
#include "driver/usb_serial_jtag_select.h"
#include "freertos/FreeRTOS.h"

#define STACKCHAN_USB_RX_RING_BYTES (32 * 1024)
#define STACKCHAN_USB_TX_RING_BYTES (16 * 1024)

typedef struct USBSerialRecord USBSerialRecord;
typedef USBSerialRecord *USBSerial;

struct USBSerialRecord {
	xsMachine *the;
	xsSlot object;
	xsSlot *onReadable;
	xsSlot *onWritable;
	xsSlot *onError;
	uint32_t txProgress;
	uint16_t maxWriteBytes;
	uint16_t useCount;
	uint8_t callbackPending;
	uint8_t closed;
	uint8_t failed;
	uint8_t notifyError;
	uint8_t notifyReadable;
	uint8_t notifyWritable;
	uint8_t writeBlocked;
};

static USBSerial gUSBSerial;
static portMUX_TYPE gUSBSerialMux = portMUX_INITIALIZER_UNLOCKED;

void xs_stackchan_usb_serial_destructor(void *data);
static void usbSerialDeliver(void *the, void *refcon, uint8_t *message, uint16_t messageLength);
static void usbSerialMark(xsMachine *the, void *it, xsMarkRoot markRoot);
static void usbSerialSelectCallback(usj_select_notif_t notification, int *taskWoken);

static const xsHostHooks ICACHE_RODATA_ATTR xsUSBSerialHooks = {
	xs_stackchan_usb_serial_destructor,
	usbSerialMark,
	NULL
};

static void usbSerialRelease(USBSerial serial)
{
	if (0 == __atomic_sub_fetch(&serial->useCount, 1, __ATOMIC_SEQ_CST))
		c_free(serial);
}

static uint8_t usbSerialPrepareCallbackLocked(USBSerial serial)
{
	if (serial->closed || serial->callbackPending)
		return 0;
	serial->callbackPending = 1;
	__atomic_add_fetch(&serial->useCount, 1, __ATOMIC_SEQ_CST);
	return 1;
}

static void usbSerialPostCallback(USBSerial serial)
{
	uint8_t post;
	portENTER_CRITICAL(&gUSBSerialMux);
	post = usbSerialPrepareCallbackLocked(serial);
	portEXIT_CRITICAL(&gUSBSerialMux);
	if (!post)
		return;
	if (0 != modMessagePostToMachine(serial->the, NULL, 0, usbSerialDeliver, serial)) {
		portENTER_CRITICAL(&gUSBSerialMux);
		serial->callbackPending = 0;
		portEXIT_CRITICAL(&gUSBSerialMux);
		usbSerialRelease(serial);
	}
}

static void usbSerialSelectCallback(usj_select_notif_t notification, int *taskWoken)
{
	USBSerial serial;
	uint8_t post = 0;
	(void)taskWoken;

	portENTER_CRITICAL_ISR(&gUSBSerialMux);
	serial = gUSBSerial;
	if (serial && !serial->closed) {
		switch (notification) {
			case USJ_SELECT_READ_NOTIF:
				if (!serial->failed && serial->onReadable)
					serial->notifyReadable = 1;
				break;
			case USJ_SELECT_WRITE_NOTIF:
				serial->txProgress += 1;
				if (!serial->failed && serial->writeBlocked && serial->onWritable)
					serial->notifyWritable = 1;
				break;
			case USJ_SELECT_ERROR_NOTIF:
				serial->failed = 1;
				serial->notifyError = 1;
				serial->notifyReadable = 0;
				serial->notifyWritable = 0;
				serial->writeBlocked = 0;
				break;
		}
		if (serial->notifyError || serial->notifyReadable || serial->notifyWritable)
			post = usbSerialPrepareCallbackLocked(serial);
	}
	portEXIT_CRITICAL_ISR(&gUSBSerialMux);

	if (post && (0 != modMessagePostToMachineFromISR(serial->the, usbSerialDeliver, serial))) {
		portENTER_CRITICAL_ISR(&gUSBSerialMux);
		serial->callbackPending = 0;
		portEXIT_CRITICAL_ISR(&gUSBSerialMux);
		usbSerialRelease(serial);
	}
}

static void usbSerialDeliver(void *theIn, void *refcon, uint8_t *message, uint16_t messageLength)
{
	xsMachine *the = theIn;
	USBSerial serial = refcon;
	uint8_t notifyError;
	uint8_t notifyReadable;
	uint8_t notifyWritable;
	uint8_t failed;
	(void)message;
	(void)messageLength;

	portENTER_CRITICAL(&gUSBSerialMux);
	serial->callbackPending = 0;
	notifyError = serial->notifyError;
	notifyReadable = serial->notifyReadable;
	notifyWritable = serial->notifyWritable;
	failed = serial->failed;
	serial->notifyError = 0;
	serial->notifyReadable = 0;
	serial->notifyWritable = 0;
	if (notifyWritable)
		serial->writeBlocked = 0;
	if (serial->closed) {
		notifyError = 0;
		notifyReadable = 0;
		notifyWritable = 0;
	}
	portEXIT_CRITICAL(&gUSBSerialMux);

	if (notifyError && serial->onError) {
		xsBeginHost(the);
			xsCallFunction0(xsReference(serial->onError), serial->object);
		xsEndHost(the);
	}
	else if (!failed) {
		if (notifyReadable && serial->onReadable) {
			size_t available = usb_serial_jtag_get_read_bytes_available();
			if (available) {
				xsBeginHost(the);
					xsmcSetNumber(xsResult, available);
					xsCallFunction1(xsReference(serial->onReadable), serial->object, xsResult);
				xsEndHost(the);
			}
		}
		if (notifyWritable && !serial->closed && serial->onWritable) {
			xsBeginHost(the);
				xsCallFunction0(xsReference(serial->onWritable), serial->object);
			xsEndHost(the);
		}
	}
	usbSerialRelease(serial);
}

static void usbSerialNativeClose(USBSerial serial)
{
	uint8_t uninstall = 0;
	if (!serial)
		return;

	portENTER_CRITICAL(&gUSBSerialMux);
	if (!serial->closed) {
		serial->closed = 1;
		if (gUSBSerial == serial) {
			gUSBSerial = NULL;
			uninstall = 1;
		}
	}
	portEXIT_CRITICAL(&gUSBSerialMux);
	if (!uninstall)
		return;

	usb_serial_jtag_set_select_notif_callback(NULL);
	usb_serial_jtag_driver_uninstall();
	usbSerialRelease(serial);
}

static USBSerial usbSerialGetUsable(xsMachine *the)
{
	USBSerial serial = xsmcGetHostDataValidate(xsThis, (void *)&xsUSBSerialHooks);
	if (serial->failed)
		xsUnknownError("USB serial is unusable");
	return serial;
}

void xs_stackchan_usb_serial_constructor(xsMachine *the)
{
	USBSerial serial;
	usb_serial_jtag_driver_config_t config = {
		.rx_buffer_size = STACKCHAN_USB_RX_RING_BYTES,
		.tx_buffer_size = STACKCHAN_USB_TX_RING_BYTES,
	};
	uint8_t occupied;
	uint8_t format;
	xsIntegerValue maxWriteBytes;

	portENTER_CRITICAL(&gUSBSerialMux);
	occupied = NULL != gUSBSerial;
	portEXIT_CRITICAL(&gUSBSerialMux);
	if (occupied)
		xsUnknownError("a USB serial instance is already open");

	format = builtinInitializeFormat(the, kIOFormatBuffer);
	if (kIOFormatBuffer != format)
		xsRangeError("unsupported USB serial format");
	maxWriteBytes = xsmcToInteger(xsArg(1));
	if ((maxWriteBytes <= 0) || (maxWriteBytes > (STACKCHAN_USB_TX_RING_BYTES / 2)))
		xsRangeError("invalid maximum USB serial write size");
	builtinInitializeTarget(the);

	serial = c_calloc(1, sizeof(USBSerialRecord));
	if (!serial)
		xsUnknownError("no memory for USB serial");
	serial->the = the;
	serial->object = xsThis;
	serial->onReadable = builtinGetCallback(the, xsID_onReadable);
	serial->onWritable = builtinGetCallback(the, xsID_onWritable);
	serial->onError = builtinGetCallback(the, xsID_onError);
	serial->maxWriteBytes = (uint16_t)maxWriteBytes;
	serial->useCount = 1;

	if (ESP_OK != usb_serial_jtag_driver_install(&config)) {
		c_free(serial);
		xsUnknownError("USB serial driver installation failed");
	}

	portENTER_CRITICAL(&gUSBSerialMux);
	gUSBSerial = serial;
	portEXIT_CRITICAL(&gUSBSerialMux);
	usb_serial_jtag_set_select_notif_callback(usbSerialSelectCallback);

	xsmcSetHostData(xsThis, serial);
	xsSetHostHooks(xsThis, (xsHostHooks *)&xsUSBSerialHooks);
	xsRemember(serial->object);

	if (serial->onReadable && usb_serial_jtag_get_read_bytes_available()) {
		portENTER_CRITICAL(&gUSBSerialMux);
		serial->notifyReadable = 1;
		portEXIT_CRITICAL(&gUSBSerialMux);
		usbSerialPostCallback(serial);
	}
}

void xs_stackchan_usb_serial_destructor(void *data)
{
	usbSerialNativeClose(data);
}

void xs_stackchan_usb_serial_close(xsMachine *the)
{
	USBSerial serial = xsmcGetHostData(xsThis);
	if (!serial)
		return;
	xsmcGetHostDataValidate(xsThis, (void *)&xsUSBSerialHooks);
	xsmcSetHostData(xsThis, NULL);
	xsmcSetHostDestructor(xsThis, NULL);
	xsForget(serial->object);
	usbSerialNativeClose(serial);
}

void xs_stackchan_usb_serial_read(xsMachine *the)
{
	USBSerial serial = usbSerialGetUsable(the);
	uint8_t *target;
	xsUnsignedValue targetLength;
	size_t available = usb_serial_jtag_get_read_bytes_available();
	size_t requested;
	uint8_t allocate = 1;
	int count;
	(void)serial;

	if (!available)
		return;
	if (!xsmcArgc)
		requested = available;
	else if (xsReferenceType == xsmcTypeOf(xsArg(0))) {
		xsmcGetBufferWritable(xsArg(0), (void **)&target, &targetLength);
		requested = targetLength;
		allocate = 0;
	}
	else {
		xsIntegerValue maximum = xsmcToInteger(xsArg(0));
		if (maximum <= 0)
			xsRangeError("invalid USB serial read size");
		requested = (size_t)maximum;
	}
	if (requested > available)
		requested = available;
	if (!requested) {
		if (!allocate)
			xsmcSetInteger(xsResult, 0);
		return;
	}
	if (allocate)
		target = xsmcSetArrayBufferResizable(xsResult, NULL, requested, requested);

	count = usb_serial_jtag_read_bytes(target, requested, 0);
	if (count <= 0) {
		xsResult = xsUndefined;
		return;
	}
	if (allocate) {
		if ((size_t)count < requested)
			xsmcSetArrayBufferLength(xsResult, count);
	}
	else
		xsmcSetInteger(xsResult, count);
}

void xs_stackchan_usb_serial_write(xsMachine *the)
{
	USBSerial serial = usbSerialGetUsable(the);
	uint8_t *source;
	xsUnsignedValue length;
	uint32_t progressBefore;
	uint8_t post = 0;
	int count;

	xsmcGetBufferReadable(xsArg(0), (void **)&source, &length);
	if (length > serial->maxWriteBytes)
		xsRangeError("USB serial write is too large");
	if (!length) {
		xsmcSetBoolean(xsResult, 1);
		return;
	}

	portENTER_CRITICAL(&gUSBSerialMux);
	progressBefore = serial->txProgress;
	portEXIT_CRITICAL(&gUSBSerialMux);
	count = usb_serial_jtag_write_bytes(source, length, 0);
	if (count == (int)length) {
		portENTER_CRITICAL(&gUSBSerialMux);
		serial->writeBlocked = 0;
		portEXIT_CRITICAL(&gUSBSerialMux);
		xsmcSetBoolean(xsResult, 1);
		return;
	}
	if (count > 0) {
		portENTER_CRITICAL(&gUSBSerialMux);
		serial->failed = 1;
		serial->notifyError = 1;
		portEXIT_CRITICAL(&gUSBSerialMux);
		usbSerialPostCallback(serial);
		xsUnknownError("USB serial write was partial");
	}

	portENTER_CRITICAL(&gUSBSerialMux);
	serial->writeBlocked = 1;
	if (serial->txProgress != progressBefore) {
		serial->notifyWritable = 1;
		post = 1;
	}
	portEXIT_CRITICAL(&gUSBSerialMux);
	if (post)
		usbSerialPostCallback(serial);
	xsmcSetBoolean(xsResult, 0);
}

void xs_stackchan_usb_serial_get_connected(xsMachine *the)
{
	USBSerial serial = usbSerialGetUsable(the);
	(void)serial;
	xsmcSetBoolean(xsResult, usb_serial_jtag_is_connected());
}

void xs_stackchan_usb_serial_get_format(xsMachine *the)
{
	USBSerial serial = usbSerialGetUsable(the);
	(void)serial;
	builtinGetFormat(the, kIOFormatBuffer);
}

void xs_stackchan_usb_serial_set_format(xsMachine *the)
{
	USBSerial serial = usbSerialGetUsable(the);
	(void)serial;
	if (kIOFormatBuffer != builtinSetFormat(the))
		xsRangeError("unsupported USB serial format");
}

static void usbSerialMark(xsMachine *the, void *it, xsMarkRoot markRoot)
{
	USBSerial serial = it;
	if (serial->onReadable)
		(*markRoot)(the, serial->onReadable);
	if (serial->onWritable)
		(*markRoot)(the, serial->onWritable);
	if (serial->onError)
		(*markRoot)(the, serial->onError);
}
