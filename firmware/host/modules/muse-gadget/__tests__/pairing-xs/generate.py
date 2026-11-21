from pathlib import Path
base=Path(__file__).parent
s=(base/'../../native/pairing-native.c').resolve().read_text(encoding='utf-8')
a=s.index('void xs_pairing_finished(xsMachine *the) {')
b=s.index('void xs_pairing_arm(',a)
finished=s[a:b]
a=s.index('void xs_pairing_receive(xsMachine *the) {')
b=s.index('  cJSON *encrypted = parse(the);',a)
receive=s[a:b]+'  xsUnknownError("unexpected test branch");\n}\n'
prefix=r"""#include "xs.h"
#include "xsmc.h"
#include "xsHost.h"
#include "mc.xs.h"
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
typedef int cJSON;
typedef int PairingOwner;
static bool finished_state;
static PairingOwner fixture;
static PairingOwner *get(xsMachine *the) { (void)the; return &fixture; }
static cJSON *parse(xsMachine *the) { (void)the; finished_state=false; return NULL; }
static void cJSON_Delete(cJSON *v) { (void)v; }
static bool link_pairing_session_confirmed(void) { return false; }
static bool link_pairing_confirmation_required(void) { return finished_state; }
typedef enum { LINK_DECRYPT_OK, LINK_DECRYPT_EXPIRED, LINK_DECRYPT_STATE, LINK_DECRYPT_ENVELOPE, LINK_DECRYPT_SESSION, LINK_DECRYPT_COUNTER, LINK_DECRYPT_MEMORY, LINK_DECRYPT_BASE64, LINK_DECRYPT_AEAD } link_pairing_decrypt_reason_t;
static const char *link_pairing_decrypt_diagnostic(cJSON *r,char **p,link_pairing_decrypt_reason_t *reason) { (void)r; *reason=LINK_DECRYPT_OK; *p=malloc(3); strcpy(*p,"{}"); return NULL; }
static bool exactFinished(const char *p) { return !strcmp(p,"{}"); }
static void mbedtls_platform_zeroize(void *p,size_t n) { memset(p,0,n); }
static void link_pairing_reset(void) { finished_state=false; }
static uint32_t link_pairing_handle_client_finished(void) { finished_state=true; return 7; }
"""
# Pre-call phase predicate must be false on each invocation.
receive=receive.replace('  PairingOwner *p = get(the);','  finished_state=false;\n  PairingOwner *p = get(the);\n  (void)p;')
(base/'boundary.c').write_text(prefix+finished+receive,encoding='utf-8')
