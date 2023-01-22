# API

The detailed API document is under construction.

The source codes of Stack-chan has `TSDoc` style comments.
You can generate documents under `docs/api` by running:

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

## Robot

## Renderer

## Driver

## TTS

- [Using Text To Speech(TTS)](./text-to-speech.md)