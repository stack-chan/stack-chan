## Build and flash firmware

## Firmware architecture

![firmware architecture](./images/host-and-mod.jpg)

Stack-chan's firmware consists of a program that provide the basic operation of Stack-chan (host), and a user application (mod).
Once the host is written, the mod can be installed in a short time for fast development.
First write the host, and then write the mods as needed.

## Writing hosts

The following commands are used to build and write a host.

```console
# For M5Stack Basic/Gray/Fire
$ npm run build
$ npm run deploy

# For M5Stack CORE2
$ npm run build --target=esp32/m5stack_core2
$ npm run deploy --target=esp32/m5stack_core2
```

The program will be saved under the `$MODDABLE/build/` directory.

## Writing MODs

The following command is used to build and write a mod.

```console
# For M5Stack Basic/Gray/Fire
$ npm run mod [mod manifest file path]

# For M5Stack Core2
$ npm run mod --target=esp32/m5stack_core2 [mod manifest file path]
```

__Example: Installing [`mods/look_around`](../mods/look_around/)__

```console
$ npm run mod ./mods/look_around/manifest.json

> stack-chan@0.2.1 mod
> mcrun -d -m -p ${npm_config_target=esp32/m5stack} ${npm_argument} "./mods/look_around/manifest.json"

# xsc mod.xsb
# xsc check.xsb
# xsc mod/config.xsb
# xsl look_around.xsa
Installing mod...complete
```

## Next Step

- [mods/README.md](../mods/README.md): The list of example mods
- [API](./api.md): API document
