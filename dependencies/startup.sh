#!/bin/bash

{
    deploy_dir="/deploy"
    contract_dir="/contract"
    stat_file="$contract_dir/status.flag"
    cfg_dir="$contract_dir/cfg"
    cfg_bk_dir="$contract_dir/cfg-bk"

    if [ -f "$stat_file" ]; then
        status=$(cat $stat_file)
        if [ "$status" == "0" ]; then
            /usr/bin/node /usr/local/bin/hotpocket/lobby &
            other_pid=$!

            /usr/local/bin/hotpocket/hpcore $@ &
            hpcore_pid=$!

            wait -n $other_pid $hpcore_pid

        elif [ "$status" == "1" ]; then
            rm -rf $contract_dir/cfg
            mv $cfg_bk_dir $cfg_dir

            rm -rf $contract_dir/contract_fs
            mkdir -p $contract_dir/contract_fs/seed/state
            cp $deploy_dir/contract/* $contract_dir/contract_fs/seed/state/
            rm -rf $deploy_dir

            rm -rf $contract_dir/ledger_fs
            mkdir -p $contract_dir/ledger_fs/seed/primary

            rm -rf $contract_dir/log
            mkdir -p $contract_dir/log/contract

            echo 2 >$stat_file

        elif [ "$status" == "2"]; then
            /usr/bin/node /usr/local/bin/hotpocket/gp-port-server &
            other_pid=$!

            /usr/local/bin/hotpocket/hpcore $@ &
            hpcore_pid=$!

            wait -n $other_pid $hpcore_pid
            
        else
            echo "Unknown status"
        fi
    else
        /usr/bin/node /usr/local/bin/hotpocket/lobby &
        other_pid=$!

        wait -n $other_pid
    fi

    kill_processes() {
        [ -z $other_pid ] && kill $other_pid
        [ -z $hpcore_pid ] && kill $hpcore_pid
        [ -z $other_pid ] && wait $other_pid
        [ -z $hpcore_pid ] && wait $hpcore_pid
    }

    kill_processes
}
