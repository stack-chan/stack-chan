import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

import { writeAliasPackage, writeAliasPackageSubpath } from '../../testing/node-alias-package.js'

const modulesRoot = resolve('dist-tests')

function dist(path: string): string {
  return resolve(modulesRoot, path)
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function writePackageExport(packageRoot: string, exports: Record<string, string>): void {
  mkdirSync(packageRoot, { recursive: true })
  writeFileSync(`${packageRoot}/package.json`, JSON.stringify({ type: 'module', exports }))
}

function relativeImport(fromFile: string, toFile: string): string {
  const specifier = relative(dirname(fromFile), toFile).replaceAll('\\', '/')
  return specifier.startsWith('.') ? specifier : `./${specifier}`
}

function writeReexport(entryPath: string, targetPath: string): void {
  writeFile(entryPath, `export * from ${JSON.stringify(relativeImport(entryPath, targetPath))};\n`)
}

function writePiuStub(): void {
  const packageRoot = resolve(modulesRoot, 'node_modules/piu')
  writePackageExport(packageRoot, {
    './MC': './MC.js',
    './Timeline': './Timeline.js',
  })
  writeFile(
    `${packageRoot}/MC.js`,
    `
globalThis.trace ??= () => {};
globalThis.Math.quadEaseOut ??= (fraction) => 1 - (1 - fraction) * (1 - fraction);
globalThis.Behavior ??= class {};

function link(container) {
  let previous = null;
  for (const child of container.children) {
    child.container = container;
    child.previous = previous;
    if (previous) previous.next = child;
    previous = child;
  }
  container.first = container.children[0] ?? null;
  container.last = previous;
  if (previous) previous.next = null;
}

class PiuNode {
  constructor(data = null, options = {}) {
    this.children = [];
    this.data = data;
    this.name = options.name;
    this.active = options.active;
    this.visible = options.visible ?? true;
    this.backgroundTouch = options.backgroundTouch;
    this.skin = options.skin;
    this.style = options.style;
    this.string = options.string;
    this.state = options.state;
    this.variant = options.variant;
    this.interval = options.interval;
    this.duration = options.duration ?? 0;
    this.time = options.time ?? 0;
    this.width = options.width ?? 0;
    this.height = options.height ?? 0;
    if (options.anchor && data && typeof data === 'object') data[options.anchor] = this;
    this.left = options.left;
    this.right = options.right;
    this.top = options.top;
    this.bottom = options.bottom;
    this.coordinates = {
      left: options.left,
      right: options.right,
      top: options.top,
      bottom: options.bottom,
      width: options.width,
      height: options.height,
    };
    const BehaviorClass = options.Behavior;
    this.behavior = BehaviorClass ? new BehaviorClass() : undefined;
    for (const child of options.contents ?? []) this.add(child);
    this.behavior?.onCreate?.(this, data);
  }
  add(child) {
    if (!child) return;
    if (child.container) child.container.remove(child);
    this.children.push(child);
    link(this);
  }
  insert(child, before) {
    if (!child) return;
    if (child.container) child.container.remove(child);
    const index = this.children.indexOf(before);
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    link(this);
  }
  remove(child) {
    const index = this.children.indexOf(child);
    if (index < 0) return;
    this.children.splice(index, 1);
    child.container = null;
    child.next = null;
    child.previous = null;
    link(this);
  }
  empty() {
    for (const child of this.children) {
      child.container = null;
      child.next = null;
      child.previous = null;
    }
    this.children = [];
    link(this);
  }
  get length() {
    return this.children.length;
  }
  start() {
    this.running = true;
  }
  stop() {
    this.running = false;
  }
  moveBy(dx, dy) {
    this.coordinates = {
      ...this.coordinates,
      left: (this.coordinates.left ?? this.left ?? 0) + dx,
      top: (this.coordinates.top ?? this.top ?? 0) + dy,
    };
    this.left = this.coordinates.left;
    this.top = this.coordinates.top;
  }
  bubble(id, ...args) {
    this.lastBubble = [id, ...args];
    let current = this.container;
    while (current) {
      const handler = current.behavior?.[id];
      if (typeof handler === 'function') return handler.call(current.behavior, current, ...args);
      current = current.container;
    }
  }
  distribute(id, ...args) {
    const handler = this.behavior?.[id];
    if (typeof handler === 'function') handler.call(this.behavior, this, ...args);
    for (const child of this.children) child.distribute?.(id, ...args);
  }
  invalidate() {
    this.invalidated = (this.invalidated ?? 0) + 1;
  }
  captureTouch(id, x, y, ticks) {
    this.lastCapturedTouch = [id, x, y, ticks];
  }
  scrollTo(x, y) {
    this.scroll = { x, y };
  }
  fillColor(...args) {
    this.draws ??= [];
    this.draws.push(['fillColor', ...args]);
  }
  drawTexture(...args) {
    this.draws ??= [];
    this.draws.push(['drawTexture', ...args]);
  }
  set(x, y, width, height) {
    this.mask = { x, y, width, height };
    return this;
  }
  cut() {
    this.cutCalled = true;
    return this;
  }
}

function templateFor(Class) {
  return (factory) =>
    class extends Class {
      constructor(data = {}, dictionary = {}) {
        super(data, { ...factory(data, dictionary), ...dictionary });
      }
      static template(nextFactory) {
        return templateFor(this)((data, dictionary) => ({
          ...factory(data, dictionary),
          ...nextFactory(data, dictionary),
        }));
      }
    };
}

export class Content extends PiuNode {}
Content.template = templateFor(Content);
export class Container extends PiuNode {}
Container.template = templateFor(Container);
export class Column extends Container {}
Column.template = templateFor(Column);
export class Scroller extends Container {
  constructor(data, options = {}) {
    super(data, options);
    this.scroll = { x: 0, y: 0 };
  }
}
Scroller.template = templateFor(Scroller);
export class Label extends Content {}
Label.template = templateFor(Label);
export class Text extends Content {}
Text.template = templateFor(Text);
export class Port extends Content {}
Port.template = templateFor(Port);
export class Shape extends Content {}
Shape.template = templateFor(Shape);
export class Die extends Container {}
Die.template = templateFor(Die);
export class Application extends Container {}
export class Skin {
  constructor(options = {}) {
    Object.assign(this, options);
  }
}
export class Style {
  constructor(options = {}) {
    Object.assign(this, options);
  }
}
export class Texture {
  constructor(path) {
    this.path = path;
  }
}
Object.assign(globalThis, {
  Content,
  Container,
  Column,
  Scroller,
  Label,
  Text,
  Port,
  Shape,
  Die,
  Application,
  Skin,
  Style,
  Texture,
});
`,
  )
  writeFile(
    `${packageRoot}/Timeline.js`,
    `
export default class Timeline {
  duration = 0;
  on(target, properties, duration) {
    this.target = target;
    this.properties = properties;
    this.duration = duration;
  }
  seekTo(time) {
    if (!this.properties) return;
    const fraction = this.duration > 0 ? Math.max(0, Math.min(1, time / this.duration)) : 1;
    for (const [key, range] of Object.entries(this.properties)) {
      const [from, to] = range;
      this.target[key] = from + (to - from) * fraction;
    }
  }
}
`,
  )
}

function writeCommodettoStub(): void {
  const packageRoot = resolve(modulesRoot, 'node_modules/commodetto')
  writePackageExport(packageRoot, { './outline': './outline.js' })
  writeFile(
    `${packageRoot}/outline.js`,
    `
class CanvasPath {
  arc() {}
  ellipse() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
  closePath() {}
}
export const Outline = {
  CanvasPath,
  fill(path) {
    return { kind: 'fill', path };
  },
  stroke(path, width) {
    return { kind: 'stroke', path, width };
  },
};
export default Outline;
`,
  )
}

function writePartsAliases(): void {
  const packageRoot = resolve(modulesRoot, 'node_modules/parts')
  const subpaths = [
    'eye',
    'mouth',
    'shape-cache',
    'shape-utils',
    'dog/eyebrow',
    'dog/mouth',
    'dog/nose',
    'image/atlas',
    'image/eye-sprite',
    'image/eyelid-sprite',
    'image/image-avatar-face',
    'image/image-avatar-pack',
    'image/image-avatar-state',
    'image/iris-sprite',
    'image/mouth-sprite',
  ]
  writePackageExport(packageRoot, Object.fromEntries(subpaths.map((subpath) => [`./${subpath}`, `./${subpath}.js`])))
  for (const subpath of subpaths) {
    writeReexport(resolve(packageRoot, `${subpath}.js`), dist(`host/modules/ui/components/face/parts/${subpath}.js`))
  }
}

export function installUiNodeTestAliases(): void {
  writePiuStub()
  writeCommodettoStub()
  writePartsAliases()

  writeAliasPackage(modulesRoot, 'face-state', dist('host/modules/ui/state/face-state.js'))
  writeAliasPackage(modulesRoot, 'face-skin', dist('host/modules/ui/state/face-skin.js'))
  writeAliasPackage(modulesRoot, 'stackchan-util', dist('host/modules/util/stackchan-util.js'))
  writeAliasPackage(modulesRoot, 'timer', dist('host/modules/testing/fakes/timer.js'), { hasDefaultExport: true })
  writeAliasPackage(modulesRoot, 'mac-address', dist('host/modules/util/sim/mac-address.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'drawer', dist('host/modules/ui/components/drawer/drawer.js'))
  writeAliasPackage(modulesRoot, 'common-view', dist('host/modules/ui/views/main/common-view.js'))
  writeAliasPackage(modulesRoot, 'face-view', dist('host/modules/ui/views/main/face-view.js'))
  writeAliasPackage(modulesRoot, 'template', dist('host/modules/ui/components/face/template.js'))
  writeAliasPackageSubpath(modulesRoot, 'motions', 'types', dist('host/modules/ui/components/face/motions/types.js'))
  writeAliasPackageSubpath(modulesRoot, 'motions', 'blink', dist('host/modules/ui/components/face/motions/blink.js'))
  writeAliasPackageSubpath(modulesRoot, 'motions', 'breath', dist('host/modules/ui/components/face/motions/breath.js'))
  writeAliasPackageSubpath(
    modulesRoot,
    'motions',
    'saccade',
    dist('host/modules/ui/components/face/motions/saccade.js'),
  )
  writeAliasPackageSubpath(modulesRoot, 'effects', 'emoticon', dist('host/modules/ui/components/effects/emoticon.js'))
  writeAliasPackageSubpath(
    modulesRoot,
    'effects',
    'multirow-balloon',
    dist('host/modules/ui/components/bubble/multirow-balloon.js'),
  )
  writeAliasPackageSubpath(modulesRoot, 'behaviors', 'face', dist('host/modules/ui/components/face/behaviors/face.js'))
}
