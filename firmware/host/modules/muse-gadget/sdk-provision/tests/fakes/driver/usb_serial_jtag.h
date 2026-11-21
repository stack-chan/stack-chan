#pragma once
#include <stddef.h>
#define ESP_OK 0
typedef struct {int rx_buffer_size,tx_buffer_size;} usb_serial_jtag_driver_config_t;
int usb_serial_jtag_driver_install(const usb_serial_jtag_driver_config_t *);
void usb_serial_jtag_driver_uninstall(void);
int usb_serial_jtag_read_bytes(void *,size_t,int);
