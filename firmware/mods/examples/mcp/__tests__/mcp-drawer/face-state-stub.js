export const EmotionNames = ['NEUTRAL', 'HAPPY']

export function emotionFromName(name) {
  return EmotionNames.indexOf(name)
}
