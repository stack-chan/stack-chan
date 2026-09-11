#include "xsAll.h"
#include "xs.h"

void xs_stackchan_detach_mod_archive(xsMachine *the)
{
  /* Stop both module and Resource lookup in the writable xs partition.
     The platform still owns its mapping/allocation and releases it at reboot. */
  fxSetArchive(the, NULL);
}
