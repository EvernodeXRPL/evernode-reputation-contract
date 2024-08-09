#!/bin/bash

img=evernodedev/reputation-v3

tmp=$(mktemp -d)
mkdir $tmp/contract
mkdir $tmp/lobby
mkdir $tmp/gp-port-server
cp ../../dist/* $tmp/contract/
cp -r ../../dependencies/lobby/dist/* $tmp/lobby/
cp -r ../../dependencies/gp-port-server/dist/* $tmp/gp-port-server/
cp ../../dependencies/startup.sh $tmp/

docker build -t $img:hp.latest-ubt.20.04 -t $img:hp.0.6.4-ubt.20.04 -f ./Dockerfile.ubt.20.04 $tmp
rm -r $tmp
