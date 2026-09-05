#include "xs.h"
#include "xsmc.h"
#include <emscripten.h>

void xs_stackchan_wasm_motion_available(xsMachine* the)
{
    xsmcSetBoolean(xsResult, EM_ASM_INT({
        const driver = stackchanRuntime.host && stackchanRuntime.host.Driver;
        return !!(driver && typeof driver.applyRotation === 'function' && typeof driver.setTorque === 'function');
    }));
}

void xs_stackchan_wasm_motion_write(xsMachine* the)
{
    const double y = xsmcToNumber(xsArg(0));
    const double p = xsmcToNumber(xsArg(1));
    const double r = xsmcToNumber(xsArg(2));
    const double time = xsmcToNumber(xsArg(3));
    xsmcSetBoolean(xsResult, EM_ASM_INT({
        const driver = stackchanRuntime.host && stackchanRuntime.host.Driver;
        if (!driver || typeof driver.applyRotation !== 'function') return 0;
        try { driver.applyRotation({rotation: {y: $0, p: $1, r: $2}, time: $3}); return 1; }
        catch (_) { return 0; }
    }, y, p, r, time));
}

void xs_stackchan_wasm_motion_torque(xsMachine* the)
{
    const int enabled = xsmcToBoolean(xsArg(0));
    xsmcSetBoolean(xsResult, EM_ASM_INT({
        const driver = stackchanRuntime.host && stackchanRuntime.host.Driver;
        if (!driver || typeof driver.setTorque !== 'function') return 0;
        try { driver.setTorque(!!$0); return 1; }
        catch (_) { return 0; }
    }, enabled));
}
