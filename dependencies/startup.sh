#!/bin/bash

{
    if [ -f /contract/init.flag ]; then
        /usr/bin/node /usr/local/bin/hotpocket/gp-port-server &
        /usr/local/bin/hotpocket/hpcore $@
    else
        /usr/bin/node /usr/local/bin/hotpocket/lobby
    fi
}
