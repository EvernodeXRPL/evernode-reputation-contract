#!/bin/bash

{
    deploy_dir="/deploy"
    contract_dir="/contract"
    stat_file="$contract_dir/status.flag"
    cfg_dir="$contract_dir/cfg"

    if [ -f "$stat_file" ]; then
        /usr/bin/node /usr/local/bin/hotpocket/gp-port-server &
        other_pid=$!

        /usr/local/bin/hotpocket/hpcore $@ &
        hpcore_pid=$!

        wait -n $other_pid $hpcore_pid
    else
        /usr/bin/node /usr/local/bin/hotpocket/lobby &
        other_pid=$!

        wait -n $other_pid
    fi

    kill_processes() {
        [ ! -z $other_pid ] && kill $other_pid
        [ ! -z $hpcore_pid ] && kill $hpcore_pid
        [ ! -z $other_pid ] && wait $other_pid
        [ ! -z $hpcore_pid ] && wait $hpcore_pid
    }

    kill_processes
}
