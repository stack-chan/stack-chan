# API

[日本語](./api_ja.md)

The detailed API document is under construction.

Stack-chan firmware sources include `TSDoc` style comments.
The repository keeps `firmware/tsconfig.json` for Node-side checks and API document generation.

Generate documents under `docs/api` by running:

```console
$ npm run generate-apidoc
```

## Architecture

Mods receive a `StackchanContext` capability object from `onContextCreated`.
The context exposes a small set of capabilities so UI, motion, speech, and input implementations can be replaced independently.

- [StackchanContext](#stackchancontext): Runtime capabilities passed to mods
- [RobotUI](#robotui): Controls the Piu application, face, effects, and drawer UI
- [Motion capability](#motion-capability): Controls neck pose and gaze movement through the public motion API
- [Audio capability](#audio-capability): Plays speech through the public audio API

// TODO: Capability diagram and description

## Coordinate system

![coordinate for Stack-chan](./images/coordinate.jpg)

Stack-chan's coordinate system is a __right-handed__ system. When you bend your right hand's thumb, index finger, and middle finger so that they are perpendicular to each other, the thumb is the X-axis, the index finger is the Y-axis, and the middle finger is the Z-axis.

When Stack-chan's face is facing forward, the positive direction of each axis is as follows:

- Positive direction of X-axis... front of the face
- Positive direction of Y-axis... left side of the face
- Positive direction of Z-axis... head side

Also, the direction of rotation is the direction in which the right-hand screw advances in relation to the positive direction of the axis. In the case of Stack-chan's face, when rotating around each axis in the positive direction, it is as follows:

- Roll axis (rotation around X-axis) positive direction... Clockwise head tilt as seen from Stack-chan
- Pitch axis (rotation around Y-axis) positive direction... Stack-chan looking down
- Yaw axis (rotation around Z-axis) positive direction... Stack-chan looking to the left

In Stack-chan's API, __the unit of coordinates is meters and the unit of angles is radians__.
Correspondence with the coordinate system can also be referenced in the actual source code (e.g. [`mods/examples/look_around`](../mods/examples/look_around/) etc.).

## Public Types

### StackchanContext

### RobotUI

### Motion capability

The public motion API exposes `pose`, `lookAt`, `lookAway`, `setPose`, and `setTorque`.
Low-level driver objects are internal to `host/modules/motion` and are not exposed to MODs.

### Audio capability

The public audio API exposes speech playback through the capability object passed to MODs.
Provider objects for local, remote, Voicevox, ElevenLabs, and OpenAI speech are internal to `host/modules/audio`.

- [Using Text To Speech(TTS)](./text-to-speech.md)
