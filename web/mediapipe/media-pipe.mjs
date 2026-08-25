const TASKS_VISION_VERSION = '0.10.35'
const TASKS_VISION_MODULE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/+esm`
const TASKS_VISION_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`
const FACE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const HAND_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

async function createLandmarkers(tasks, fileset, delegate) {
  const base = delegate ? { delegate } : {}
  const face = await tasks.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { ...base, modelAssetPath: FACE_MODEL },
    runningMode: 'VIDEO',
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  })
  try {
    const hands = await tasks.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { ...base, modelAssetPath: HAND_MODEL },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })
    return { face, hands }
  } catch (error) {
    face.close()
    throw error
  }
}

export async function loadMediaPipe() {
  const tasks = await import(TASKS_VISION_MODULE)
  const fileset = await tasks.FilesetResolver.forVisionTasks(TASKS_VISION_WASM)
  let landmarkers
  try {
    landmarkers = await createLandmarkers(tasks, fileset, 'GPU')
  } catch (gpuError) {
    console.warn('MediaPipe GPU delegate is unavailable; falling back to CPU.', gpuError)
    landmarkers = await createLandmarkers(tasks, fileset)
  }
  return {
    ...landmarkers,
    DrawingUtils: tasks.DrawingUtils,
    FaceLandmarker: tasks.FaceLandmarker,
    HandLandmarker: tasks.HandLandmarker,
  }
}
