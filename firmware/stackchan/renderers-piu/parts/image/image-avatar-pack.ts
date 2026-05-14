type Emotion = 'NEUTRAL' | 'ANGRY' | 'SAD' | 'HAPPY' | 'SLEEPY' | 'DOUBTFUL' | 'COLD' | 'HOT'

const Emotion = Object.freeze({
  NEUTRAL: 'NEUTRAL',
  ANGRY: 'ANGRY',
  SAD: 'SAD',
  HAPPY: 'HAPPY',
  SLEEPY: 'SLEEPY',
  DOUBTFUL: 'DOUBTFUL',
  COLD: 'COLD',
  HOT: 'HOT',
} as const)

export type ImageAvatarSpriteSheet = {
  texture: string
  frameWidth: number
  frameHeight: number
  frameCount: number
}

export type ImageAvatarStaticSprite = {
  texture: string
  color?: string
  x: number
  y: number
  width: number
  height: number
}

export type ImageAvatarEyeSprite = ImageAvatarStaticSprite & {
  blinkFrames: ImageAvatarSpriteSheet
}

export type ImageAvatarMouthSprite = ImageAvatarStaticSprite & {
  frames: ImageAvatarSpriteSheet
}

export type ImageAvatarExpression = {
  head: ImageAvatarStaticSprite
  eyes: {
    left: ImageAvatarEyeSprite
    right: ImageAvatarEyeSprite
  }
  mouth: ImageAvatarMouthSprite
  hands: {
    left: ImageAvatarStaticSprite
    right: ImageAvatarStaticSprite
  }
}

export type ImageAvatarPack = {
  id: string
  displayName: string
  width: number
  height: number
  defaultExpression: string
  emotionMap: Partial<Record<Emotion, string>>
  expressions: Record<string, ImageAvatarExpression>
}

const EXPRESSIONS = ['normal', 'happy', 'sad', 'angry'] as const
type DemoExpressionName = (typeof EXPRESSIONS)[number]

const DEMO_COLORS: Record<DemoExpressionName, { head: string; eye: string; mouth: string; hand: string }> = {
  normal: { head: '#ffe18e', eye: '#2a3757', mouth: '#96444e', hand: '#ff9a3d' },
  happy: { head: '#ffd97e', eye: '#24384c', mouth: '#dc506e', hand: '#ff8a2a' },
  sad: { head: '#b8dcff', eye: '#264876', mouth: '#485b87', hand: '#6faee6' },
  angry: { head: '#ffa882', eye: '#5c2a2a', mouth: '#78242d', hand: '#f0603d' },
}

function demoTexture(part: string, expression: DemoExpressionName): string {
  return `stackchan-demo-${part}-${expression}.png`
}

function demoExpression(expression: DemoExpressionName): ImageAvatarExpression {
  const colors = DEMO_COLORS[expression]
  return {
    head: {
      texture: demoTexture('head', expression),
      color: colors.head,
      x: 0,
      y: 0,
      width: 200,
      height: 120,
    },
    eyes: {
      left: {
        texture: demoTexture('eye-left', expression),
        color: colors.eye,
        x: 44,
        y: 36,
        width: 28,
        height: 28,
        blinkFrames: {
          texture: demoTexture('eye-left', expression),
          frameWidth: 28,
          frameHeight: 28,
          frameCount: 4,
        },
      },
      right: {
        texture: demoTexture('eye-right', expression),
        color: colors.eye,
        x: 128,
        y: 36,
        width: 28,
        height: 28,
        blinkFrames: {
          texture: demoTexture('eye-right', expression),
          frameWidth: 28,
          frameHeight: 28,
          frameCount: 4,
        },
      },
    },
    mouth: {
      texture: demoTexture('mouth', expression),
      color: colors.mouth,
      x: 60,
      y: 70,
      width: 80,
      height: 32,
      frames: {
        texture: demoTexture('mouth', expression),
        frameWidth: 80,
        frameHeight: 32,
        frameCount: 4,
      },
    },
    hands: {
      left: {
        texture: demoTexture('hand-left', expression),
        color: colors.hand,
        x: -8,
        y: 80,
        width: 42,
        height: 36,
      },
      right: {
        texture: demoTexture('hand-right', expression),
        color: colors.hand,
        x: 166,
        y: 80,
        width: 42,
        height: 36,
      },
    },
  }
}

export const STACKCHAN_DEMO_IMAGE_AVATAR_PACK: ImageAvatarPack = {
  id: 'stackchan-demo',
  displayName: 'Stack-chan demo sprite avatar',
  width: 200,
  height: 120,
  defaultExpression: 'normal',
  emotionMap: {
    [Emotion.NEUTRAL]: 'normal',
    [Emotion.HAPPY]: 'happy',
    [Emotion.SAD]: 'sad',
    [Emotion.ANGRY]: 'angry',
    [Emotion.SLEEPY]: 'sad',
    [Emotion.HOT]: 'happy',
    [Emotion.COLD]: 'sad',
  },
  expressions: {
    normal: demoExpression('normal'),
    happy: demoExpression('happy'),
    sad: demoExpression('sad'),
    angry: demoExpression('angry'),
  },
}

const IMAGE_AVATAR_LITE_PACKS: Record<string, ImageAvatarPack> = {
  'image-avatar-lite-slime': {
    id: 'image-avatar-lite-slime',
    displayName: 'ImageAvatarLite slime',
    width: 320,
    height: 240,
    defaultExpression: 'normal',
    emotionMap: {
      NEUTRAL: 'normal',
      SAD: 'sad',
      ANGRY: 'angry',
      HAPPY: 'normal',
      SLEEPY: 'sad',
      COLD: 'sad',
      HOT: 'angry',
    },
    expressions: {
      normal: {
        head: {
          texture: 'image-avatar-lite-slime-head.png',
          x: -10,
          y: -10,
          width: 340,
          height: 260,
        },
        eyes: {
          left: {
            texture: 'image-avatar-lite-slime-eye-left-normal.png',
            x: 170,
            y: 90,
            width: 40,
            height: 60,
            blinkFrames: {
              texture: 'image-avatar-lite-slime-eye-left-normal.png',
              frameWidth: 40,
              frameHeight: 60,
              frameCount: 2,
            },
          },
          right: {
            texture: 'image-avatar-lite-slime-eye-right-normal.png',
            x: 110,
            y: 90,
            width: 40,
            height: 60,
            blinkFrames: {
              texture: 'image-avatar-lite-slime-eye-right-normal.png',
              frameWidth: 40,
              frameHeight: 60,
              frameCount: 2,
            },
          },
        },
        mouth: {
          texture: 'image-avatar-lite-slime-mouth-normal.png',
          x: 130,
          y: 180,
          width: 60,
          height: 60,
          frames: {
            texture: 'image-avatar-lite-slime-mouth-normal.png',
            frameWidth: 60,
            frameHeight: 60,
            frameCount: 2,
          },
        },
        hands: {
          left: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
          right: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
        },
      },
      sad: {
        head: {
          texture: 'image-avatar-lite-slime-head.png',
          x: -10,
          y: -10,
          width: 340,
          height: 260,
        },
        eyes: {
          left: {
            texture: 'image-avatar-lite-slime-eye-left-sad.png',
            x: 180,
            y: 70,
            width: 40,
            height: 60,
            blinkFrames: {
              texture: 'image-avatar-lite-slime-eye-left-sad.png',
              frameWidth: 40,
              frameHeight: 60,
              frameCount: 2,
            },
          },
          right: {
            texture: 'image-avatar-lite-slime-eye-right-sad.png',
            x: 100,
            y: 70,
            width: 40,
            height: 60,
            blinkFrames: {
              texture: 'image-avatar-lite-slime-eye-right-sad.png',
              frameWidth: 40,
              frameHeight: 60,
              frameCount: 2,
            },
          },
        },
        mouth: {
          texture: 'image-avatar-lite-slime-mouth-sad.png',
          x: 130,
          y: 170,
          width: 60,
          height: 60,
          frames: {
            texture: 'image-avatar-lite-slime-mouth-sad.png',
            frameWidth: 60,
            frameHeight: 60,
            frameCount: 2,
          },
        },
        hands: {
          left: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
          right: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
        },
      },
      angry: {
        head: {
          texture: 'image-avatar-lite-slime-head.png',
          x: -10,
          y: -10,
          width: 340,
          height: 260,
        },
        eyes: {
          left: {
            texture: 'image-avatar-lite-slime-eye-left-angry.png',
            x: 180,
            y: 70,
            width: 40,
            height: 60,
            blinkFrames: {
              texture: 'image-avatar-lite-slime-eye-left-angry.png',
              frameWidth: 40,
              frameHeight: 60,
              frameCount: 2,
            },
          },
          right: {
            texture: 'image-avatar-lite-slime-eye-right-angry.png',
            x: 100,
            y: 70,
            width: 40,
            height: 60,
            blinkFrames: {
              texture: 'image-avatar-lite-slime-eye-right-angry.png',
              frameWidth: 40,
              frameHeight: 60,
              frameCount: 2,
            },
          },
        },
        mouth: {
          texture: 'image-avatar-lite-slime-mouth-angry.png',
          x: 130,
          y: 170,
          width: 60,
          height: 60,
          frames: {
            texture: 'image-avatar-lite-slime-mouth-angry.png',
            frameWidth: 60,
            frameHeight: 60,
            frameCount: 2,
          },
        },
        hands: {
          left: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
          right: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
        },
      },
    },
  },
  'image-avatar-lite-puipui': {
    id: 'image-avatar-lite-puipui',
    displayName: 'ImageAvatarLite puipui',
    width: 320,
    height: 240,
    defaultExpression: 'normal',
    emotionMap: {
      NEUTRAL: 'normal',
      HAPPY: 'normal',
      SAD: 'normal',
      ANGRY: 'normal',
      SLEEPY: 'normal',
      DOUBTFUL: 'normal',
      COLD: 'normal',
      HOT: 'normal',
    },
    expressions: {
      normal: {
        head: {
          texture: 'image-avatar-lite-puipui-head.png',
          x: 0,
          y: 0,
          width: 320,
          height: 240,
        },
        eyes: {
          left: {
            texture: 'image-avatar-lite-puipui-eye-left-normal.png',
            x: 175,
            y: 95,
            width: 50,
            height: 50,
            blinkFrames: {
              texture: 'image-avatar-lite-puipui-eye-left-normal.png',
              frameWidth: 50,
              frameHeight: 50,
              frameCount: 2,
            },
          },
          right: {
            texture: 'image-avatar-lite-puipui-eye-right-normal.png',
            x: 95,
            y: 95,
            width: 50,
            height: 50,
            blinkFrames: {
              texture: 'image-avatar-lite-puipui-eye-right-normal.png',
              frameWidth: 50,
              frameHeight: 50,
              frameCount: 2,
            },
          },
        },
        mouth: {
          texture: 'image-avatar-lite-puipui-mouth-normal.png',
          x: 130,
          y: 170,
          width: 60,
          height: 60,
          frames: {
            texture: 'image-avatar-lite-puipui-mouth-normal.png',
            frameWidth: 60,
            frameHeight: 60,
            frameCount: 2,
          },
        },
        hands: {
          left: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
          right: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
        },
      },
    },
  },
  'image-avatar-lite-jacko': {
    id: 'image-avatar-lite-jacko',
    displayName: 'ImageAvatarLite jack-o-lantern',
    width: 320,
    height: 240,
    defaultExpression: 'normal',
    emotionMap: {
      NEUTRAL: 'normal',
      HAPPY: 'normal',
      SAD: 'normal',
      ANGRY: 'normal',
      SLEEPY: 'normal',
      DOUBTFUL: 'normal',
      COLD: 'normal',
      HOT: 'normal',
    },
    expressions: {
      normal: {
        head: {
          texture: 'image-avatar-lite-jacko-head.png',
          x: 0,
          y: 0,
          width: 320,
          height: 240,
        },
        eyes: {
          left: {
            texture: 'image-avatar-lite-jacko-eye-left-normal.png',
            x: 210,
            y: 50,
            width: 60,
            height: 60,
            blinkFrames: {
              texture: 'image-avatar-lite-jacko-eye-left-normal.png',
              frameWidth: 60,
              frameHeight: 60,
              frameCount: 2,
            },
          },
          right: {
            texture: 'image-avatar-lite-jacko-eye-right-normal.png',
            x: 50,
            y: 50,
            width: 60,
            height: 60,
            blinkFrames: {
              texture: 'image-avatar-lite-jacko-eye-right-normal.png',
              frameWidth: 60,
              frameHeight: 60,
              frameCount: 2,
            },
          },
        },
        mouth: {
          texture: 'image-avatar-lite-jacko-mouth-normal.png',
          x: 76,
          y: 170,
          width: 168,
          height: 60,
          frames: {
            texture: 'image-avatar-lite-jacko-mouth-normal.png',
            frameWidth: 168,
            frameHeight: 60,
            frameCount: 2,
          },
        },
        hands: {
          left: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
          right: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
        },
      },
    },
  },
  'image-avatar-lite-girl': {
    id: 'image-avatar-lite-girl',
    displayName: 'ImageAvatarLite girl',
    width: 320,
    height: 240,
    defaultExpression: 'normal',
    emotionMap: {
      NEUTRAL: 'normal',
      SAD: 'sleepy',
      ANGRY: 'grim',
      HAPPY: 'normal',
      SLEEPY: 'sleepy',
      DOUBTFUL: 'grim',
    },
    expressions: {
      normal: {
        head: {
          texture: 'image-avatar-lite-girl-head.png',
          x: 0,
          y: 0,
          width: 320,
          height: 240,
        },
        eyes: {
          left: {
            texture: 'image-avatar-lite-girl-eye-left-normal.png',
            x: 184,
            y: 74,
            width: 102,
            height: 112,
            blinkFrames: {
              texture: 'image-avatar-lite-girl-eye-left-normal.png',
              frameWidth: 102,
              frameHeight: 112,
              frameCount: 2,
            },
          },
          right: {
            texture: 'image-avatar-lite-girl-eye-right-normal.png',
            x: 34,
            y: 74,
            width: 102,
            height: 112,
            blinkFrames: {
              texture: 'image-avatar-lite-girl-eye-right-normal.png',
              frameWidth: 102,
              frameHeight: 112,
              frameCount: 2,
            },
          },
        },
        mouth: {
          texture: 'image-avatar-lite-girl-mouth-normal.png',
          x: 123,
          y: 168,
          width: 74,
          height: 74,
          frames: {
            texture: 'image-avatar-lite-girl-mouth-normal.png',
            frameWidth: 74,
            frameHeight: 74,
            frameCount: 2,
          },
        },
        hands: {
          left: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
          right: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
        },
      },
      sleepy: {
        head: {
          texture: 'image-avatar-lite-girl-head.png',
          x: 0,
          y: 0,
          width: 320,
          height: 240,
        },
        eyes: {
          left: {
            texture: 'image-avatar-lite-girl-eye-left-sleepy.png',
            x: 179,
            y: 74,
            width: 102,
            height: 112,
            blinkFrames: {
              texture: 'image-avatar-lite-girl-eye-left-sleepy.png',
              frameWidth: 102,
              frameHeight: 112,
              frameCount: 2,
            },
          },
          right: {
            texture: 'image-avatar-lite-girl-eye-right-sleepy.png',
            x: 39,
            y: 74,
            width: 102,
            height: 112,
            blinkFrames: {
              texture: 'image-avatar-lite-girl-eye-right-sleepy.png',
              frameWidth: 102,
              frameHeight: 112,
              frameCount: 2,
            },
          },
        },
        mouth: {
          texture: 'image-avatar-lite-girl-mouth-sleepy.png',
          x: 123,
          y: 168,
          width: 74,
          height: 74,
          frames: {
            texture: 'image-avatar-lite-girl-mouth-sleepy.png',
            frameWidth: 74,
            frameHeight: 74,
            frameCount: 2,
          },
        },
        hands: {
          left: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
          right: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
        },
      },
      grim: {
        head: {
          texture: 'image-avatar-lite-girl-head.png',
          x: 0,
          y: 0,
          width: 320,
          height: 240,
        },
        eyes: {
          left: {
            texture: 'image-avatar-lite-girl-eye-left-grim.png',
            x: 179,
            y: 74,
            width: 102,
            height: 112,
            blinkFrames: {
              texture: 'image-avatar-lite-girl-eye-left-grim.png',
              frameWidth: 102,
              frameHeight: 112,
              frameCount: 2,
            },
          },
          right: {
            texture: 'image-avatar-lite-girl-eye-right-grim.png',
            x: 39,
            y: 74,
            width: 102,
            height: 112,
            blinkFrames: {
              texture: 'image-avatar-lite-girl-eye-right-grim.png',
              frameWidth: 102,
              frameHeight: 112,
              frameCount: 2,
            },
          },
        },
        mouth: {
          texture: 'image-avatar-lite-girl-mouth-grim.png',
          x: 123,
          y: 168,
          width: 74,
          height: 74,
          frames: {
            texture: 'image-avatar-lite-girl-mouth-grim.png',
            frameWidth: 74,
            frameHeight: 74,
            frameCount: 2,
          },
        },
        hands: {
          left: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
          right: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
        },
      },
    },
  },
  'image-avatar-lite-robot': {
    id: 'image-avatar-lite-robot',
    displayName: 'ImageAvatarLite robot',
    width: 320,
    height: 240,
    defaultExpression: 'normal',
    emotionMap: {
      NEUTRAL: 'normal',
      HAPPY: 'surprised',
      SAD: 'normal',
      ANGRY: 'surprised',
      DOUBTFUL: 'surprised',
    },
    expressions: {
      normal: {
        head: {
          texture: 'image-avatar-lite-robot-head.png',
          x: 0,
          y: 0,
          width: 320,
          height: 240,
        },
        eyes: {
          left: {
            texture: 'image-avatar-lite-robot-eye-left-normal.png',
            x: 162,
            y: 18,
            width: 32,
            height: 44,
            blinkFrames: {
              texture: 'image-avatar-lite-robot-eye-left-normal.png',
              frameWidth: 32,
              frameHeight: 44,
              frameCount: 2,
            },
          },
          right: {
            texture: 'image-avatar-lite-robot-eye-right-normal.png',
            x: 116,
            y: 18,
            width: 32,
            height: 44,
            blinkFrames: {
              texture: 'image-avatar-lite-robot-eye-right-normal.png',
              frameWidth: 32,
              frameHeight: 44,
              frameCount: 2,
            },
          },
        },
        mouth: {
          texture: 'image-avatar-lite-robot-mouth-normal.png',
          x: 66,
          y: 136,
          width: 188,
          height: 88,
          frames: {
            texture: 'image-avatar-lite-robot-mouth-normal.png',
            frameWidth: 188,
            frameHeight: 88,
            frameCount: 2,
          },
        },
        hands: {
          left: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
          right: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
        },
      },
      surprised: {
        head: {
          texture: 'image-avatar-lite-robot-head.png',
          x: 0,
          y: 0,
          width: 320,
          height: 240,
        },
        eyes: {
          left: {
            texture: 'image-avatar-lite-robot-eye-left-surprised.png',
            x: 214,
            y: 98,
            width: 32,
            height: 44,
            blinkFrames: {
              texture: 'image-avatar-lite-robot-eye-left-surprised.png',
              frameWidth: 32,
              frameHeight: 44,
              frameCount: 2,
            },
          },
          right: {
            texture: 'image-avatar-lite-robot-eye-right-surprised.png',
            x: 74,
            y: 98,
            width: 32,
            height: 44,
            blinkFrames: {
              texture: 'image-avatar-lite-robot-eye-right-surprised.png',
              frameWidth: 32,
              frameHeight: 44,
              frameCount: 2,
            },
          },
        },
        mouth: {
          texture: 'image-avatar-lite-robot-mouth-surprised.png',
          x: 66,
          y: 166,
          width: 188,
          height: 88,
          frames: {
            texture: 'image-avatar-lite-robot-mouth-surprised.png',
            frameWidth: 188,
            frameHeight: 88,
            frameCount: 2,
          },
        },
        hands: {
          left: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
          right: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
        },
      },
    },
  },
  'image-avatar-lite-kaeru': {
    id: 'image-avatar-lite-kaeru',
    displayName: 'ImageAvatarLite kaeru',
    width: 320,
    height: 240,
    defaultExpression: 'normal',
    emotionMap: {
      NEUTRAL: 'normal',
      HAPPY: 'surprised',
      SAD: 'normal',
      ANGRY: 'surprised',
      DOUBTFUL: 'surprised',
    },
    expressions: {
      normal: {
        head: {
          texture: 'image-avatar-lite-kaeru-head.png',
          x: 0,
          y: 0,
          width: 320,
          height: 240,
        },
        eyes: {
          left: {
            texture: 'image-avatar-lite-kaeru-eye-left-normal.png',
            x: 188,
            y: 26,
            width: 64,
            height: 88,
            blinkFrames: {
              texture: 'image-avatar-lite-kaeru-eye-left-normal.png',
              frameWidth: 64,
              frameHeight: 88,
              frameCount: 2,
            },
          },
          right: {
            texture: 'image-avatar-lite-kaeru-eye-right-normal.png',
            x: 68,
            y: 26,
            width: 64,
            height: 88,
            blinkFrames: {
              texture: 'image-avatar-lite-kaeru-eye-right-normal.png',
              frameWidth: 64,
              frameHeight: 88,
              frameCount: 2,
            },
          },
        },
        mouth: {
          texture: 'image-avatar-lite-kaeru-mouth-normal.png',
          x: 66,
          y: 136,
          width: 188,
          height: 88,
          frames: {
            texture: 'image-avatar-lite-kaeru-mouth-normal.png',
            frameWidth: 188,
            frameHeight: 88,
            frameCount: 2,
          },
        },
        hands: {
          left: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
          right: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
        },
      },
      surprised: {
        head: {
          texture: 'image-avatar-lite-kaeru-head.png',
          x: 0,
          y: 0,
          width: 320,
          height: 240,
        },
        eyes: {
          left: {
            texture: 'image-avatar-lite-kaeru-eye-left-surprised.png',
            x: 198,
            y: 76,
            width: 64,
            height: 88,
            blinkFrames: {
              texture: 'image-avatar-lite-kaeru-eye-left-surprised.png',
              frameWidth: 64,
              frameHeight: 88,
              frameCount: 2,
            },
          },
          right: {
            texture: 'image-avatar-lite-kaeru-eye-right-surprised.png',
            x: 58,
            y: 76,
            width: 64,
            height: 88,
            blinkFrames: {
              texture: 'image-avatar-lite-kaeru-eye-right-surprised.png',
              frameWidth: 64,
              frameHeight: 88,
              frameCount: 2,
            },
          },
        },
        mouth: {
          texture: 'image-avatar-lite-kaeru-mouth-surprised.png',
          x: 66,
          y: 166,
          width: 188,
          height: 88,
          frames: {
            texture: 'image-avatar-lite-kaeru-mouth-surprised.png',
            frameWidth: 188,
            frameHeight: 88,
            frameCount: 2,
          },
        },
        hands: {
          left: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
          right: {
            texture: 'image-avatar-lite-transparent.png',
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
        },
      },
    },
  },
}

export const IMAGE_AVATAR_PACKS: Record<string, ImageAvatarPack> = {
  [STACKCHAN_DEMO_IMAGE_AVATAR_PACK.id]: STACKCHAN_DEMO_IMAGE_AVATAR_PACK,
  ...IMAGE_AVATAR_LITE_PACKS,
}

export function getImageAvatarPack(id: string | undefined): ImageAvatarPack {
  return IMAGE_AVATAR_PACKS[id ?? STACKCHAN_DEMO_IMAGE_AVATAR_PACK.id] ?? STACKCHAN_DEMO_IMAGE_AVATAR_PACK
}
