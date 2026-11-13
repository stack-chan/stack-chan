import{Cr as e,br as t,ir as n,o as r,t as i}from"./globals-C7XMEsRa.js";import{a,c as o,d as s,o as c,r as l}from"./mod-builder-DEASbvei.js";var u=e(t(),1);new Uint8Array([0,3,2,1,5,4,0,0]);var d=Object.freeze([320,240,1,0,0,1,0,0,0,0,65535,0,65504,0,65535,8,0,0,0,0,0,0,50,90,4,60,1,0,10,0,0,0,0,0,0,0,0,0,0,0,0]);function f(e,t,n){return!Number.isFinite(e)||e<=t?t:e>=n?n:e}function p({width:e=320,height:t=240,circular:n=!1,variables:r={}}={}){if(!Number.isInteger(e)||!Number.isInteger(t)||e<1||t<1||e>1024||t>1024)throw Error(`AVDS: canvas size`);let i=new Float32Array(d);i[0]=e,i[1]=t,i[2]=n?Math.fround(Math.fround(Math.min(e,t)/400)*Math.fround(.97)):Math.min(e/320,t/240);let a=0;for(let e of Object.keys(r)){let t=Number(e);if(!Number.isInteger(t)||t<12||t>=41||!Number.isFinite(r[e]))throw Error(`AVDS: tuning override`);i[t]=r[e],t>=33&&(a|=1<<t-33)}let o=f(i[32],0,255)|0;i[32]=o;for(let e=0;e<8;e++)a&1<<e||(i[33+e]=o>>e&1);return i}var m=32768;function h(e){if(typeof e!=`string`)throw Error(`DSL source must be a string`);if(new TextEncoder().encode(e).length>32768)throw Error(`DSL exceeds 32 KiB`);return e}function g(e){let t=h(e),n=0,r=[];return{get source(){return t},get revision(){return n},get canUndo(){return r.length>0},replace(e,i=n){if(h(e),i!==n)throw Error(`Editor changed; read current revision before replacing`);return e===t?n:(r.push(t),r.length>20&&r.shift(),t=e,++n)},undo(){return r.length?(t=r.pop(),++n,!0):!1}}}function _(e,t=4e3){let n,r=()=>{n?.cancel(),n=void 0};return{cancel:r,run(i,a){return h(i),r(),new Promise((r,o)=>{let s=e(),c=!1,l=(e,t)=>{c||(c=!0,clearTimeout(u),s.terminate(),n=void 0,e?o(e):r(t))},u=setTimeout(()=>l(Error(`Preview timed out; simplify the DSL`)),t);n={cancel:()=>l(Error(`Preview cancelled`))},s.onmessage=({data:e})=>e.error?l(Error(e.error)):l(null,e),s.onerror=e=>l(Error(e.message||`Preview worker failed`)),s.postMessage({source:i,context:a})})}}}var v={"Mono eye":`-- SPDX-License-Identifier: Apache-2.0
-- C SENSOR: circular aperture, 9px rim, stationary 30px/18px sensor.
-- Fixed-pivot model from d2c9700; eye_open and breath run in the native VM.
-- Conservative inner sensor mask uses existing rectangles, no circle opcode.
fn sensor_band(cx,cy,q,height,width,color)
  let h = min(height,floor(q * 0.70710678))
  let w = min(width,floor(sqrt(max(0,q*q-h*h))))
  if h > 0 and w > 0 then fill_rect(cx-w,cy-h,2*w,2*h,color) end
end
fn seam(cx,cy,r,d,nx,ny)
  let vr = max(0,d) / 0.809016994
  if vr >= r-2 then return end
  -- Adjacent pentagon vertices, in screen-clockwise order.
  let ax = nx * 0.809016994 - ny * 0.587785252
  let ay = nx * 0.587785252 + ny * 0.809016994
  let bx = ax * 0.309016994 - ay * 0.951056516
  let by = ax * 0.951056516 + ay * 0.309016994
  let dx = bx-ax
  let dy = by-ay
  let length = sqrt(dx*dx+dy*dy)
  dx = dx/length
  dy = dy/length
  let x = bx*vr
  let y = by*vr
  let projection = x*dx+y*dy
  -- Endpoints sit inside the circle; AA and rounded coordinates cannot escape.
  let reach = -projection + sqrt(max(0,projection*projection+(r-2)*(r-2)-x*x-y*y))
  if reach < 1 then return end
  let ex = x+reach*dx
  let ey = y+reach*dy
  fill_triangle(round(cx+x),round(cy+y),round(cx+ex),round(cy+ey),
                round(cx+(x+ex)/2+dy*1.8),round(cy+(y+ey)/2-dx*1.8),0xc618)
end
fn draw()
  let cx = 160
  let cy = 112
  let r = 52
  let frame = 88
  let open = clamp(eye_open,0,1)
  let a = 0.97*frame*0.809016994
  let b = -0.97*frame*0.587785252
  let g = 0.15*frame
  let dx = -0.65*frame-a
  let dy = -b
  let length = sqrt(dx*dx+dy*dy)
  let pivot = sqrt(a*a+b*b)
  let k = (a*dy-b*dx)/length/pivot
  let j = (a*dx+b*dy)/length/pivot
  let t = r/pivot
  let w = sqrt(1-t*t)
  let co = t*k-w*j
  let so = t*j+w*k
  let x0 = a-0.669130606*g
  let y0 = b+0.743144825*g
  let x1 = a+g*(-0.809016994*co-0.587785252*so)
  let y1 = b+g*(-0.809016994*so+0.587785252*co)
  let n0 = sqrt(x0*x0+y0*y0)
  let n1 = sqrt(x1*x1+y1*y1)
  let ux = (1-open)*x0/n0+open*x1/n1
  let uy = (1-open)*y0/n0+open*y1/n1
  let n = sqrt(ux*ux+uy*uy)
  ux = ux/n
  uy = uy/n
  let cross = a*uy-b*ux
  let distance = a*ux+b*uy-sqrt(max(0,g*g-cross*cross))
  let vx = (distance*ux-a)/g
  let vy = (distance*uy-b)/g
  let c = -0.809016994*vx+0.587785252*vy
  let s = -0.809016994*vy-0.587785252*vx
  let unit = sqrt(c*c+s*s)
  c = c/unit
  s = s/unit
  let d = (a*dy-b*dx)/length*c+(a*dx+b*dy)/length*s
  let nx = dy/length*c+dx/length*s
  let ny = dy/length*s-dx/length*c
  let q = floor(max(0,min(r-9,d)))
  let gain = 0.25+0.75*((clamp(breath,-1,1)+1)/2)
  let sensor_frame = round(1*gain)*2048+round(18*gain)*32+round(11*gain)
  let sensor_core = round(6*gain)*2048+round(38*gain)*32+round(24*gain)
  begin_group(0,0,320,240)
  fill_circle(cx,cy,r,0x4228)
  if q > 0 then
    fill_circle(cx,cy,q,0x0842)
    sensor_band(cx,cy,q,10,15,sensor_frame)
    sensor_band(cx,cy,q,12,14,sensor_frame)
    sensor_band(cx,cy,q,14,13,sensor_frame)
    sensor_band(cx,cy,q,15,10,sensor_frame)
    sensor_band(cx,cy,q,6,9,sensor_core)
    sensor_band(cx,cy,q,8,8,sensor_core)
    sensor_band(cx,cy,q,9,6,sensor_core)
  end
  seam(cx,cy,r,d,nx,ny)
  seam(cx,cy,r,d,nx*0.309016994-ny*0.951056516,nx*0.951056516+ny*0.309016994)
  seam(cx,cy,r,d,nx*-0.809016994-ny*0.587785252,nx*0.587785252+ny*-0.809016994)
  seam(cx,cy,r,d,nx*-0.809016994+ny*0.587785252,nx*-0.587785252+ny*-0.809016994)
  seam(cx,cy,r,d,nx*0.309016994+ny*0.951056516,nx*-0.951056516+ny*0.309016994)
  end_group()
end
`,default:`-- SPDX-FileCopyrightText: 2026 Kenta IDA <fuga@fugafuga.org>
-- SPDX-License-Identifier: BSL-1.0
--
-- Default Stack-chan avatar face for the avatar_vm DSL. Bit-for-bit
-- port of the original components/avatar/{face,eye,eyebrow,mouth,effect}.cpp
-- (which were deleted when the VM took over). Authored against the 320x240
-- design space; \`tx/ty/sz\` scale to the live canvas at runtime so the same
-- bytecode drives both CoreS3 (320x240) and AtomS3R (128x128).
--
-- A \`fn draw()\` is mandatory (entry point, fn id 0). Helper functions follow.

----------------------------------------------------------------------
-- Mouth: single rectangle whose height grows with mouth_open and whose width
-- shrinks with mouth_form (0 = wide, 1 = narrow). Hosts that only drive
-- mouth_open (level meters) get mouth_form == mouth_open, i.e. the classic
-- "narrower as it opens" look; TTS vowel lip-sync sets the two independently
-- (い = wide + slightly open, う = narrow, あ = wide-ish + fully open).
-- The group box covers the maximum extent so the direct canvas strategy
-- clears stale frames correctly.
----------------------------------------------------------------------
fn mouth(cx, cy, min_w, max_w, min_h, max_h, bo)
  let h = min_h + (max_h - min_h) * mouth_open
  let w = min_w + (max_w - min_w) * (1 - mouth_form)
  let x = cx - w / 2
  let y = cy - h / 2 + breath * 2 + bo
  let gx = cx - max_w / 2 - 1
  let gy = cy - max_h / 2 - 8
  let gw = max_w + 2
  let gh = max_h + 16
  begin_group(gx, gy, gw, gh)
  fill_rect(x, y, w, h, primary)
  end_group()
end

----------------------------------------------------------------------
-- Eye: base filled circle (or short rect when closed); Angry/Sad mask
-- one upper corner with a bg triangle; Happy uses a bottom mask + a bg
-- circle cutout to leave the \`^\` arch; Sleepy uses an upper mask only.
----------------------------------------------------------------------
fn eye(center_x, center_y, r, is_left, bo)
  let cx = center_x + gaze_h * 3
  let cy = center_y + gaze_v * 3 + bo
  let half = r + 16
  begin_group(center_x - half, center_y - half, half * 2, half * 2)
  if eye_open <= 0 then
    fill_rect(cx - r, cy - 2, r * 2, 4, primary)
  else
    fill_circle(cx, cy, r, primary)
    if expr == ANGRY or expr == SAD then
      let flip = is_left ~= (expr == ANGRY)
      let x2 = cx + r
      if flip then x2 = cx - r end
      fill_triangle(cx - r, cy - r, cx + r, cy - r, x2, cy, background)
    elif expr == HAPPY then
      fill_rect(cx - r, cy, r * 2 + 4, r + 2, background)
      fill_circle(cx, cy, round(r / 1.5), background)
    elif expr == SLEEPY then
      fill_rect(cx - r, cy - r, r * 2 + 4, r + 2, background)
    end
  end
  end_group()
end

----------------------------------------------------------------------
-- Eyebrow: simple bar most of the time; Angry/Sad split it into two
-- triangles to form a tilted parallelogram. The is_left/Sad XOR gives
-- the per-side direction; Happy nudges the bar up by 5 px.
----------------------------------------------------------------------
fn eyebrow(cx, cy_base, w, h, is_left, bo)
  let cy = cy_base + bo
  let hw = w / 2 + 6
  let hh = h / 2 + 12
  begin_group(cx - hw, cy_base - hh, hw * 2, hh * 2)
  if expr == ANGRY or expr == SAD then
    let aspect = 1
    if is_left ~= (expr == SAD) then aspect = -1 end
    let dx = aspect * 3
    let dy = aspect * 5
    let x1 = cx - w / 2
    let x4 = cx + w / 2
    let x2 = x1 - dx
    let x3 = x4 + dx
    let y1 = cy - h / 2 - dy
    let y2 = cy + h / 2 - dy
    let y3 = cy - h / 2 + dy
    let y4 = cy + h / 2 + dy
    fill_triangle(x1, y1, x2, y2, x3, y3, primary)
    fill_triangle(x2, y2, x3, y3, x4, y4, primary)
  else
    let happy_off = 0
    if expr == HAPPY then happy_off = -5 end
    let x = cx - w / 2
    let y = cy - h / 2 + happy_off
    fill_rect(x, y, w, h, primary)
  end
  end_group()
end

----------------------------------------------------------------------
-- Per-expression effect helpers (top-right anchors). Each takes pre-
-- scaled screen coords + a pre-scaled radius. \`offset\` is the breath
-- phase used to pulse the marks.
----------------------------------------------------------------------
fn draw_sweat(x, y, r, offset, color)
  let yy = y + floor(offset * 5)
  let rr = r + floor(r * 0.2 * offset)
  let a = sqrt(3) * rr / 2
  fill_circle(x, yy, round(rr), color)
  fill_triangle(x, yy - rr * 2, x - a, yy - rr * 0.5, x + a, yy - rr * 0.5, color)
end

fn draw_anger(cx, cy, r, offset, fg, bg)
  let rr = r + r * 0.4 * offset
  -- Outer cross.
  fill_rect(cx - rr / 3, cy - rr, rr * 2 / 3, rr * 2, fg)
  fill_rect(cx - rr, cy - rr / 3, rr * 2, rr * 2 / 3, fg)
  -- Inner symmetric cutout (clean \`#\`).
  fill_rect(cx - rr / 3 + 2, cy - rr, rr * 2 / 3 - 4, rr * 2, bg)
  fill_rect(cx - rr, cy - rr / 3 + 2, rr * 2, rr * 2 / 3 - 4, bg)
end

fn draw_chill(x, y, r, offset, color)
  let h = r + abs(r * 0.2 * offset)
  let h_half = round(h / 2)
  fill_rect(x - h_half, y, 3, h_half, color)
  fill_rect(x, y, 3, h * 3 / 4, color)
  fill_rect(x + h_half, y, 3, h, color)
end

fn draw_bubble(x, y, r, offset, color)
  let rr = r + floor(r * 0.2 * offset)
  let r_small = round(rr / 4)
  fill_circle(x, y, rr, color)
  fill_circle(x, y, r_small, color)
end

fn draw_heart(x, y, r, offset, color)
  let rr = r + r * 0.4 * offset
  let a = rr * 1.41421356 / 4
  let lobe_r = round(rr / 2)
  fill_circle(x - rr / 2, y, lobe_r, color)
  fill_circle(x + rr / 2, y, lobe_r, color)
  fill_triangle(x, y, x - rr / 2 - a, y + a, x + rr / 2 + a, y + a, color)
  fill_triangle(x, y + rr / 2 + 2 * a, x - rr / 2 - a, y + a, x + rr / 2 + a, y + a, color)
end

fn effect()
  if expr == NEUTRAL then return end
  let gx = tx(236)
  let gy = ty(-8)
  let gw = canvas_w - gx
  let gh = ty(136) - gy
  begin_group(gx, gy, gw, gh)
  if expr == HAPPY then
    draw_heart(tx(280), ty(50), sz(12), breath, primary)
  elif expr == DOUBT then
    draw_sweat(tx(290), ty(110), sz(7), breath, primary)
  elif expr == ANGRY then
    draw_anger(tx(280), ty(50), sz(12), breath, primary, background)
  elif expr == SAD then
    draw_chill(tx(270), ty(0), sz(30), breath, primary)
  elif expr == SLEEPY then
    draw_bubble(tx(290), ty(40), sz(10), breath, primary)
    draw_bubble(tx(270), ty(52), sz(6),  breath, primary)
  end
  end_group()
end

----------------------------------------------------------------------
-- Accessory slot 0: cat collar — a red band across the bottom of the
-- screen with a gold bell hanging from its centre. Static (no breath
-- offset): it sits on the "neck", not the face. Drawn last so it paints
-- over the mouth / effects. Enable via FaceTuning accessories bit 0
-- (settings UI "アクセサリ 1", JSON "acc": 1).
----------------------------------------------------------------------
fn collar()
  let band_y = ty(214)
  let band_h = sz(24)
  let gx = tx(0)
  let gw = sz(320)
  begin_group(gx, band_y - sz(14), gw, band_h + sz(16) + sz(14))
  fill_rect(gx, band_y, gw, band_h, 0xF800)
  -- bell: gold disc on the band, dark slit + clapper dot below
  let bx = tx(160)
  let by = ty(224)
  let br = sz(13)
  fill_circle(bx, by, br, 0xFEA0)
  fill_rect(bx - sz(9), by - sz(1), sz(18), sz(2), 0x8200)
  fill_circle(bx, by + sz(8), sz(3), 0x8200)
  end_group()
end

----------------------------------------------------------------------
-- Entry point. The effect group is drawn FIRST: its box (x >= 236)
-- overlaps the right eye / eyebrow groups, and clearing it after they
-- have been drawn wiped their right edge every frame (visible flicker
-- on the right eyebrow). Painting the effect first lets the eye and
-- eyebrow groups repaint over the overlap. Remaining order matches
-- face.cpp:50-58 (mouth, eyes, eyebrows). Balloon is drawn by the C++
-- side after this returns.
----------------------------------------------------------------------
fn draw()
  effect()
  let bo = breath * 3
  -- mouth (max_w / max_h clamped to >= min in face.cpp; mirror that).
  mouth(tx(163 + mouth_off_x), ty(148 + mouth_off_y),
        sz(mouth_min_w), sz(max(mouth_min_w, mouth_max_w)),
        sz(mouth_min_h), sz(max(mouth_min_h, mouth_max_h)),
        bo)
  -- eyes. Face.cpp puts the x=230 eye on \`eye_left\` with is_left=false
  -- (m5stack-avatar-rs naming convention) and the x=90 eye on the right.
  let er = sz(eye_radius)
  eye(tx(230 + eye_off_x), ty(96 + eye_off_y), er, false, bo)
  eye(tx(90  - eye_off_x), ty(93 + eye_off_y), er, true,  bo)
  -- eyebrows (skip when hidden by FaceTuning).
  if eyebrows_visible then
    let bw = sz(32)
    let bh = sz(2)
    -- Eyebrow is_left flags in face.cpp are swapped relative to the eyes
    -- (see face.cpp:40-41); replicate that here to keep Angry/Sad tilts
    -- pixel-identical to the old C++.
    eyebrow(tx(96  - brow_off_x), ty(67 + brow_off_y), bw, bh, false, bo)
    eyebrow(tx(230 + brow_off_x), ty(72 + brow_off_y), bw, bh, true,  bo)
  end
  -- Optional cheek marks (off by default — opt-in via FaceTuning so the
  -- standard face is unchanged for existing users). Same horizontal-
  -- symmetric layout as the eyes / brows: positive cheek_off_x spreads
  -- the pair outward. Drawn as soft filled circles in primary colour.
  if cheeks_visible then
    let cr = sz(cheek_radius)
    -- Resting cheek baseline at y=140 in 320x240 design space, just
    -- below the eyes and above the mouth.
    fill_circle(tx(90  - cheek_off_x), ty(140 + cheek_off_y), cr, primary)
    fill_circle(tx(230 + cheek_off_x), ty(140 + cheek_off_y), cr, primary)
  end
  -- accessories (FaceTuning slots; slot 0 = collar + bell)
  if accessory_0 then collar() end
end
`,aokko:`-- SPDX-FileCopyrightText: 2026 Kenta IDA <fuga@fugafuga.org>
-- SPDX-License-Identifier: BSL-1.0
--
-- Aokko-style face preset for the avatar_vm DSL. **Coord values and color
-- palette pattern are inspired by \`mongonta0716/m5stack-avatar-mic-nekomimi_led\`
-- branch \`aokkoface\` (MIT 2024 washishi)** — only the numeric facts (eye /
-- mouth / cheek geometry) are referenced; no upstream source code is copied.
-- The implementation here is original to stay BSL-1.0 single-licensed.
--
-- Design highlights vs default_face.avdsl:
--   * Eyes are tall vertical pills (a "capsule" composed of one rect + two
--     end-cap circles). The 1:3 width:height ratio mirrors aokko-face's
--     EllipseEye(18, 54). Width is driven by \`eye_radius\` so FaceTuning still
--     lets the operator scale the eyes globally.
--   * Cheeks are 6-pointed stars (hexagram, "Star of David"), drawn as two
--     overlapping equilateral triangles via fill_triangle.
--   * Mouth uses default's rectangle scheme but with the wider min/max range
--     the upstream uses (50..90 wide, 4..60 tall) so big mouth_open values
--     look right against the taller eye silhouette.
--   * No eyebrows, no expression effect marks. The upstream design is a
--     "music-synced LED dancer" — expressions are intentionally minimal. The
--     only expression-aware branch is HAPPY squinting the eyes.
--
-- Usage:
--   * Compile + ship to a running device via the Wi-Fi settings page
--     ("顔描画 DSL" textarea → "コンパイル & 送信"), or POST the bytecode
--     directly to /api/avatar-dsl.
--   * Live preview in browser via wasm/avatar.html (this file is registered
--     as the "aokko" preset there — see wasm/build.sh).

----------------------------------------------------------------------
-- Vertical-pill ("ellipse-approx") eye **with 3-bar eyelashes**.
--   w = full horizontal extent of the pill (pixels). Snapped to the
--       nearest odd value internally so the cap circle bounding box
--       (2*r + 1) and the body rect width match exactly — without the
--       snap, fill_rect(x, y, 2*r, h) covers 2*r columns while
--       fill_circle(cx, cy, r) covers 2*r + 1 columns, leaving a 1-px
--       step at the cap/body join.
--   h = full vertical extent. Same odd-snap applies to the height span.
-- When h < w the pill degrades into a circle of radius r (trim clamps to 0).
--
-- gaze_h / gaze_v shift the pill **and the eyelashes together** — in this
-- stylized face the "eye" is the pupil substitute, so saccade moves the
-- whole eye block including the lashes (anatomically not strictly right,
-- but it's the avatar convention). bbox is sized asymmetrically (taller
-- on top) to clear the lash region while keeping the bottom tight, and
-- has enough slack for the max gaze + breath excursion.
----------------------------------------------------------------------
fn ellipse_eye(center_x, center_y, w, h, color, bo)
  let cx = center_x + gaze_h * 3
  let cy = center_y + gaze_v * 3 + bo
  -- Cap radius. Choosing r = floor(w / 2) means the cap circle's pixel
  -- diameter (2*r + 1) is the largest odd value <= w + 1, which is what
  -- we use as the body rect width below so caps and body align column-
  -- for-column.
  let r = floor(w / 2)
  let body_w = r * 2 + 1
  -- Vertical: half-height in whole pixels, plus the same odd-snap idea.
  -- trim is the distance from the eye center to each cap center, so the
  -- total vertical span [cy - trim - r, cy + trim + r] is 2*(trim + r) + 1.
  let half_h_pix = floor(h / 2)
  let trim = half_h_pix - r
  if trim < 0 then trim = 0 end
  -- Eyelash geometry (proportional to eye width so it scales with FaceTuning).
  let lash_t = max(1, round(w / 8))      -- thickness per lash bar
  let lash_len = max(3, round(w * 0.6))  -- vertical length
  let lash_half_t = floor(lash_t / 2)
  let lash_spread = round(w / 3)         -- distance from center to side lash
  -- Lashes anchor a few pixels below the eye rim so they "sprout" from the
  -- eyelid rather than float above it. Side lashes drop a bit more than the
  -- center one, giving the 3-bar set a subtle ⌒-fan shape. Both drops scale
  -- with lash_len so the proportions hold at AtomS3R / StopWatch sizes too.
  let lash_drop_center = max(1, round(lash_len * 0.3))
  let lash_drop_side   = max(1, round(lash_len * 0.25))
  let lash_y_center = cy - half_h_pix - lash_len + lash_drop_center
  let lash_y_side   = lash_y_center
  -- Asymmetric bbox: extra room on top for lashes, tight on bottom.
  let pad_x = r + 12
  let top_pad = half_h_pix + lash_len + 12
  let bot_pad = half_h_pix + 12
  begin_group(center_x - pad_x, center_y - top_pad, pad_x * 2, top_pad + bot_pad)
  if eye_open <= 0 then
    -- Closed: short flat line (matches default_face's blink convention),
    -- width matched to the open-eye width so blinks don't pulse sideways.
    fill_rect(cx - r, cy - 2, body_w, 4, color)
    -- Closed-state lashes: all 3 share the same length and bottom y so they
    -- read as a tidy "|||" attached to the closed lid. The ⌒-fan shape of
    -- the open state would look wrong here (no eyeball to flank).
    let closed_lash_y = cy - 2 - lash_len
    fill_rect(cx - lash_spread - lash_half_t, closed_lash_y, lash_t, lash_len, color)
    fill_rect(cx + lash_spread - lash_half_t, closed_lash_y, lash_t, lash_len, color)
    fill_rect(cx               - lash_half_t, closed_lash_y, lash_t, lash_len, color)
  else
    if trim > 0 then
      -- Body rect spans rows [cy - trim, cy + trim - 1] (= 2*trim px) and
      -- overlaps each cap by r rows, so the union has no gap regardless of
      -- trim. body_w pairs with the cap diameter exactly.
      fill_rect(cx - r, cy - trim, body_w, trim * 2, color)
    end
    fill_circle(cx, cy - trim, r, color)
    fill_circle(cx, cy + trim, r, color)
    if expr == HAPPY then
      -- Cover the lower portion to leave a \`⌒\` arch — same trick as
      -- default_face's HAPPY masking, adapted to the taller silhouette.
      -- +1 px slack on each side so the mask outpaces the cap rim.
      fill_rect(cx - r - 1, cy, body_w + 2, half_h_pix + 2, background)
    end
    -- Open-state lashes: side bars extend further down than the center for
    -- a subtle ⌒-fan. Draw sides first, center on top so any aliasing at
    -- the join reads cleanly.
    fill_rect(cx - lash_spread - lash_half_t, lash_y_side,   lash_t, lash_len + lash_drop_side, color)
    fill_rect(cx + lash_spread - lash_half_t, lash_y_side,   lash_t, lash_len + lash_drop_side, color)
    fill_rect(cx               - lash_half_t, lash_y_center, lash_t, lash_len                 , color)
  end
  end_group()
end

----------------------------------------------------------------------
-- Hexagram (Star of David) cheek: two overlapping equilateral triangles,
-- one apex-up, one apex-down. r is the circumradius of each triangle so
-- the visible star is bound by a 2r × 2r square (plus 1 px slack for the
-- AA-ish snapping the filled-triangle primitive does).
----------------------------------------------------------------------
fn hexagram_cheek(cx, cy, r, color)
  -- Vertical and horizontal extents are slightly asymmetric for an
  -- equilateral triangle (apex farther from center than the base edge),
  -- but the union of the up- and down-triangle covers a square of side 2r.
  let half = round(r) + 1
  begin_group(cx - half, cy - half, half * 2, half * 2)
  let a = sqrt(3) * r / 2  -- half of the base edge
  let half_r = r / 2
  -- Apex-up.
  fill_triangle(cx, cy - r, cx - a, cy + half_r, cx + a, cy + half_r, color)
  -- Apex-down.
  fill_triangle(cx, cy + r, cx - a, cy - half_r, cx + a, cy - half_r, color)
  end_group()
end

----------------------------------------------------------------------
-- Mouth: same rectangle scheme as default_face but with a wider min/max
-- range so the open-mouth state reads against the taller eyes.
----------------------------------------------------------------------
fn mouth_rect(cx, cy, min_w, max_w, min_h, max_h, bo)
  let h = min_h + (max_h - min_h) * mouth_open
  let w = min_w + (max_w - min_w) * (1 - mouth_open)
  let x = cx - w / 2
  let y = cy - h / 2 + breath * 2 + bo
  let gx = cx - max_w / 2 - 1
  let gy = cy - max_h / 2 - 8
  let gw = max_w + 2
  let gh = max_h + 16
  begin_group(gx, gy, gw, gh)
  fill_rect(x, y, w, h, primary)
  end_group()
end

----------------------------------------------------------------------
-- Entry point.
-- Upstream aokko-face anchors (320×240 design space, from research §2.1):
--   left  eye    (x= 90, y= 96)
--   right eye    (x=230, y= 96)
--   mouth        (x=163, y=148)   Mouth(50, 90, 4, 60)
--   left  cheek  (x= 65, y=153)   r=10 hexagram
--   right cheek  (x=255, y=153)
-- All coords flow through tx/ty so the same bytecode scales to any panel
-- (CoreS3 320×240, AtomS3R 128×128, future StopWatch 466×466).

----------------------------------------------------------------------
-- Accessory slot 0: cat collar — a red band across the bottom of the
-- screen with a gold bell hanging from its centre. Static (no breath
-- offset): it sits on the "neck", not the face. Drawn last so it paints
-- over the mouth / effects. Enable via FaceTuning accessories bit 0
-- (settings UI "アクセサリ 1", JSON "acc": 1).
----------------------------------------------------------------------
fn collar()
  let band_y = ty(214)
  let band_h = sz(24)
  let gx = tx(0)
  let gw = sz(320)
  begin_group(gx, band_y - sz(14), gw, band_h + sz(16) + sz(14))
  fill_rect(gx, band_y, gw, band_h, 0xF800)
  -- bell: gold disc on the band, dark slit + clapper dot below
  let bx = tx(160)
  let by = ty(224)
  let br = sz(13)
  fill_circle(bx, by, br, 0xFEA0)
  fill_rect(bx - sz(9), by - sz(1), sz(18), sz(2), 0x8200)
  fill_circle(bx, by + sz(8), sz(3), 0x8200)
  end_group()
end

----------------------------------------------------------------------
fn draw()
  let bo = breath * 3

  -- Mouth — upstream's wider 50..90 / 4..60 envelope (overrides FaceTuning
  -- mouth_* on purpose so the aokko shape stays recognizable).
  mouth_rect(tx(163 + mouth_off_x), ty(148 + mouth_off_y),
             sz(50), sz(90), sz(4), sz(60), bo)

  -- Eyes — vertical pill. eye_radius is the existing FaceTuning hook
  -- (semantically a half-width radius), so the full pill width is 2×
  -- eye_radius; height keeps aokko's 1:3 aspect for a 6× factor.
  let ew = sz(eye_radius * 2)
  let eh = sz(eye_radius * 6)
  ellipse_eye(tx(230 + eye_off_x), ty(96 + eye_off_y), ew, eh, primary, bo)
  ellipse_eye(tx(90  - eye_off_x), ty(96 + eye_off_y), ew, eh, primary, bo)

  -- Cheeks — hexagram. Honor FaceTuning's cheek_* knobs so the operator can
  -- toggle / move / resize them alongside default_face's circle cheeks.
  -- cheeks_visible defaults OFF in FaceTuning, so users switching to this
  -- preset must enable it to see the aokko hallmark stars (the Wi-Fi /
  -- BLE settings UI has the toggle in the avatar tab).
  if cheeks_visible then
    let cr = sz(cheek_radius)
    hexagram_cheek(tx(65  - cheek_off_x), ty(153 + cheek_off_y) + bo, cr, primary)
    hexagram_cheek(tx(255 + cheek_off_x), ty(153 + cheek_off_y) + bo, cr, primary)
  end
  -- accessories (FaceTuning slots; slot 0 = collar + bell)
  if accessory_0 then collar() end
end
`,omega:`-- SPDX-FileCopyrightText: 2026 Kenta IDA <fuga@fugafuga.org>
-- SPDX-License-Identifier: BSL-1.0
--
-- 別の顔のサンプル: 口を ω 形に。
-- assets/default_face.avdsl のうち \`mouth(...)\` 関数だけを \`mouth_omega(...)\`
-- に置き換えた版。目 / 眉 / 表情エフェクトは default と同一なので、見比べると
-- DSL で「パーツを 1 つだけ差し替える」やり方の参考になる。
--
-- 使い方:
--   1. avatar.html もしくは Wi-Fi 設定ページ「顔描画 DSL」セクションの
--      テキスト エリアに本ファイルの内容を貼付け
--   2. 「コンパイル & 適用」 (avatar.html) または「コンパイル & 送信」
--      (Wi-Fi 設定) で反映
--   3. テキスト下の「.avbc ダウンロード」で生成バイトコードを保存して
--      curl で送ることもできる
--
-- ω 形の合成手順:
--   1. 左右に塗りつぶし円を 2 つ並べる (ロブ)
--   2. 内側を 1 回り小さい bg 円で刳り抜いて「リング」化
--   3. リングの上半分を bg 矩形でマスク → 下半分の弧 (∪) が残る
--   4. 2 つの ∪ の間に bg 三角形を上向きに置いて中央の谷を作る
--      → ω の中央ピーク (細い ∧)
--   5. mouth_open > 0 のとき:
--      - ロブ半径と中央ピーク高さを少し増やす
--      - ω の左右外端から下に「壁」と、最下端を結ぶ「床」を追加
--        → ω の下に「開いた口の内部」が現れて全体が縦に伸びる。

----------------------------------------------------------------------
-- 共通パーツ (default_face.avdsl から流用)
----------------------------------------------------------------------

fn eye(center_x, center_y, r, is_left, bo)
  let cx = center_x + gaze_h * 3
  let cy = center_y + gaze_v * 3 + bo
  let half = r + 16
  begin_group(center_x - half, center_y - half, half * 2, half * 2)
  if eye_open <= 0 then
    fill_rect(cx - r, cy - 2, r * 2, 4, primary)
  else
    fill_circle(cx, cy, r, primary)
    if expr == ANGRY or expr == SAD then
      let flip = is_left ~= (expr == ANGRY)
      let x2 = cx + r
      if flip then x2 = cx - r end
      fill_triangle(cx - r, cy - r, cx + r, cy - r, x2, cy, background)
    elif expr == HAPPY then
      fill_rect(cx - r, cy, r * 2 + 4, r + 2, background)
      fill_circle(cx, cy, round(r / 1.5), background)
    elif expr == SLEEPY then
      fill_rect(cx - r, cy - r, r * 2 + 4, r + 2, background)
    end
  end
  end_group()
end

fn eyebrow(cx, cy_base, w, h, is_left, bo)
  let cy = cy_base + bo
  let hw = w / 2 + 6
  let hh = h / 2 + 12
  begin_group(cx - hw, cy_base - hh, hw * 2, hh * 2)
  if expr == ANGRY or expr == SAD then
    let aspect = 1
    if is_left ~= (expr == SAD) then aspect = -1 end
    let dx = aspect * 3
    let dy = aspect * 5
    let x1 = cx - w / 2
    let x4 = cx + w / 2
    let x2 = x1 - dx
    let x3 = x4 + dx
    let y1 = cy - h / 2 - dy
    let y2 = cy + h / 2 - dy
    let y3 = cy - h / 2 + dy
    let y4 = cy + h / 2 + dy
    fill_triangle(x1, y1, x2, y2, x3, y3, primary)
    fill_triangle(x2, y2, x3, y3, x4, y4, primary)
  else
    let happy_off = 0
    if expr == HAPPY then happy_off = -5 end
    let x = cx - w / 2
    let y = cy - h / 2 + happy_off
    fill_rect(x, y, w, h, primary)
  end
  end_group()
end

fn draw_sweat(x, y, r, offset, color)
  let yy = y + floor(offset * 5)
  let rr = r + floor(r * 0.2 * offset)
  let a = sqrt(3) * rr / 2
  fill_circle(x, yy, round(rr), color)
  fill_triangle(x, yy - rr * 2, x - a, yy - rr * 0.5, x + a, yy - rr * 0.5, color)
end

fn draw_anger(cx, cy, r, offset, fg, bg)
  let rr = r + r * 0.4 * offset
  fill_rect(cx - rr / 3, cy - rr, rr * 2 / 3, rr * 2, fg)
  fill_rect(cx - rr, cy - rr / 3, rr * 2, rr * 2 / 3, fg)
  fill_rect(cx - rr / 3 + 2, cy - rr, rr * 2 / 3 - 4, rr * 2, bg)
  fill_rect(cx - rr, cy - rr / 3 + 2, rr * 2, rr * 2 / 3 - 4, bg)
end

fn draw_chill(x, y, r, offset, color)
  let h = r + abs(r * 0.2 * offset)
  let h_half = round(h / 2)
  fill_rect(x - h_half, y, 3, h_half, color)
  fill_rect(x, y, 3, h * 3 / 4, color)
  fill_rect(x + h_half, y, 3, h, color)
end

fn draw_bubble(x, y, r, offset, color)
  let rr = r + floor(r * 0.2 * offset)
  let r_small = round(rr / 4)
  fill_circle(x, y, rr, color)
  fill_circle(x, y, r_small, color)
end

fn draw_heart(x, y, r, offset, color)
  let rr = r + r * 0.4 * offset
  let a = rr * 1.41421356 / 4
  let lobe_r = round(rr / 2)
  fill_circle(x - rr / 2, y, lobe_r, color)
  fill_circle(x + rr / 2, y, lobe_r, color)
  fill_triangle(x, y, x - rr / 2 - a, y + a, x + rr / 2 + a, y + a, color)
  fill_triangle(x, y + rr / 2 + 2 * a, x - rr / 2 - a, y + a, x + rr / 2 + a, y + a, color)
end

fn effect()
  if expr == NEUTRAL then return end
  let gx = tx(236)
  let gy = ty(-8)
  let gw = canvas_w - gx
  let gh = ty(136) - gy
  begin_group(gx, gy, gw, gh)
  if expr == HAPPY then
    draw_heart(tx(280), ty(50), sz(12), breath, primary)
  elif expr == DOUBT then
    draw_sweat(tx(290), ty(110), sz(7), breath, primary)
  elif expr == ANGRY then
    draw_anger(tx(280), ty(50), sz(12), breath, primary, background)
  elif expr == SAD then
    draw_chill(tx(270), ty(0), sz(30), breath, primary)
  elif expr == SLEEPY then
    draw_bubble(tx(290), ty(40), sz(10), breath, primary)
    draw_bubble(tx(270), ty(52), sz(6),  breath, primary)
  end
  end_group()
end

----------------------------------------------------------------------
-- ω 形 の口 (この サンプルの本体)
----------------------------------------------------------------------
--
-- パラメータ:
--   cx, cy : 口の中心 (スケーリング後の実画面座標)
--   color  : 線色 (= primary)
--   bg     : 刳り抜き / マスク 色 (= background)
--   bo     : 呼吸オフセット (breath * 3)
--
-- リング厚 / ロブ半径 / 中央ピーク高さ を mouth_open で動かしているので、
-- 喋ると ω が開閉する。

fn mouth_omega(cx, cy, color, bg, bo)
  let m = mouth_open                  -- 0..1
  let r = sz(8 + m * 3)               -- ロブ半径 (開くとやや大きく)
  let dx = sz(9 + m * 2)              -- 中心からロブ中心までの距離
  let thick = max(1, round(r * 0.35)) -- リングの線太さ
  let my = cy + bo
  let ext = sz(m * 22)                -- 縦方向の伸び (m=0 で 0、m=1 で大きく)

  -- Strict clip includes both lobes and the floor at my + 1 + ext * 2.
  -- グループ bbox: ω 本体 + 下方への伸び ext + 床 thick + 余白 を覆う。
  -- ※ DirectCanvas (PSRAM 無) はこの bbox 内のみクリアするので、開閉で
  --    最大に伸びる範囲を漏らさず覆っておかないと前フレームの残骸が出る。
  let gw_half = dx + r + 2
  begin_group(cx - gw_half, my - r - 2, gw_half * 2, r + max(r, 1 + ext * 2 + thick) + 4)

  -- 1) 左右に塗りつぶし円 (ロブ本体)
  fill_circle(cx - dx, my, r, color)
  fill_circle(cx + dx, my, r, color)

  -- 2) 内側を bg 円で刳り抜いてリング化
  let ri = max(1, r - thick)
  fill_circle(cx - dx, my, ri, bg)
  fill_circle(cx + dx, my, ri, bg)

  -- 3) リングの上半分を bg 矩形でマスク → 下半分の ∪ 弧が残る
  fill_rect(cx - dx - r, my - r, r * 2, r, bg)
  fill_rect(cx + dx - r, my - r, r * 2, r, bg)

  -- 4) 2 つの ∪ の間に三角形を上向きに → 中央ピーク (∧)
  --    foot は ロブ外周 と ぶつからない位置に。開くと中央ピークも少し高く。
  let peak_h = sz(5 + m * 4)
  let foot_l = cx - dx + r - max(1, thick - 1)
  let foot_r = cx + dx - r + max(1, thick - 1)
  fill_triangle(foot_l, my, foot_r, my, cx, my - peak_h, color)

  -- 5) 開口部 (mouth_open による縦伸び)
  --    壁 + 床。ただし「床の自然位置 (my + 1 + ext)」が ω 下端 (my + r)
  --    を超えるまでは何も描かない — そうしないと小さな開きで床がロブの
  --    途中を横切って見栄えが悪い。条件成立後は:
  --      ・壁は左右ロブの底接点 (cx ± dx, my + r) から下方に伸びる
  --        (外端 cx ± (dx + r) から伸ばすと、その x ではロブが ω 下端
  --         まで存在しないので壁が宙ぶらりんに見える)
  --      ・床はその壁の下端を渡し、幅は左壁外〜右壁外
  --    閾値前: 純粋な ω のまま (mouth_open が 0.4 弱までは見た目変化なし)
  let omega_bottom = my + r
  let floor_y = my + 1 + ext*2
  if floor_y > omega_bottom then
    let visible_ext = floor_y - omega_bottom + 1
    let half_t = floor(thick / 2)
    let wall_xl = cx - dx - half_t
    let wall_xr = cx + dx - half_t
    fill_rect(wall_xl, omega_bottom, thick, visible_ext, color)
    fill_rect(wall_xr, omega_bottom, thick, visible_ext, color)
    fill_rect(wall_xl, floor_y, dx * 2 + thick, thick, color)
  end

  end_group()
end

----------------------------------------------------------------------
-- エントリ


----------------------------------------------------------------------

----------------------------------------------------------------------
-- Accessory slot 0: cat collar — a red band across the bottom of the
-- screen with a gold bell hanging from its centre. Static (no breath
-- offset): it sits on the "neck", not the face. Drawn last so it paints
-- over the mouth / effects. Enable via FaceTuning accessories bit 0
-- (settings UI "アクセサリ 1", JSON "acc": 1).
----------------------------------------------------------------------
fn collar()
  let band_y = ty(214)
  let band_h = sz(24)
  let gx = tx(0)
  let gw = sz(320)
  begin_group(gx, band_y - sz(14), gw, band_h + sz(16) + sz(14))
  fill_rect(gx, band_y, gw, band_h, 0xF800)
  -- bell: gold disc on the band, dark slit + clapper dot below
  let bx = tx(160)
  let by = ty(224)
  let br = sz(13)
  fill_circle(bx, by, br, 0xFEA0)
  fill_rect(bx - sz(9), by - sz(1), sz(18), sz(2), 0x8200)
  fill_circle(bx, by + sz(8), sz(3), 0x8200)
  end_group()
end

fn draw()
  let bo = breath * 3

  -- 目 (default と同じ)
  let er = sz(eye_radius)
  eye(tx(230 + eye_off_x), ty(96 + eye_off_y), er, false, bo)
  eye(tx(90  - eye_off_x), ty(93 + eye_off_y), er, true,  bo)

  -- 眉 (default と同じ)
  if eyebrows_visible then
    let bw = sz(32)
    let bh = sz(2)
    eyebrow(tx(96  - brow_off_x), ty(67 + brow_off_y), bw, bh, false, bo)
    eyebrow(tx(230 + brow_off_x), ty(72 + brow_off_y), bw, bh, true,  bo)
  end

  -- 口だけ ω 形に差し替え
  mouth_omega(tx(160 + mouth_off_x), ty(148 + mouth_off_y), primary, background, bo)

  effect()
  -- accessories (FaceTuning slots; slot 0 = collar + bell)
  if accessory_0 then collar() end
end
`,rounded:`-- SPDX-License-Identifier: Apache-2.0
-- Original rounded rectangle eyes; no third-party artwork or new DSL opcode.
-- eye_open follows the host's blink (1 -> 0 -> 1). In the editor use Eye open.
-- gaze_h / gaze_v move both eyes. HAPPY and SLEEPY squint.
-- Change primary to 0x07ff below if you prefer a fixed cyan face.

-- Rounded rectangle made from the existing rectangles and circles.
-- Ignore empty sizes; clamp radius so a closed eye remains a safe pill.
fn rounded_rect(x, y, w, h, radius, color)
  if w <= 0 or h <= 0 then return end
  let r = min(max(radius, 0), min(w, h) / 2)
  if r <= 0 then
    fill_rect(x, y, w, h, color)
    return
  end
  fill_rect(x + r, y, w - 2 * r, h, color)
  fill_rect(x, y + r, w, h - 2 * r, color)
  fill_circle(x + r, y + r, r, color)
  fill_circle(x + w - r, y + r, r, color)
  fill_circle(x + r, y + h - r, r, color)
  fill_circle(x + w - r, y + h - r, r, color)
end

fn rounded_eye(center_x)
  let openness = min(max(eye_open, 0), 1)
  let w = sz(52)
  let h = sz(4 + 56 * openness)
  if expr == HAPPY then
    w = sz(52 + 6 * openness)
    h = sz(4 + 14 * openness)
  elif expr == SLEEPY then
    h = sz(4 + 10 * openness)
  end
  -- tx/ty scale signed positions. sz has a minimum of 1: sizes only.
  let cx = tx(center_x + 8 * min(max(gaze_h, -1), 1))
  let cy = ty(112 + 7 * min(max(gaze_v, -1), 1))
  -- Fixed maximum damage/clip box: clears old pixels during blink and gaze.
  begin_group(tx(center_x - 42), ty(66), sz(84), sz(92))
  rounded_rect(cx - w / 2, cy - h / 2, w, h, sz(12), primary)
  end_group()
end

fn draw()
  rounded_eye(104)
  rounded_eye(216)
end
`,compound:`-- SPDX-License-Identifier: Apache-2.0
-- Five rigid straight-edged leaves; fixed pivots and one radial-slot drive ring.
-- Triangles approximate curved leaf profiles; a fixed cover clips their tails.
-- Six primitives per lens. The parent preset draws one shared front plate.
-- Fixed-pivot five-leaf iris, radial-slot drive-ring approximation.
fn iris_leaf(cx,cy,r,ux,uy,c,s)
  let a = 0.97 * r * 0.809016994
  let b = -0.97 * r * 0.587785252
  let qt = -2 * b
  let dx = -0.65 * r - a
  let dy = -b
  let qx = a - s * qt
  let qy = b + c * qt
  let txp = a + c * dx - s * dy
  let typ = b + s * dx + c * dy
  fill_triangle(cx + ux*a - uy*b, cy + uy*a + ux*b,
                cx + ux*qx - uy*qy, cy + uy*qx + ux*qy,
                cx + ux*txp - uy*typ, cy + uy*txp + ux*typ, 0x4228)
end
fn iris_lens(cx,cy,r)
  if r <= 0 then return end
  let open = clamp(eye_open,0,1)
  let turn = open
  let a = 0.97 * r * 0.809016994
  let b = -0.97 * r * 0.587785252
  let g = 0.15 * r
  -- Drive-pin positions at the 12-degree closed and 70-degree open stops.
  let x0 = a - 0.669130606*g
  let y0 = b + 0.743144825*g
  let x1 = a + 0.275637356*g
  let y1 = b + 0.961261696*g
  let n0 = sqrt(x0*x0+y0*y0)
  let n1 = sqrt(x1*x1+y1*y1)
  let ux = (1-turn)*x0/n0 + turn*x1/n1
  let uy = (1-turn)*y0/n0 + turn*y1/n1
  let n = sqrt(ux*ux+uy*uy)
  ux = ux/n
  uy = uy/n
  -- Intersection of a radial slot with the fixed-radius drive-pin orbit.
  let cross = a*uy-b*ux
  let distance = a*ux+b*uy-sqrt(max(0,g*g-cross*cross))
  let vx = (distance*ux-a)/g
  let vy = (distance*uy-b)/g
  let c = -0.809016994*vx + 0.587785252*vy
  let s = -0.809016994*vy - 0.587785252*vx
  let unit = sqrt(c*c+s*s)
  c = c/unit
  s = s/unit
  begin_group(cx-r,cy-r,2*r,2*r)
  fill_circle(cx,cy,0.60*r,primary)
  iris_leaf(cx,cy,r,1,0,c,s)
  iris_leaf(cx,cy,r,0.309016994,0.951056516,c,s)
  iris_leaf(cx,cy,r,-0.809016994,0.587785252,c,s)
  iris_leaf(cx,cy,r,-0.809016994,-0.587785252,c,s)
  iris_leaf(cx,cy,r,0.309016994,-0.951056516,c,s)
  end_group()
end

-- SPDX-License-Identifier: Apache-2.0
-- Five small lenses on a hexagonal lattice (2 / 1 / 2). Each uses the same
-- five-leaf iris. One shared front plate + 5 * 6 = 31 primitives, limit 32.
-- Blink is synchronized by eye_open; no new host clock or state is required.
fn draw()
  let gx = 10 * clamp(gaze_h, -1, 1)
  let gy = 8 * clamp(gaze_v, -1, 1)
  -- Keep the original pupil size, with separate wider metal housings.
  let r = sz(29)
  begin_group(tx(80), ty(16), sz(160), sz(208))
  fill_rect(tx(80), ty(16), sz(160), sz(208), 0x39e7)
  iris_lens(tx(125 + gx), ty(57 + gy), r)
  iris_lens(tx(195 + gx), ty(57 + gy), r)
  iris_lens(tx(160 + gx), ty(118 + gy), r)
  iris_lens(tx(125 + gx), ty(179 + gy), r)
  iris_lens(tx(195 + gx), ty(179 + gy), r)
  end_group()
end
`,minimal:`-- A bounded group clips its contents. Coordinates use a 320 x 240 canvas.
fn draw()
  begin_group(0, 0, 320, 240)
  fill_circle(100 + gaze_h * 8, 100, 16 * eye_open, primary)
  fill_circle(220 + gaze_h * 8, 100, 16 * eye_open, primary)
  fill_rect(130, 160, 60, 4 + mouth_open * 24, primary)
  end_group()
end
`},y=`Avatar DSL v1. Bundled samples: ${Object.keys(v).join(`, `)}. Lua-style fn draw() is the entry point. Helpers use fn/end, let, if/then/elif/else/end, while/do/end, return. Comments start with --. Drawing: fill_rect(x,y,w,h,color), fill_circle(x,y,r,color), fill_triangle(x1,y1,x2,y2,x3,y3,color). begin_group(x,y,w,h) / end_group() strictly clips to x/y/width/height; nested groups intersect their clips. Dynamic inputs include eye_open, gaze_h, gaze_v, mouth_open, mouth_form, breath, expr, primary, background, canvas_w, canvas_h. Use the bundled upstream presets for full tuning examples. This editor shares the firmware compiler and C VM. Limits: 32 KiB source, 16 KiB bytecode, bounded native VM instructions/draws/calls/geometry, fixed WASM memory, four-second worker timeout. Preview validates only the selected context: other expressions may fail at runtime. Save .avdsl source or .avbc bytecode. Transfer builds a MOD archive for a host with native Avatar DSL and strict group clip, replaces its MOD, and requires a visible human confirmation plus USB permission. Agent requests only prepare that confirmation.`;function b({model:e,guide:t,samples:n,changed:r,requestTransfer:i,assertEditable:a=()=>{}}){let o=(e={},t=[])=>({type:`object`,properties:e,required:t,additionalProperties:!1}),s=(e,t,n,r,i=!0)=>({name:e,description:t,inputSchema:n,execute:r,annotations:{readOnlyHint:i,untrustedContentHint:!0}});return[s(`stackchan_face_guide`,`Read Avatar DSL syntax, limits and device prerequisites.`,o(),async()=>({guide:t})),s(`stackchan_face_samples`,`Read bundled face DSL samples; does not change the editor.`,o({name:{type:`string`,enum:Object.keys(n)}}),async({name:e}={})=>{if(e!==void 0&&!Object.hasOwn(n,e))throw Error(`Unknown sample`);return e?{name:e,source:n[e]}:{names:Object.keys(n)}}),s(`stackchan_face_read`,`Read editor source and revision. Source is untrusted user content.`,o(),async()=>({source:e.source,revision:e.revision})),s(`stackchan_face_replace`,`Replace editor DSL with undo history, cancel pending transfer, and preview. Read revision first.`,o({source:{type:`string`,maxLength:m},expectedRevision:{type:`integer`,minimum:0}},[`source`,`expectedRevision`]),async({source:t,expectedRevision:n})=>{if(a(),h(t),!Number.isInteger(n))throw Error(`expectedRevision is required`);return e.replace(t,n),r(),{revision:e.revision,canUndo:e.canUndo}},!1),s(`stackchan_face_undo`,`Undo the last editor replacement and cancel any pending transfer.`,o(),async()=>{a();let t=e.undo();return t&&r(),{undone:t,revision:e.revision}},!1),s(`stackchan_face_request_transfer`,`Compile current DSL and stage a visible device-transfer confirmation. Never connects or writes hardware; user must confirm in page.`,o({expectedRevision:{type:`integer`,minimum:0}},[`expectedRevision`]),async({expectedRevision:t},n={})=>{if(!Number.isInteger(t)||t!==e.revision)throw Error(`Editor changed; read current revision`);if(n.signal?.aborted)throw Error(`Request cancelled`);return i(t,n.signal)},!1)]}async function x(e,{document:t=globalThis.document,window:n=globalThis.window,signal:r}={}){if(!t||n&&n.top!==n.self)return{supported:!1,reason:`Top-level page required`};let i=t.modelContext;if(typeof i?.registerTool!=`function`)return{supported:!1,reason:`WebMCP is unavailable; use the normal editor controls`};let a=new AbortController;if(r?.aborted)return{supported:!1,reason:`Editor closed`};r?.addEventListener(`abort`,()=>a.abort(),{once:!0,signal:a.signal});try{for(let t of e)await i.registerTool(t,{signal:a.signal});return{supported:!0,dispose:()=>a.abort()}}catch(e){return a.abort(),{supported:!1,reason:`WebMCP registration failed: ${e.message}`}}}async function S({archive:e,port:t,loaderFactory:n=a,onLog:r,onProgress:i,isCurrent:o=()=>!0}){return c(n,t,e,{onLog:r,onProgress:i,verify:!0,onPreflight({chip:t,firmware:n}){if(!o())return!1;let r=s(`m5stackchan-cores3`,{chip:t,xsVersion:l(e),firmwareVersion:n.moddableVersion,requireArchive:!0,requireFirmware:!0});if(!r.compatible)throw Error(r.diagnostics.map(e=>e.message).join(`
`));return o()}})}function C({requestPort:e=()=>navigator.serial.requestPort(),loaderFactory:t=a,onState:n=()=>{},onLog:r=()=>{}}={}){let i=null,s=!1,c=0,u=null,d=!1,f=(e,t={})=>n({status:e,pending:p.pending,busy:s,...t}),p={get pending(){return i?Object.freeze({id:i.id,sourceRevision:i.sourceRevision,archiveSize:i.archive.length}):null},get busy(){return s},stage({archive:e,sourceRevision:t}){if(s)throw Error(`A device operation is already in progress`);if(!(e instanceof Uint8Array)||o(e)!==e.length||e.length>262144||!l(e))throw TypeError(`Expected a bounded XS archive with a version header`);return i={id:++c,sourceRevision:t,archive:Uint8Array.from(e)},d=!1,u&&(u.nativeHostCheckbox.checked=!1),f(`awaiting-confirmation`),p.pending},cancel(){i=null,d=!1,u&&(u.nativeHostCheckbox.checked=!1),f(`cancelled`)},bindConfirmation(e,{nativeHostCheckbox:t}){if(u)throw Error(`Confirmation button is already bound`);if(!e?.addEventListener||!t)throw TypeError(`A confirmation button and native host checkbox are required`);u={button:e,nativeHostCheckbox:t},d=!1,t.checked=!1;let n=e=>{p.confirmFromEvent(e)},r=n=>{d=n instanceof e.ownerDocument.defaultView.Event&&n.isTrusted&&n.currentTarget===t&&t.checked};return e.addEventListener(`click`,n),t.addEventListener(`change`,r),()=>{e.removeEventListener(`click`,n),t.removeEventListener(`change`,r),u=null,p.cancel()}},async confirmFromEvent(n){let a=u,o=a?.button.ownerDocument?.defaultView?.Event;if(!o||!(n instanceof o)||!n.isTrusted||n.type!==`click`||n.currentTarget!==a.button||!a.button.isConnected||a.button.disabled||!a.button.getClientRects().length||!a.nativeHostCheckbox.checked||!d)return{status:`confirmation-required`};if(!i||s)return{status:`idle`};let c=i;s=!0,f(`selecting-device`);try{let n=await e();if(i!==c)return{status:`cancelled`};f(`transferring`);let a=await S({archive:c.archive,port:n,loaderFactory:t,onLog:r,isCurrent:()=>i===c,onProgress:e=>f(`transferring`,{progress:e})});return i=null,f(a.status,{result:a}),a}catch(e){i=null;let t=e?.name===`NotFoundError`?`cancelled`:`error`;return f(t,{error:String(e?.message??e)}),{status:t,error:String(e?.message??e)}}finally{s=!1,d=!1,a&&(a.nativeHostCheckbox.checked=!1),f(`settled`)}}};return p}async function w(e,{onLog:t=()=>{},timeoutMs:n=3e4,signal:r}={}){let i=new Worker(new URL(``+new URL(`transfer-worker-p7qgzZxU.js`,import.meta.url).href,``+import.meta.url),{type:`module`,name:`avatar-dsl-mod-build`}),a=Uint8Array.from(e instanceof ArrayBuffer?new Uint8Array(e):e).buffer,o,s;try{return await new Promise((e,c)=>{if(s=()=>c(new DOMException(`Build cancelled`,`AbortError`)),r?.aborted)return s();r?.addEventListener(`abort`,s,{once:!0}),o=setTimeout(()=>c(Error(`MOD build exceeded its time limit`)),Math.min(6e4,Math.max(1e3,n))),i.addEventListener(`message`,({data:n})=>{n.type===`log`?t(n.message):n.type===`success`?e(new Uint8Array(n.archive)):n.type===`error`&&c(Error(n.error))}),i.addEventListener(`error`,e=>c(Error(e.message||`MOD build worker failed`))),i.postMessage({type:`build`,bytecode:a},[a])})}finally{clearTimeout(o),r?.removeEventListener(`abort`,s),i.terminate()}}function T(e){let t=new AbortController,n=(e,n,r,i={})=>e.addEventListener(n,r,{...i,signal:t.signal}),r=t=>e.querySelector(`#${t}`),i=g(v.default),a=_(()=>new Worker(new URL(``+new URL(`preview.worker-C9k5JGWd.js`,import.meta.url).href,``+import.meta.url),{type:`module`})),o,s=!0,c,l=!1,u,d,f=(e,t=!1)=>{r(`diagnostic`).textContent=e,r(`diagnostic`).dataset.error=String(t)},m=C({onLog:e=>{t.signal.aborted||(r(`transfer-status`).textContent=String(e))},onState:e=>{if(!t.signal.aborted){e.status!==`settled`&&(r(`transfer-status`).textContent=e.status===`cancelled`?`cancelled`:e.error?.message||e.error||e.status),e.status===`selecting-device`&&r(`confirmation`).close(),r(`source`).disabled=r(`sample`).disabled=r(`load`).disabled=e.busy,r(`undo`).disabled=e.busy||!i.canUndo;for(let t of[`eye`,`mouth`,`gaze`,`breath`,`expression`,`validate`,`transfer`])r(t).disabled=e.busy||t===`transfer`&&!o}}}),S=()=>{let e=p();return e[4]=Number(r(`breath`).value),e[5]=Number(r(`eye`).value),e[6]=Number(r(`gaze`).value),e[8]=e[31]=Number(r(`mouth`).value),e[9]=Number(r(`expression`).value),e};function T(){u?.abort(),d?.(),d=void 0,m.cancel(),r(`confirmation`).open&&r(`confirmation`).close(),r(`compatible-host`).checked=!1,r(`confirm-transfer`).disabled=!0}function E(){o=void 0,r(`bytecode`).disabled=r(`transfer`).disabled=!0,T(),a.cancel()}async function D(){if(clearTimeout(c),!s)throw Error(`Correct the source limit before preview or transfer`);let e=i.revision;f(`コンパイル・C / WASM 描画中…`);try{let n=await a.run(i.source,S());if(t.signal.aborted)throw Error(`Preview cancelled`);if(e!==i.revision)throw Error(`Editor changed`);o={...n,revision:e};let s=n.result;return r(`preview`).getContext(`2d`).putImageData(new ImageData(new Uint8ClampedArray(s.pixels),320,240),0,0),f(`検証 OK · ${n.bytecode.byteLength} bytes · ${s.steps} instructions`),r(`render-status`).textContent=`C / WASM · Revision ${e} · 選択した表情の描画に成功`,r(`bytecode`).disabled=r(`transfer`).disabled=!1,o}catch(e){throw!t.signal.aborted&&e.message!==`Preview cancelled`&&(o=void 0,r(`bytecode`).disabled=r(`transfer`).disabled=!0,f(e.message,!0),r(`render-status`).textContent=`描画は更新されていません。最後に成功したプレビューです。`),e}}function O(){s=!0,r(`source`).value!==i.source&&(r(`source`).value=i.source),r(`line-numbers`).textContent=i.source.split(`
`).map((e,t)=>t+1).join(`
`),r(`line-numbers`).scrollTop=r(`source`).scrollTop,r(`revision`).textContent=`Revision ${i.revision}`,r(`undo`).disabled=!i.canUndo,E(),f(`変更あり · 検証待ち`),clearTimeout(c),c=setTimeout(()=>void D().catch(()=>{}),300)}async function k(e=i.revision,n){if(l||m.busy)throw Error(`Transfer preparation or installation is already running`);if(!s||e!==i.revision)throw Error(`Editor changed; validate current source`);l=!0,u=new AbortController;let a=AbortSignal.any([t.signal,u.signal,...n?[n]:[]]);try{let t=await D();if(a.aborted)throw Error(`Request cancelled`);r(`transfer-status`).textContent=`MOD アーカイブを構築中…`;let o=await w(t.bytecode,{signal:a,onLog:e=>{a.aborted||(r(`transfer-status`).textContent=String(e))}});if(a.aborted||i.revision!==e||!s)throw Error(`Request cancelled or editor changed`);return m.stage({archive:o,sourceRevision:e}),n&&(n.addEventListener(`abort`,T,{once:!0}),d=()=>n.removeEventListener(`abort`,T)),r(`confirm-transfer`).disabled=!0,r(`transfer-snapshot`).textContent=`Revision ${e} · AVBC ${t.bytecode.byteLength} bytes`,r(`confirmation`).showModal(),{status:`awaiting_user_confirmation`,revision:e}}finally{u=void 0,l=!1}}let A=e=>Promise.resolve().then(e).catch(e=>{t.signal.aborted||f(e.message,!0)});n(r(`source`),`input`,()=>{try{i.replace(h(r(`source`).value)),O()}catch(e){s=!1,E(),f(e.message,!0)}}),n(r(`source`),`keydown`,e=>{if(e.ctrlKey||e.metaKey){if(e.key===`Enter`){e.preventDefault(),A(D);return}if(e.key.toLowerCase()===`s`){e.preventDefault(),j(r(`source`).value,`face.avdsl`,`text/plain;charset=utf-8`);return}if(e.key.toLowerCase()===`z`&&!e.shiftKey){e.preventDefault(),i.undo(),O();return}}if(e.key!==`Tab`)return;e.preventDefault();let t=r(`source`);t.setRangeText(`  `,t.selectionStart,t.selectionEnd,`end`),t.dispatchEvent(new Event(`input`))}),n(r(`source`),`scroll`,()=>{r(`line-numbers`).scrollTop=r(`source`).scrollTop}),n(r(`sample`),`change`,()=>{i.replace(v[r(`sample`).value]),O()}),n(r(`undo`),`click`,()=>{i.undo(),O()}),n(r(`validate`),`click`,()=>A(D));for(let e of[`eye`,`mouth`,`gaze`,`breath`,`expression`])n(r(e),`input`,()=>{E(),A(D)});r(`guide`).textContent=y,n(r(`load`),`click`,()=>r(`file`).click()),n(r(`file`),`change`,()=>A(async()=>{try{let e=r(`file`).files[0];if(!e)return;if(e.size>32768)throw Error(`DSL exceeds 32 KiB`);i.replace(await e.text()),O()}finally{r(`file`).value=``}}));function j(e,t,n){let r=URL.createObjectURL(new Blob([e],{type:n})),i=document.createElement(`a`);i.href=r,i.download=t,i.click(),setTimeout(()=>URL.revokeObjectURL(r),1e3)}n(r(`download`),`click`,()=>j(r(`source`).value,`face.avdsl`,`text/plain;charset=utf-8`)),n(r(`bytecode`),`click`,()=>{o?.revision===i.revision&&j(o.bytecode,`face.avbc`,`application/octet-stream`)}),n(r(`transfer`),`click`,()=>A(()=>k())),n(r(`cancel-transfer`),`click`,T),n(r(`confirmation`),`cancel`,T),n(r(`compatible-host`),`change`,e=>{r(`confirm-transfer`).disabled=!e.isTrusted||!r(`compatible-host`).checked});let M=m.bindConfirmation(r(`confirm-transfer`),{nativeHostCheckbox:r(`compatible-host`)}),N=b({model:i,guide:y,samples:v,changed:O,requestTransfer:k,assertEditable:()=>{if(m.busy)throw Error(`Device transfer is in progress`);if(!s)throw Error(`Resolve the current oversized draft before an agent changes the editor`)}}),P;x(N,{signal:t.signal}).then(e=>{if(t.signal.aborted){e.dispose?.();return}P=e,r(`bridge-status`).textContent=e.supported?`WebMCP tools available`:e.reason});let F=()=>{clearTimeout(c),t.abort(),P?.dispose?.(),a.cancel(),M(),T()};return n(window,`pagehide`,e=>{if(!e.persisted){F();return}clearTimeout(c),E()}),n(window,`pageshow`,e=>{e.persisted&&s&&A(D)}),O(),F}var E=n();function D(){let e=(0,u.useRef)(null);return(0,u.useEffect)(()=>(document.title=`顔 DSL エディタ | Stack-chan`,T(e.current)),[]),(0,E.jsx)(r,{current:`avatar-dsl`,surfaceName:`顔 DSL エディタ`,rootHref:`../`,children:(0,E.jsxs)(`div`,{ref:e,className:`avatar-studio page-container py-6`,children:[(0,E.jsxs)(`div`,{className:`mb-5 flex flex-wrap items-center justify-between gap-3`,children:[(0,E.jsxs)(`div`,{children:[(0,E.jsx)(`h1`,{className:`page-heading`,children:`顔をコードで描く`}),(0,E.jsx)(`p`,{className:`page-lead`,children:`実機と共通の C / WASM で描画します。`})]}),(0,E.jsx)(`p`,{id:`bridge-status`,role:`status`,children:`WebMCP 確認中`})]}),(0,E.jsxs)(`div`,{className:`studio-grid`,children:[(0,E.jsxs)(`section`,{"aria-label":`DSL エディタ`,children:[(0,E.jsxs)(`label`,{children:[`プリセット`,` `,(0,E.jsxs)(`select`,{id:`sample`,defaultValue:`default`,children:[(0,E.jsx)(`option`,{value:`default`,children:`Default`}),(0,E.jsx)(`option`,{value:`aokko`,children:`Aokko`}),(0,E.jsx)(`option`,{value:`omega`,children:`Omega mouth`}),(0,E.jsx)(`option`,{value:`minimal`,children:`Minimal`}),(0,E.jsx)(`option`,{value:`rounded`,children:`Rounded eyes`}),(0,E.jsx)(`option`,{value:`compound`,children:`Compound iris`}),(0,E.jsx)(`option`,{value:`Mono eye`,children:`Mono eye`})]})]}),(0,E.jsxs)(`div`,{className:`studio-toolbar`,children:[(0,E.jsx)(`button`,{id:`load`,children:`DSL を開く`}),(0,E.jsx)(`button`,{id:`undo`,disabled:!0,children:`変更を戻す`}),(0,E.jsx)(`button`,{id:`validate`,children:`検証・描画`})]}),(0,E.jsx)(`input`,{id:`file`,type:`file`,accept:`.avdsl,text/plain`,hidden:!0}),(0,E.jsx)(`label`,{className:`sr-only`,htmlFor:`source`,children:`Avatar DSL ソースコード`}),(0,E.jsxs)(`div`,{className:`source-wrap`,children:[(0,E.jsx)(`pre`,{id:`line-numbers`,"aria-hidden":`true`,children:`1`}),(0,E.jsx)(`textarea`,{id:`source`,spellCheck:!1,autoCapitalize:`off`,autoComplete:`off`,wrap:`off`,"aria-describedby":`diagnostic`})]}),(0,E.jsx)(`p`,{id:`diagnostic`,role:`status`,"aria-live":`polite`,children:`C / WASM を初期化中`}),(0,E.jsxs)(`div`,{className:`studio-toolbar`,children:[(0,E.jsx)(`button`,{id:`download`,children:`DSL を保存`}),(0,E.jsx)(`button`,{id:`bytecode`,disabled:!0,children:`AVBC を保存`}),(0,E.jsx)(`small`,{id:`revision`,children:`Revision 0`})]})]}),(0,E.jsxs)(`section`,{"aria-label":`ライブプレビュー`,children:[(0,E.jsx)(`div`,{className:`canvas-stage`,children:(0,E.jsx)(`canvas`,{id:`preview`,width:`320`,height:`240`,"aria-label":`C WASM 顔プレビュー`})}),(0,E.jsx)(`p`,{id:`render-status`,children:`検証するとプレビューを更新します。`}),(0,E.jsxs)(`div`,{className:`studio-controls`,children:[(0,E.jsxs)(`label`,{children:[`目の開き`,(0,E.jsx)(`input`,{id:`eye`,type:`range`,min:`0`,max:`1`,step:`0.01`,defaultValue:`1`})]}),(0,E.jsxs)(`label`,{children:[`口の開き`,(0,E.jsx)(`input`,{id:`mouth`,type:`range`,min:`0`,max:`1`,step:`0.05`,defaultValue:`0`})]}),(0,E.jsxs)(`label`,{children:[`視線・左右`,(0,E.jsx)(`input`,{id:`gaze`,type:`range`,min:`-1`,max:`1`,step:`0.1`,defaultValue:`0`})]}),(0,E.jsxs)(`label`,{children:[`呼吸`,(0,E.jsx)(`input`,{id:`breath`,type:`range`,min:`-1`,max:`1`,step:`0.1`,defaultValue:`1`})]}),(0,E.jsxs)(`label`,{children:[`表情`,(0,E.jsxs)(`select`,{id:`expression`,defaultValue:`0`,children:[(0,E.jsx)(`option`,{value:`0`,children:`Neutral`}),(0,E.jsx)(`option`,{value:`1`,children:`Happy`}),(0,E.jsx)(`option`,{value:`2`,children:`Sad`}),(0,E.jsx)(`option`,{value:`3`,children:`Angry`}),(0,E.jsx)(`option`,{value:`4`,children:`Doubt`}),(0,E.jsx)(`option`,{value:`5`,children:`Sleepy`})]})]})]}),(0,E.jsxs)(`div`,{className:`studio-device`,children:[(0,E.jsx)(`h2`,{children:`Stack-chan に転送`}),(0,E.jsx)(`p`,{children:`対応する M5StackChan CoreS3 の MOD を置き換えます。`}),(0,E.jsx)(`button`,{id:`transfer`,disabled:!0,children:`転送を準備`}),(0,E.jsx)(`p`,{id:`transfer-status`,role:`status`,children:`転送には Web Serial 対応ブラウザが必要です。`})]}),(0,E.jsxs)(`details`,{children:[(0,E.jsx)(`summary`,{children:`DSL ガイド・上限`}),(0,E.jsx)(`p`,{id:`guide`})]})]})]}),(0,E.jsxs)(`dialog`,{id:`confirmation`,"aria-labelledby":`confirmation-title`,children:[(0,E.jsx)(`h2`,{id:`confirmation-title`,children:`実機転送の確認`}),(0,E.jsx)(`p`,{children:`表示中の顔を含む MOD を転送し、現在の MOD を置き換えます。`}),(0,E.jsx)(`p`,{id:`transfer-snapshot`}),(0,E.jsxs)(`label`,{children:[(0,E.jsx)(`input`,{id:`compatible-host`,type:`checkbox`}),` native Avatar DSL と strict group clip に対応する host を導入済みです。`]}),(0,E.jsx)(`p`,{children:`確認後に USB ポートを選択します。選択した機器だけに書き込みます。`}),(0,E.jsxs)(`div`,{className:`studio-toolbar`,children:[(0,E.jsx)(`button`,{id:`cancel-transfer`,children:`キャンセル`}),(0,E.jsx)(`button`,{id:`confirm-transfer`,disabled:!0,children:`確認して USB 転送`})]})]})]})})}i((0,E.jsx)(D,{}));