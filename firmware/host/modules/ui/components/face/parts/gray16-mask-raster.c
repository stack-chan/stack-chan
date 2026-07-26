#include "xsmc.h"

#include <math.h>
#include <stdint.h>
#include <string.h>

typedef struct {
	uint8_t* bytes;
	xsUnsignedValue byteLength;
	int width;
	int height;
	int strideWidth;
} StackchanGray16Mask;

static void stackchanGray16GetMask(xsMachine* the, StackchanGray16Mask* mask)
{
	xsmcGetBufferWritable(xsArg(0), (void**)&mask->bytes, &mask->byteLength);
	mask->width = xsmcToInteger(xsArg(1));
	mask->height = xsmcToInteger(xsArg(2));
	mask->strideWidth = xsmcToInteger(xsArg(3));

	if (
		(mask->width <= 0) ||
		(mask->height <= 0) ||
		(mask->strideWidth < mask->width) ||
		(mask->strideWidth & 1) ||
		(((xsUnsignedValue)(mask->strideWidth * mask->height) >> 1) > mask->byteLength)
	)
		xsRangeError("invalid Gray16 mask");
}

static uint8_t stackchanGray16CoverageToAlpha(double coverage)
{
	if (coverage <= 0)
		return 15;
	if (coverage >= 1)
		return 0;
	return (uint8_t)(15 - (int)floor((coverage * 15) + 0.5));
}

static void stackchanGray16SetCoverage(
	const StackchanGray16Mask* mask,
	int x,
	int y,
	double coverage
)
{
	xsUnsignedValue offset;
	uint8_t alpha;
	uint8_t current;

	if ((x < 0) || (x >= mask->width) || (y < 0) || (y >= mask->height))
		return;

	alpha = stackchanGray16CoverageToAlpha(coverage);
	offset = (xsUnsignedValue)((y * mask->strideWidth + x) >> 1);
	current = mask->bytes[offset];
	if (x & 1)
		mask->bytes[offset] = (uint8_t)((current & 0xF0) | alpha);
	else
		mask->bytes[offset] = (uint8_t)((current & 0x0F) | (alpha << 4));
}

static void stackchanGray16AddCoverage(
	const StackchanGray16Mask* mask,
	int x,
	int y,
	double coverage
)
{
	xsUnsignedValue offset;
	uint8_t alpha;
	uint8_t current;
	uint8_t currentAlpha;

	if ((x < 0) || (x >= mask->width) || (y < 0) || (y >= mask->height))
		return;

	alpha = stackchanGray16CoverageToAlpha(coverage);
	offset = (xsUnsignedValue)((y * mask->strideWidth + x) >> 1);
	current = mask->bytes[offset];
	currentAlpha = (x & 1) ? (current & 0x0F) : (current >> 4);
	if (alpha >= currentAlpha)
		return;
	if (x & 1)
		mask->bytes[offset] = (uint8_t)((current & 0xF0) | alpha);
	else
		mask->bytes[offset] = (uint8_t)((current & 0x0F) | (alpha << 4));
}

static double stackchanPointSegmentDistanceSquared(
	double px,
	double py,
	double x0,
	double y0,
	double x1,
	double y1
)
{
	double dx = x1 - x0;
	double dy = y1 - y0;
	double lengthSquared = (dx * dx) + (dy * dy);
	double t;
	double ox;
	double oy;

	if (lengthSquared == 0) {
		ox = px - x0;
		oy = py - y0;
		return (ox * ox) + (oy * oy);
	}

	t = (((px - x0) * dx) + ((py - y0) * dy)) / lengthSquared;
	if (t < 0)
		t = 0;
	else if (t > 1)
		t = 1;
	ox = px - (x0 + (dx * t));
	oy = py - (y0 + (dy * t));
	return (ox * ox) + (oy * oy);
}

void xs_stackchan_gray16_mask_fill_circle(xsMachine* the)
{
	StackchanGray16Mask mask;
	double cx;
	double cy;
	double radius;
	int left;
	int right;
	int top;
	int bottom;
	int x;
	int y;

	stackchanGray16GetMask(the, &mask);
	cx = xsmcToNumber(xsArg(4));
	cy = xsmcToNumber(xsArg(5));
	radius = xsmcToNumber(xsArg(6));
	if (radius <= 0)
		return;

	left = (int)fmax(0, floor(cx - radius - 1));
	right = (int)fmin(mask.width, ceil(cx + radius + 1));
	top = (int)fmax(0, floor(cy - radius - 1));
	bottom = (int)fmin(mask.height, ceil(cy + radius + 1));
	for (y = top; y < bottom; y++) {
		for (x = left; x < right; x++) {
			double dx = x + 0.5 - cx;
			double dy = y + 0.5 - cy;
			stackchanGray16AddCoverage(&mask, x, y, radius + 0.5 - sqrt((dx * dx) + (dy * dy)));
		}
	}
}

void xs_stackchan_gray16_mask_fill_round_rect(xsMachine* the)
{
	StackchanGray16Mask mask;
	double left;
	double top;
	double width;
	double height;
	double radius;
	double halfWidth;
	double halfHeight;
	double cx;
	double cy;
	double innerX;
	double innerY;
	int xStart;
	int xEnd;
	int yStart;
	int yEnd;
	int x;
	int y;

	stackchanGray16GetMask(the, &mask);
	left = xsmcToNumber(xsArg(4));
	top = xsmcToNumber(xsArg(5));
	width = xsmcToNumber(xsArg(6));
	height = xsmcToNumber(xsArg(7));
	radius = xsmcToNumber(xsArg(8));
	if ((width <= 0) || (height <= 0))
		return;

	halfWidth = width / 2;
	halfHeight = height / 2;
	cx = left + halfWidth;
	cy = top + halfHeight;
	radius = fmax(0, fmin(radius, fmin(halfWidth, halfHeight)));
	innerX = halfWidth - radius;
	innerY = halfHeight - radius;
	xStart = (int)fmax(0, floor(left - 1));
	xEnd = (int)fmin(mask.width, ceil(left + width + 1));
	yStart = (int)fmax(0, floor(top - 1));
	yEnd = (int)fmin(mask.height, ceil(top + height + 1));
	for (y = yStart; y < yEnd; y++) {
		for (x = xStart; x < xEnd; x++) {
			double qx = fabs(x + 0.5 - cx) - innerX;
			double qy = fabs(y + 0.5 - cy) - innerY;
			double outsideX = fmax(qx, 0);
			double outsideY = fmax(qy, 0);
			double distance =
				sqrt((outsideX * outsideX) + (outsideY * outsideY)) +
				fmin(fmax(qx, qy), 0) -
				radius;
			stackchanGray16AddCoverage(&mask, x, y, 0.5 - distance);
		}
	}
}

void xs_stackchan_gray16_mask_fill_rotated_ellipse(xsMachine* the)
{
	StackchanGray16Mask mask;
	double cx;
	double cy;
	double radiusX;
	double radiusY;
	double rotation;
	double extent;
	double cosine;
	double sine;
	double scale;
	int left;
	int right;
	int top;
	int bottom;
	int x;
	int y;

	stackchanGray16GetMask(the, &mask);
	cx = xsmcToNumber(xsArg(4));
	cy = xsmcToNumber(xsArg(5));
	radiusX = xsmcToNumber(xsArg(6));
	radiusY = xsmcToNumber(xsArg(7));
	rotation = xsmcToNumber(xsArg(8));
	if ((radiusX <= 0) || (radiusY <= 0))
		return;

	extent = fmax(radiusX, radiusY) + 1;
	cosine = cos(rotation);
	sine = sin(rotation);
	scale = fmin(radiusX, radiusY);
	left = (int)fmax(0, floor(cx - extent));
	right = (int)fmin(mask.width, ceil(cx + extent));
	top = (int)fmax(0, floor(cy - extent));
	bottom = (int)fmin(mask.height, ceil(cy + extent));
	for (y = top; y < bottom; y++) {
		for (x = left; x < right; x++) {
			double dx = x + 0.5 - cx;
			double dy = y + 0.5 - cy;
			double localX = (dx * cosine) + (dy * sine);
			double localY = (-dx * sine) + (dy * cosine);
			double normalized = sqrt(
				((localX * localX) / (radiusX * radiusX)) +
				((localY * localY) / (radiusY * radiusY))
			);
			stackchanGray16AddCoverage(&mask, x, y, 0.5 - ((normalized - 1) * scale));
		}
	}
}

void xs_stackchan_gray16_mask_fill_outside_aperture(xsMachine* the)
{
	StackchanGray16Mask mask;
	double topLeft;
	double topRight;
	double bottomLeft;
	double bottomRight;
	int x;

	stackchanGray16GetMask(the, &mask);
	topLeft = xsmcToNumber(xsArg(4));
	topRight = xsmcToNumber(xsArg(5));
	bottomLeft = xsmcToNumber(xsArg(6));
	bottomRight = xsmcToNumber(xsArg(7));
	memset(mask.bytes, 0xFF, mask.byteLength);

	for (x = 0; x < mask.width; x++) {
		double ratio = (x + 0.5) / mask.width;
		double top = topLeft + ((topRight - topLeft) * ratio);
		double bottom = bottomLeft + ((bottomRight - bottomLeft) * ratio);
		int topWhole = (int)floor(top);
		int bottomWhole = (int)floor(bottom);
		int y;

		for (y = 0; y < fmin(mask.height, topWhole); y++)
			stackchanGray16SetCoverage(&mask, x, y, 1);
		if ((topWhole >= 0) && (topWhole < mask.height))
			stackchanGray16SetCoverage(&mask, x, topWhole, top - topWhole);
		if ((bottomWhole >= 0) && (bottomWhole < mask.height))
			stackchanGray16AddCoverage(&mask, x, bottomWhole, 1 - (bottom - bottomWhole));
		for (y = (int)fmax(0, bottomWhole + 1); y < mask.height; y++)
			stackchanGray16SetCoverage(&mask, x, y, 1);
	}
}

void xs_stackchan_gray16_mask_stroke_segment(xsMachine* the)
{
	StackchanGray16Mask mask;
	double x0;
	double y0;
	double x1;
	double y1;
	double width;
	double radius;
	int left;
	int right;
	int top;
	int bottom;
	int x;
	int y;

	stackchanGray16GetMask(the, &mask);
	x0 = xsmcToNumber(xsArg(4));
	y0 = xsmcToNumber(xsArg(5));
	x1 = xsmcToNumber(xsArg(6));
	y1 = xsmcToNumber(xsArg(7));
	width = xsmcToNumber(xsArg(8));
	if (width <= 0)
		return;

	radius = width / 2;
	left = (int)fmax(0, floor(fmin(x0, x1) - radius - 1));
	right = (int)fmin(mask.width, ceil(fmax(x0, x1) + radius + 1));
	top = (int)fmax(0, floor(fmin(y0, y1) - radius - 1));
	bottom = (int)fmin(mask.height, ceil(fmax(y0, y1) + radius + 1));
	for (y = top; y < bottom; y++) {
		for (x = left; x < right; x++) {
			double distance = sqrt(
				stackchanPointSegmentDistanceSquared(x + 0.5, y + 0.5, x0, y0, x1, y1)
			);
			stackchanGray16AddCoverage(&mask, x, y, radius + 0.5 - distance);
		}
	}
}

void xs_stackchan_gray16_mask_fill_triangle(xsMachine* the)
{
	StackchanGray16Mask mask;
	double x0;
	double y0;
	double x1;
	double y1;
	double x2;
	double y2;
	double area;
	int left;
	int right;
	int top;
	int bottom;
	int x;
	int y;

	stackchanGray16GetMask(the, &mask);
	x0 = xsmcToNumber(xsArg(4));
	y0 = xsmcToNumber(xsArg(5));
	x1 = xsmcToNumber(xsArg(6));
	y1 = xsmcToNumber(xsArg(7));
	x2 = xsmcToNumber(xsArg(8));
	y2 = xsmcToNumber(xsArg(9));
	area = ((x1 - x0) * (y2 - y0)) - ((y1 - y0) * (x2 - x0));
	if (area == 0)
		return;

	left = (int)fmax(0, floor(fmin(x0, fmin(x1, x2)) - 1));
	right = (int)fmin(mask.width, ceil(fmax(x0, fmax(x1, x2)) + 1));
	top = (int)fmax(0, floor(fmin(y0, fmin(y1, y2)) - 1));
	bottom = (int)fmin(mask.height, ceil(fmax(y0, fmax(y1, y2)) + 1));
	for (y = top; y < bottom; y++) {
		for (x = left; x < right; x++) {
			int inside = 0;
			int sampleY;
			int sampleX;
			for (sampleY = 0; sampleY < 2; sampleY++) {
				for (sampleX = 0; sampleX < 2; sampleX++) {
					double px = x + ((sampleX + 0.5) / 2);
					double py = y + ((sampleY + 0.5) / 2);
					double a = (((x1 - px) * (y2 - py)) - ((y1 - py) * (x2 - px))) / area;
					double b = (((x2 - px) * (y0 - py)) - ((y2 - py) * (x0 - px))) / area;
					double c = 1 - a - b;
					if ((a >= 0) && (b >= 0) && (c >= 0))
						inside++;
				}
			}
			stackchanGray16AddCoverage(&mask, x, y, inside / 4.0);
		}
	}
}
