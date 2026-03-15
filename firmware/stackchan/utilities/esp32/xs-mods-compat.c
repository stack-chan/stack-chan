/*
 * Work around Moddable public's current XS_MODS linker regression on ESP32.
 * xs/platforms/mc/xsHosts.c references gXSAbortStrings as an extern symbol,
 * but the latest upstream exports only fxAbortString() and keeps the table
 * itself file-local. Keep this weak so an eventual upstream fix can override it.
 */

const char *gXSAbortStrings[] __attribute__((weak)) = {
	"debugger",
	"memory full",
	"JavaScript stack overflow",
	"fatal",
	"dead strip",
	"unhandled exception",
	"not enough keys",
	"too much computation",
	"unhandled rejection",
	"native stack overflow",
};
