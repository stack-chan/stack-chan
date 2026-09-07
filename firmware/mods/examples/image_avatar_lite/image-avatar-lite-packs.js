// ImageAvatarLite assets and their license are owned by this MOD.
/** @typedef {import('stackchan/image-avatar').ImageAvatarStaticSprite} Sprite */
/** @typedef {import('stackchan/image-avatar').ImageAvatarPack} Pack */
/** @param {string} texture @param {Omit<Sprite, 'texture'>} geometry */
const sprite = (texture, geometry) => ({ texture, ...geometry })
/** @param {string} texture @param {Omit<Sprite, 'texture'>} geometry */
const animated = (texture, geometry) => ({ ...sprite(texture, geometry), frameCount: 2 })
const hiddenHand = sprite('image-avatar-lite-transparent.png', { x: 0, y: 0, width: 1, height: 1 })
/** @param {Omit<import('stackchan/image-avatar').ImageAvatarExpression, 'hands'>} parts */
const expression = (parts) => ({ ...parts, hands: { left: hiddenHand, right: hiddenHand } })

/** @type {Record<string, Pack>} */
export const IMAGE_AVATAR_LITE_PACKS = {
  'image-avatar-lite-slime': {
    id: 'image-avatar-lite-slime',
    displayName: 'ImageAvatarLite slime',
    width: 320,
    height: 240,
    defaultExpression: 'normal',
    emotionMap: {
      neutral: 'normal',
      sad: 'sad',
      angry: 'angry',
      happy: 'normal',
      sleepy: 'sad',
      cold: 'sad',
      hot: 'angry',
    },
    expressions: {
      normal: expression({
        head: sprite('image-avatar-lite-slime-head.png', { x: -10, y: -10, width: 340, height: 260 }),
        eyes: {
          left: animated('image-avatar-lite-slime-eye-left-normal.png', { x: 170, y: 90, width: 40, height: 60 }),
          right: animated('image-avatar-lite-slime-eye-right-normal.png', { x: 110, y: 90, width: 40, height: 60 }),
        },
        mouth: animated('image-avatar-lite-slime-mouth-normal.png', { x: 130, y: 180, width: 60, height: 60 }),
      }),
      sad: expression({
        head: sprite('image-avatar-lite-slime-head.png', { x: -10, y: -10, width: 340, height: 260 }),
        eyes: {
          left: animated('image-avatar-lite-slime-eye-left-sad.png', { x: 180, y: 70, width: 40, height: 60 }),
          right: animated('image-avatar-lite-slime-eye-right-sad.png', { x: 100, y: 70, width: 40, height: 60 }),
        },
        mouth: animated('image-avatar-lite-slime-mouth-sad.png', { x: 130, y: 170, width: 60, height: 60 }),
      }),
      angry: expression({
        head: sprite('image-avatar-lite-slime-head.png', { x: -10, y: -10, width: 340, height: 260 }),
        eyes: {
          left: animated('image-avatar-lite-slime-eye-left-angry.png', { x: 180, y: 70, width: 40, height: 60 }),
          right: animated('image-avatar-lite-slime-eye-right-angry.png', { x: 100, y: 70, width: 40, height: 60 }),
        },
        mouth: animated('image-avatar-lite-slime-mouth-angry.png', { x: 130, y: 170, width: 60, height: 60 }),
      }),
    },
  },
  'image-avatar-lite-puipui': {
    id: 'image-avatar-lite-puipui',
    displayName: 'ImageAvatarLite puipui',
    width: 320,
    height: 240,
    defaultExpression: 'normal',
    emotionMap: {
      neutral: 'normal',
      happy: 'normal',
      sad: 'normal',
      angry: 'normal',
      sleepy: 'normal',
      doubt: 'normal',
      cold: 'normal',
      hot: 'normal',
    },
    expressions: {
      normal: expression({
        head: sprite('image-avatar-lite-puipui-head.png', { x: 0, y: 0, width: 320, height: 240 }),
        eyes: {
          left: animated('image-avatar-lite-puipui-eye-left-normal.png', { x: 175, y: 95, width: 50, height: 50 }),
          right: animated('image-avatar-lite-puipui-eye-right-normal.png', { x: 95, y: 95, width: 50, height: 50 }),
        },
        mouth: animated('image-avatar-lite-puipui-mouth-normal.png', { x: 130, y: 170, width: 60, height: 60 }),
      }),
    },
  },
  'image-avatar-lite-jacko': {
    id: 'image-avatar-lite-jacko',
    displayName: 'ImageAvatarLite jack-o-lantern',
    width: 320,
    height: 240,
    defaultExpression: 'normal',
    emotionMap: {
      neutral: 'normal',
      happy: 'normal',
      sad: 'normal',
      angry: 'normal',
      sleepy: 'normal',
      doubt: 'normal',
      cold: 'normal',
      hot: 'normal',
    },
    expressions: {
      normal: expression({
        head: sprite('image-avatar-lite-jacko-head.png', { x: 0, y: 0, width: 320, height: 240 }),
        eyes: {
          left: animated('image-avatar-lite-jacko-eye-left-normal.png', { x: 210, y: 50, width: 60, height: 60 }),
          right: animated('image-avatar-lite-jacko-eye-right-normal.png', { x: 50, y: 50, width: 60, height: 60 }),
        },
        mouth: animated('image-avatar-lite-jacko-mouth-normal.png', { x: 76, y: 170, width: 168, height: 60 }),
      }),
    },
  },
  'image-avatar-lite-girl': {
    id: 'image-avatar-lite-girl',
    displayName: 'ImageAvatarLite girl',
    width: 320,
    height: 240,
    defaultExpression: 'normal',
    emotionMap: { neutral: 'normal', sad: 'sleepy', angry: 'grim', happy: 'normal', sleepy: 'sleepy', doubt: 'grim' },
    expressions: {
      normal: expression({
        head: sprite('image-avatar-lite-girl-head.png', { x: 0, y: 0, width: 320, height: 240 }),
        eyes: {
          left: animated('image-avatar-lite-girl-eye-left-normal.png', { x: 184, y: 74, width: 102, height: 112 }),
          right: animated('image-avatar-lite-girl-eye-right-normal.png', { x: 34, y: 74, width: 102, height: 112 }),
        },
        mouth: animated('image-avatar-lite-girl-mouth-normal.png', { x: 123, y: 168, width: 74, height: 74 }),
      }),
      sleepy: expression({
        head: sprite('image-avatar-lite-girl-head.png', { x: 0, y: 0, width: 320, height: 240 }),
        eyes: {
          left: animated('image-avatar-lite-girl-eye-left-sleepy.png', { x: 179, y: 74, width: 102, height: 112 }),
          right: animated('image-avatar-lite-girl-eye-right-sleepy.png', { x: 39, y: 74, width: 102, height: 112 }),
        },
        mouth: animated('image-avatar-lite-girl-mouth-sleepy.png', { x: 123, y: 168, width: 74, height: 74 }),
      }),
      grim: expression({
        head: sprite('image-avatar-lite-girl-head.png', { x: 0, y: 0, width: 320, height: 240 }),
        eyes: {
          left: animated('image-avatar-lite-girl-eye-left-grim.png', { x: 179, y: 74, width: 102, height: 112 }),
          right: animated('image-avatar-lite-girl-eye-right-grim.png', { x: 39, y: 74, width: 102, height: 112 }),
        },
        mouth: animated('image-avatar-lite-girl-mouth-grim.png', { x: 123, y: 168, width: 74, height: 74 }),
      }),
    },
  },
  'image-avatar-lite-robot': {
    id: 'image-avatar-lite-robot',
    displayName: 'ImageAvatarLite robot',
    width: 320,
    height: 240,
    defaultExpression: 'normal',
    emotionMap: { neutral: 'normal', happy: 'surprised', sad: 'normal', angry: 'surprised', doubt: 'surprised' },
    expressions: {
      normal: expression({
        head: sprite('image-avatar-lite-robot-head.png', { x: 0, y: 0, width: 320, height: 240 }),
        eyes: {
          left: animated('image-avatar-lite-robot-eye-left-normal.png', { x: 162, y: 18, width: 32, height: 44 }),
          right: animated('image-avatar-lite-robot-eye-right-normal.png', { x: 116, y: 18, width: 32, height: 44 }),
        },
        mouth: animated('image-avatar-lite-robot-mouth-normal.png', { x: 66, y: 136, width: 188, height: 88 }),
      }),
      surprised: expression({
        head: sprite('image-avatar-lite-robot-head.png', { x: 0, y: 0, width: 320, height: 240 }),
        eyes: {
          left: animated('image-avatar-lite-robot-eye-left-surprised.png', { x: 214, y: 98, width: 32, height: 44 }),
          right: animated('image-avatar-lite-robot-eye-right-surprised.png', { x: 74, y: 98, width: 32, height: 44 }),
        },
        mouth: animated('image-avatar-lite-robot-mouth-surprised.png', { x: 66, y: 166, width: 188, height: 88 }),
      }),
    },
  },
  'image-avatar-lite-kaeru': {
    id: 'image-avatar-lite-kaeru',
    displayName: 'ImageAvatarLite kaeru',
    width: 320,
    height: 240,
    defaultExpression: 'normal',
    emotionMap: { neutral: 'normal', happy: 'surprised', sad: 'normal', angry: 'surprised', doubt: 'surprised' },
    expressions: {
      normal: expression({
        head: sprite('image-avatar-lite-kaeru-head.png', { x: 0, y: 0, width: 320, height: 240 }),
        eyes: {
          left: animated('image-avatar-lite-kaeru-eye-left-normal.png', { x: 188, y: 26, width: 64, height: 88 }),
          right: animated('image-avatar-lite-kaeru-eye-right-normal.png', { x: 68, y: 26, width: 64, height: 88 }),
        },
        mouth: animated('image-avatar-lite-kaeru-mouth-normal.png', { x: 66, y: 136, width: 188, height: 88 }),
      }),
      surprised: expression({
        head: sprite('image-avatar-lite-kaeru-head.png', { x: 0, y: 0, width: 320, height: 240 }),
        eyes: {
          left: animated('image-avatar-lite-kaeru-eye-left-surprised.png', { x: 198, y: 76, width: 64, height: 88 }),
          right: animated('image-avatar-lite-kaeru-eye-right-surprised.png', { x: 58, y: 76, width: 64, height: 88 }),
        },
        mouth: animated('image-avatar-lite-kaeru-mouth-surprised.png', { x: 66, y: 166, width: 188, height: 88 }),
      }),
    },
  },
}
