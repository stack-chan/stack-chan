#include "xsAll.h"
#include "mc.xs.h"
#include <stdio.h>
#include <stdlib.h>

void fxAbort(xsMachine *the, int status) { (void)the; exit(status ? status : 1); }

int main(void) {
  txPreparation *preparation = xsPreparation();
  xsMachine *machine = xsPrepareMachine(&preparation->creation, preparation, "muse-voice-test", NULL, NULL);
  int error = 0;
  if (!machine) return 1;
  xsBeginHost(machine);
  xsTry {
    xsResult = xsAwaitImport("main", XS_IMPORT_NAMESPACE);
    for (int i = 0; i < 1000 && !xsHas(xsGlobal, xsID("testResult")); i++) fxRunPromiseJobs(the);
    if (!xsHas(xsGlobal, xsID("testResult"))) { fprintf(stderr, "test did not complete\n"); error = 1; }
    else {
      xsResult = xsGet(xsGlobal, xsID("testResult"));
      if (strcmp(xsToString(xsResult), "pass")) { fprintf(stderr, "%s\n", xsToString(xsResult)); error = 1; }
    }
  }
  xsCatch { fprintf(stderr, "%s\n", xsToString(xsException)); error = 1; }
  xsEndHost(machine);
  xsDeleteMachine(machine);
  return error;
}
