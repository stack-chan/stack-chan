#!/bin/bash
WORKDIR=/workspace
xhost +local:
docker run \
    --rm -it \
    --privileged \
    --group-add dialout \
    --user "$(id -u):$(id -g)" \
    --mount "type=bind,src=${PWD},dst=${WORKDIR}" \
    -e DISPLAY=$DISPLAY \
    --net=host \
    stack-chan/dev \
    bash
xhost -local:
