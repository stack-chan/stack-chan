import sensor from './samples/mono-sensor.avdsl?raw'
import defaultFace from '../../firmware/mods/examples/avatar-dsl/assets/default_face.avdsl?raw'
import aokkoFace from '../../firmware/mods/examples/avatar-dsl/assets/aokko_face.avdsl?raw'
import omegaMouth from '../../firmware/mods/examples/avatar-dsl/assets/omega_mouth.avdsl?raw'
import roundedEyes from './samples/rounded-eyes.avdsl?raw'
import irisLens from './samples/iris-lens.avdsl?raw'
import monoIris from './samples/mono-iris.avdsl?raw'
import compoundIris from './samples/compound-iris.avdsl?raw'

export const samples = {
  sensor,
  default: defaultFace,
  aokko: aokkoFace,
  omega: omegaMouth,
  rounded: roundedEyes,
  mono: irisLens + '\n' + monoIris,
  compound: irisLens + '\n' + compoundIris,
  minimal: `-- A bounded group clips its contents. Coordinates use a 320 x 240 canvas.
fn draw()
  begin_group(0, 0, 320, 240)
  fill_circle(100 + gaze_h * 8, 100, 16 * eye_open, primary)
  fill_circle(220 + gaze_h * 8, 100, 16 * eye_open, primary)
  fill_rect(130, 160, 60, 4 + mouth_open * 24, primary)
  end_group()
end
`,
}

export const guide = `Avatar DSL v1: Lua-style fn draw() is the entry point. Helpers use fn/end, let, if/then/elif/else/end, while/do/end, return. Comments start with --. Drawing: fill_rect(x,y,w,h,color), fill_circle(x,y,r,color), fill_triangle(x1,y1,x2,y2,x3,y3,color). begin_group(x,y,w,h) / end_group() strictly clips to x/y/width/height; nested groups intersect their clips. Dynamic inputs include eye_open, gaze_h, gaze_v, mouth_open, mouth_form, breath, expr, primary, background, canvas_w, canvas_h. Use the bundled upstream presets for full tuning examples. This editor shares the firmware compiler and C VM. Limits: 32 KiB source, 16 KiB bytecode, bounded native VM instructions/draws/calls/geometry, fixed WASM memory, four-second worker timeout. Preview validates only the selected context: other expressions may fail at runtime. Save .avdsl source or .avbc bytecode. Transfer builds a MOD archive for a host with native Avatar DSL and strict group clip, replaces its MOD, and requires a visible human confirmation plus USB permission. Agent requests only prepare that confirmation.`
