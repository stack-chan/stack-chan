# API

[日本語](./api_ja.md)

The detailed API document is under construction.

The source codes of Stack-chan has `TSDoc` style comments.

For generating documents, you need `tsconfig.json` under `firmware` directory.
To do this, run `build` task once.
It automatically generates `tsconfig.json` and creates a link.

```console
$ npm run build
...
> stack-chan@0.2.1 postbuild /home/user/repos/stack-chan/firmware
> ln -sf $MODDABLE/build/tmp/${npm_config_target=esp32/m5stack}/debug/stackchan/modules/tsconfig.json ./tsconfig.json

$ file tsconfig.json
tsconfig.json: symbolic link to /home/user/.local/share/moddable/build/tmp/esp32/m5stack/debug/stackchan/modules/tsconfig.json
```

Then you can generate documents under `docs/api` by running:

```console
$ npm run generate-apidoc
```

## Architecture

The `Robot` class is used to access the functions of the Stack-chan.
The following classes are defined to allow replacement and customization of Stack-chan functions.

- [Renderer](#renderer): Draw a face
- [Driver](#driver): Drives motors, etc.
- [TTS](#tts): Speech synthesis

// TODO: Class diagram and description

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
Correspondence with the coordinate system can also be referenced in the actual source code (e.g. [`mods/look_around`](../mods/look_around/) etc.)"

## Classes

### Robot

### Renderer

### Driver

### TTS

- [Using Text To Speech(TTS)](./text-to-speech.md)
