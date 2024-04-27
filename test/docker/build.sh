#!/bin/bash

img=evernode/reputation

tmp=$(mktemp -d)
mkdir $tmp/contract
cp ../../dist/index.js $tmp/contract
cp ../../dependencies/hp.cfg $tmp/
cp ../../dependencies/hpcore.sh $tmp/

docker build -t $img:hp.latest-ubt.20.04 -t $img:hp.0.6.4-ubt.20.04 -f ./Dockerfile.ubt.20.04 $tmp
docker build -t $img:hp.latest-ubt.20.04-njs.20 -t $img:hp.0.6.4-ubt.20.04-njs.20 -f ./Dockerfile.ubt.20.04-njs $tmp
rm -r $tmp
