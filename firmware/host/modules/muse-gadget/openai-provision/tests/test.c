#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "../provision-core.c"

static char stored[OPENAI_KEY_MAX + 1];
static bool exists, namespace_exists, install_fails;
static int fault, reads, writes, commits, opens, closes, installed, removed;
static const char *input;
static size_t offset, input_size, read_limit = 64;

int nvs_open(const char *ns, int mode, nvs_handle_t *h) {
  assert(!strcmp(ns, "ai"));
  if (fault == 1) return -1;
  if (!namespace_exists && mode == NVS_READONLY) return ESP_ERR_NVS_NOT_FOUND;
  namespace_exists = true; *h = 3; opens++; return ESP_OK;
}
void nvs_close(nvs_handle_t h) { assert(h == 3); closes++; }
int nvs_get_str(nvs_handle_t h, const char *key, char *out, size_t *size) {
  assert(h == 3 && !strcmp(key, "token"));
  if (fault == 2) return -1;
  if (!exists) return ESP_ERR_NVS_NOT_FOUND;
  if (fault == 7) return ESP_ERR_NVS_TYPE_MISMATCH;
  size_t n = strlen(stored) + 1;
  if (out) {
    reads++;
    if (fault == 5 || *size < n) return -1;
    memcpy(out, stored, n);
    if (fault == 6) out[4] = '!';
  }
  *size = n; return ESP_OK;
}
int nvs_set_str(nvs_handle_t h, const char *key, const char *value) {
  assert(h == 3 && !strcmp(key, "token")); writes++;
  if (fault == 3) return -1;
  assert(strlen(value) <= OPENAI_KEY_MAX);
  strcpy(stored, value); exists = true; return ESP_OK;
}
int nvs_commit(nvs_handle_t h) { assert(h == 3); commits++; return fault == 4 ? -1 : ESP_OK; }
int usb_serial_jtag_driver_install(const usb_serial_jtag_driver_config_t *config) {
  assert(config->rx_buffer_size == 1024 && config->tx_buffer_size == 256);
  if (install_fails) return -1;
  installed++; return ESP_OK;
}
void usb_serial_jtag_driver_uninstall(void) { removed++; }
int usb_serial_jtag_read_bytes(void *out, size_t cap, int ticks) {
  assert(!ticks);
  size_t n = input_size - offset;
  if (n > cap) n = cap;
  if (n > read_limit) n = read_limit;
  memcpy(out, input + offset, n); offset += n; return (int)n;
}
static void clear(void) {
  memset(stored, 0, sizeof(stored)); exists = namespace_exists = false;
  fault = reads = writes = commits = opens = closes = 0;
}
static void assert_wiped(void) { for (size_t i = 0; i < sizeof(frame); i++) assert(frame[i] == 0); }
static int run_bytes(const char *data, size_t size) {
  input = data; input_size = size; offset = 0;
  assert(openai_key_input_open());
  assert(!openai_key_input_open());
  int result = 0;
  for (unsigned i = 0; i < 2000 && !result; i++) result = openai_key_input_poll();
  assert(result && sealed);
  int before = writes;
  assert(openai_key_input_poll() == 3 && writes == before);
  assert_wiped();
  openai_key_input_close();
  assert_wiped();
  assert(!owned && opens == closes);
  return result;
}
static int run(const char *s) { return run_bytes(s, strlen(s)); }
int main(void) {
  char key[OPENAI_KEY_MAX + 1], message[OPENAI_KEY_MAX + 10];
  memcpy(key, "sk-", 3); memset(key + 3, 'A', OPENAI_KEY_MAX - 3); key[OPENAI_KEY_MAX] = 0;
  assert(valid_key(key));
  key[20] = '!'; assert(!valid_key(key)); key[20] = 'A';
  assert(!valid_key("sk-short"));
  clear(); assert(run("CANARY\n") == 2 && writes == 0 && opens == 0);
  assert(run("garbage\n") == 3 && writes == 0);
  snprintf(message, sizeof(message), "OPENAI:%s\n", key);
  read_limit = 1;
  assert(run(message) == 1 && writes == 1 && commits == 1 && reads == 1);
  assert(!strcmp(key, stored));
  assert(run(message) == 4 && writes == 1 && reads == 1);
  read_limit = 64;
  clear(); exists = namespace_exists = true; strcpy(stored, "malformed");
  assert(run(message) == 4 && writes == 0 && reads == 0);
  fault = 7; assert(run(message) == 4 && writes == 0);
  for (int f = 1; f <= 6; f++) {
    clear(); fault = f;
    assert(run(message) == 3 && writes <= 1 && commits <= 1);
  }
  clear();
  char oversized[700]; memset(oversized, 'A', sizeof(oversized)); oversized[699] = '\n';
  assert(run_bytes(oversized, sizeof(oversized)) == 3 && writes == 0);
  char invalid[] = "OPENAI:sk-AAA\0AAA\n";
  assert(run_bytes(invalid, sizeof(invalid) - 1) == 3 && writes == 0);
  input = "OPENAI:sk-partial"; input_size = strlen(input); offset = 0;
  assert(openai_key_input_open()); assert(openai_key_input_poll() == 0);
  openai_key_input_close(); assert_wiped(); assert(!length && !owned);
  install_fails = true; assert(!openai_key_input_open()); assert_wiped();
  assert(installed == removed);
  puts("OPENAI_KEY_USB_STORE_MOCK_PASS");
}
