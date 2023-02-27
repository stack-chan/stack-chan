#!/bin/bash
xhost +local:
docker run \
    --rm -it \
    --privileged \
    --mount "type=volume,src=node_modules,dst=/workspace/node_modules" \
    --mount "type=bind,src=${PWD},dst=/workspace" \
    -v /dev:/dev \
    -e DISPLAY=$DISPLAY \
    --net=host \
    stack-chan/dev
xhost -local:
