#!/bin/bash

{
    stat_file="/contract/status.flag"
    if [ -f "$stat_file" ]; then
        status=$(cat $stat_file)
        if [ "$status" == "0" ]; then
            /usr/bin/node /usr/local/bin/hotpocket/lobby &
            /usr/local/bin/hotpocket/hpcore $@
        elif [ "$status" == "1" ]; then
            /usr/bin/node /usr/local/bin/hotpocket/gp-port-server &
            /usr/local/bin/hotpocket/hpcore $@
        else
            echo "Unknown status"
        fi
    else
        /usr/bin/node /usr/local/bin/hotpocket/lobby
    fi
}
