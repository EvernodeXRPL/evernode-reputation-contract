#!/bin/bash

# Runs the specified node of the local cluster with hpcore docker image. (created via cluster-create.sh)
# This script assumes you already have the hpcore docker image and 'repnet' virtual docker network.
# Usage (to run the node no. 1): ./cluster-start.sh 1

# Validate the node count arg.
if [ -n "$1" ] && [ "$1" -eq "$1" ] 2>/dev/null; then
  echo "Starting docker container..."
else
  echo "Error: Please provide node ID to run."
  exit 1
fi

clusterloc=$(pwd)/repcluster
n=$1
iprange="172.1.2"
repimage="evernodedev/reputation-v3:hp.latest-ubt.20.04"

let pubport=8080+$n
let peerport=22860+$n
let gptcpport=$((36523 + 2 * n))
let gpudpport=$((39062 + 2 * n))

# Mount the node<id> contract directory into hpcore docker container and run.
# We specify --network=repnet so all nodes will communicate via 'repnet' docker virtual network.
# We specify --name for each node so it will be the virtual dns name for each node.
docker run --rm -t -i --network=repnet --ip=${iprange}.${n} --name=node${n} \
  -p ${pubport}:${pubport} \
  -p ${peerport}:${peerport} \
  -p ${gptcpport}:${gptcpport} \
  -p $((gptcpport + 1)):$((gptcpport + 1)) \
  -p ${gpudpport}:${gpudpport} \
  -p $((gpudpport + 1)):$((gpudpport + 1)) \
  --device /dev/fuse --cap-add SYS_ADMIN --security-opt apparmor:unconfined \
  --mount type=bind,source=${clusterloc}/node${n},target=/contract \
  ${repimage} run /contract
