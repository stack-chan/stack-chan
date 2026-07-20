const text = (value) => ({ shadow: { type: 'text', fields: { TEXT: value } } })
const variable = (id, name) => ({ id, name, type: '' })

export const VISUAL_SAMPLES = Object.freeze([
  {
    id: 'hello',
    title: '1. あいさつと表情',
    description: '起動時に笑顔で吹き出しを表示し、Aボタンで話します。',
    workspace: {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'stackchan_on_start',
            x: 24,
            y: 24,
            inputs: {
              DO: {
                block: {
                  type: 'stackchan_set_emotion',
                  fields: { EMOTION: 'HAPPY' },
                  next: { block: { type: 'stackchan_show_balloon', inputs: { TEXT: text('こんにちは!') } } },
                },
              },
            },
          },
          {
            type: 'stackchan_on_button',
            x: 24,
            y: 220,
            fields: { BUTTON: 'a' },
            inputs: { DO: { block: { type: 'stackchan_say', inputs: { TEXT: text('ぼく ｽﾀｯｸﾁｬﾝ!') } } } },
          },
        ],
      },
    },
  },
  {
    id: 'buttons',
    title: '2. ボタンでリアクション',
    description: 'A/B/Cボタンごとに異なる表情や音声を実行します。',
    workspace: {
      blocks: {
        languageVersion: 0,
        blocks: [
          ...['a', 'b', 'c'].map((button, index) => ({
            type: 'stackchan_on_button',
            x: 24 + index * 250,
            y: 24,
            fields: { BUTTON: button },
            inputs: {
              DO: {
                block: {
                  type: 'stackchan_set_emotion',
                  fields: { EMOTION: ['HAPPY', 'SLEEPY', 'DOUBTFUL'][index] },
                  next: {
                    block: { type: 'stackchan_say', inputs: { TEXT: text(`${button.toUpperCase()}ボタンだよ`) } },
                  },
                },
              },
            },
          })),
        ],
      },
    },
  },
  {
    id: 'timer-motion',
    title: '3. 定期的に見回す',
    description: '3秒ごとに向きを変え、少し待って正面へ戻ります。',
    workspace: {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'stackchan_every',
            x: 24,
            y: 24,
            fields: { SECONDS: 3 },
            inputs: {
              DO: {
                block: {
                  type: 'stackchan_look_at',
                  fields: { X: 1, Y: 0.5, Z: 0 },
                  next: {
                    block: {
                      type: 'stackchan_wait',
                      fields: { DURATION: 500 },
                      next: { block: { type: 'stackchan_look_away' } },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    },
  },
  {
    id: 'sensors',
    title: '4. センサーとLED',
    description: '振るとLEDを虹色にし、頭部を前方へスワイプすると吹き出しを表示します。',
    workspace: {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'stackchan_on_imu',
            x: 24,
            y: 24,
            fields: { MOTION: 'shake' },
            inputs: { DO: { block: { type: 'stackchan_light_rainbow', fields: { NAME: 'head' } } } },
          },
          {
            type: 'stackchan_on_head_touch',
            x: 340,
            y: 24,
            fields: { GESTURE: 'forwardSwipe' },
            inputs: {
              DO: { block: { type: 'stackchan_show_balloon', inputs: { TEXT: text('スワイプしたね!') } } },
            },
          },
        ],
      },
    },
  },
  {
    id: 'logic',
    title: '5. 条件とくり返し',
    description: 'リストを変数へ入れ、条件が真なら非同期のあいさつ関数を3回呼びます。',
    workspace: {
      variables: [{ name: 'あいさつ一覧', id: 'greetings', type: '' }],
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'procedures_defnoreturn',
            x: 390,
            y: 24,
            fields: { NAME: 'あいさつ' },
            inputs: {
              STACK: { block: { type: 'stackchan_say', inputs: { TEXT: text('やあ!') } } },
            },
          },
          {
            type: 'stackchan_on_start',
            x: 24,
            y: 24,
            inputs: {
              DO: {
                block: {
                  type: 'variables_set',
                  fields: { VAR: variable('greetings', 'あいさつ一覧') },
                  inputs: {
                    VALUE: {
                      block: {
                        type: 'lists_create_with',
                        extraState: { itemCount: 2 },
                        inputs: { ADD0: text('やあ!'), ADD1: text('こんにちは!') },
                      },
                    },
                  },
                  next: {
                    block: {
                      type: 'stackchan_show_balloon',
                      inputs: {
                        TEXT: {
                          block: {
                            type: 'lists_getIndex',
                            fields: { MODE: 'GET', WHERE: 'FIRST' },
                            inputs: {
                              VALUE: {
                                block: {
                                  type: 'variables_get',
                                  fields: { VAR: variable('greetings', 'あいさつ一覧') },
                                },
                              },
                            },
                          },
                        },
                      },
                      next: {
                        block: {
                          type: 'controls_if',
                          inputs: {
                            IF0: { block: { type: 'logic_boolean', fields: { BOOL: 'TRUE' } } },
                            DO0: {
                              block: {
                                type: 'controls_repeat_ext',
                                inputs: {
                                  TIMES: { shadow: { type: 'math_number', fields: { NUM: 3 } } },
                                  DO: {
                                    block: { type: 'procedures_callnoreturn', extraState: { name: 'あいさつ' } },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    },
  },
])

export function sampleById(id) {
  return VISUAL_SAMPLES.find((sample) => sample.id === id) ?? VISUAL_SAMPLES[0]
}
