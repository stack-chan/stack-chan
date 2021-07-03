#!/bin/bash
xhost +local:
docker run \
    --rm -it \
    --privileged \
    -v $PWD:/workspace \
    -v /dev:/dev \
    -e DISPLAY=$DISPLAY \
    --net=host \
    m5stachchan/dev
xhost -local:
