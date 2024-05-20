#!/bin/bash

img=evernodedev/reputation

tmp=$(mktemp -d)
mkdir $tmp/contract
mkdir $tmp/lobby
cp ../../dist/* $tmp/contract/
cp ../../dependencies/lobby/dist/* $tmp/lobby/
cp ../../dependencies/startup.sh $tmp/

docker build -t $img:hp.latest-ubt.20.04 -t $img:hp.0.6.4-ubt.20.04 -f ./Dockerfile.ubt.20.04 $tmp
rm -r $tmp
