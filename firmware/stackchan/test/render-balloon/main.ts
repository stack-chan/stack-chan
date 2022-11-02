import  {Renderer}  from 'face-renderer'
import Poco from 'commodetto/Poco'
import Timer from 'timer'
import Resource from "Resource";
import parseBMF from "commodetto/parseBMF";
 
const font = parseBMF(new Resource("NotoSansCJKjp-Regular-11.bf4"))
const INTERVAL = 1000 / 30
let poco = new Poco(screen, { rotation: 90 })
const renderer = new Renderer({ poco })
const white = poco.makeColor(255, 255, 255)
const black = poco.makeColor(0, 0, 0)
const text =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.'
let textWidth = poco.getTextWidth(text, font);
let x = 0;
let w = 120;
Timer.repeat(() => {
  renderer.update(INTERVAL)
	poco.begin(0, 0, w, font.height);
    poco.fillRectangle(black, 0, 0, w, font.height);
    poco.drawText(text, font, white, -x, 0);
    if (x + w > textWidth) {
      poco.drawText(text, font, white, textWidth - x, 0);
    }
  poco.end()
  x = x > textWidth ? 0 : x + 1;
}, INTERVAL)
