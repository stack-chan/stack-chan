#include "piuMC.h"
#include "commodettoBitmap.h"
#include "commodettoPoco.h"
#include "xsmc.h"

static void stackchanGray16MaskPortDrawAux(
	void* it,
	PiuView* view,
	PiuCoordinate x,
	PiuCoordinate y,
	PiuDimension sw,
	PiuDimension sh
)
{
	PiuPort* self = it;
	Poco poco = (*view)->poco;
	xsMachine* the = (*view)->the;
	CommodettoBitmap cb;
	PocoBitmapRecord bits;
	void* data = NULL;
	xsUnsignedValue dataSize;
	xsUnsignedValue rgb;

	xsBeginHost(the);
	xsmcVars(4);
	xsVar(0) = xsReference((*self)->reference);
	xsmcGet(xsVar(1), xsVar(0), xsID("_gray16Bitmap"));
	xsmcGet(xsVar(2), xsVar(0), xsID("_gray16Color"));

	cb = xsmcGetHostChunk(xsVar(1));
	bits.width = cb->w;
	bits.height = cb->h;
	bits.format = cb->format;
#if COMMODETTO_BITMAP_ID
	bits.id = cb->id;
	bits.byteLength = cb->byteLength;
#endif
	xsmcGet(xsVar(3), xsVar(0), xsID("_gray16Bytes"));
	xsmcGetBufferReadable(xsVar(3), &data, &dataSize);
	if (dataSize < cb->byteLength)
		xsRangeError("Gray16 mask buffer too small");
	bits.pixels = (PocoPixel*)data;

	rgb = (xsUnsignedValue)xsmcToInteger(xsVar(2));
	PocoGrayBitmapDraw(
		poco,
		&bits,
		PocoMakeColor(poco, (rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF),
		kPocoOpaque,
		x,
		y,
		0,
		0,
		sw,
		sh
	);
	xsEndHost(the);
}

void xs_stackchan_gray16_mask_port_draw(xsMachine* the)
{
	PiuPort* self = PIU(Port, xsThis);
	PiuView* view = (*self)->view;
	PiuCoordinate x;
	PiuCoordinate y;
	PiuDimension sw;
	PiuDimension sh;

	if (!view)
		xsUnknownError("out of sequence");

	x = 0;
	y = 0;
	sw = (PiuDimension)xsmcToInteger(xsArg(0));
	sh = (PiuDimension)xsmcToInteger(xsArg(1));
	PiuViewDrawContent(view, stackchanGray16MaskPortDrawAux, self, x, y, sw, sh);
}
