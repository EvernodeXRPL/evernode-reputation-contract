#!/bin/bash

{
    if [ -f /init.flag ]; then
        /usr/local/bin/hotpocket/hpcore "$@"
    else
        /usr/bin/node /usr/local/bin/hotpocket/lobby
    fi
}
