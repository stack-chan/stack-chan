#include "xs.h"
#include "piuMC.h"
#include "commodettoBitmap.h"
#include "commodettoPoco.h"
#include "xsmc.h"

static void stackchanRuntimeBitmapPortDrawAux(void* it, PiuView* view, PiuCoordinate x, PiuCoordinate y, PiuDimension sw, PiuDimension sh)
{
	PiuPort* self = it;
	Poco poco = (*view)->poco;
	xsMachine* the = (*view)->the;
	CommodettoBitmap cb;
	PocoBitmapRecord bits;
	void* data = NULL;
	xsUnsignedValue dataSize;
	(void)sw;
	(void)sh;

	xsBeginHost(the);
	xsmcVars(7);
	xsVar(0) = xsReference((*self)->reference);
	xsmcGet(xsVar(1), xsVar(0), xsID("_runtimeBitmap"));
	xsmcGet(xsVar(2), xsVar(0), xsID("_runtimeBitmapSX"));
	xsmcGet(xsVar(3), xsVar(0), xsID("_runtimeBitmapSY"));
	xsmcGet(xsVar(4), xsVar(0), xsID("_runtimeBitmapSW"));
	xsmcGet(xsVar(5), xsVar(0), xsID("_runtimeBitmapSH"));

	cb = xsmcGetHostChunk(xsVar(1));
	bits.width = cb->w;
	bits.height = cb->h;
	bits.format = cb->format;
#if COMMODETTO_BITMAP_ID
	bits.id = cb->id;
	bits.byteLength = cb->byteLength;
#endif
	if (cb->havePointer) {
		bits.pixels = cb->bits.data;
	}
	else {
		xsmcGet(xsVar(6), xsVar(1), xsID_buffer);
		xsmcGetBufferReadable(xsVar(6), &data, &dataSize);
		PocoDisableGC(poco);
		bits.pixels = (PocoPixel*)(cb->bits.offset + (char*)data);
	}

	PocoBitmapDraw(
		poco,
		&bits,
		x,
		y,
		(PocoDimension)xsmcToInteger(xsVar(2)),
		(PocoDimension)xsmcToInteger(xsVar(3)),
		(PocoDimension)xsmcToInteger(xsVar(4)),
		(PocoDimension)xsmcToInteger(xsVar(5))
	);
	xsEndHost(the);
}

void xs_stackchan_runtime_bitmap_port_draw(xsMachine* the)
{
	PiuPort* self = PIU(Port, xsThis);
	PiuView* view = (*self)->view;
	PiuCoordinate x, y;
	PiuDimension sw, sh;

	if (!view)
		xsUnknownError("out of sequence");

	x = (PiuCoordinate)xsmcToInteger(xsArg(0));
	y = (PiuCoordinate)xsmcToInteger(xsArg(1));
	sw = (PiuDimension)xsmcToInteger(xsArg(4));
	sh = (PiuDimension)xsmcToInteger(xsArg(5));
	PiuViewDrawContent(view, stackchanRuntimeBitmapPortDrawAux, self, x, y, sw, sh);
}
