#!/bin/bash
{
    if [ -d /deploy ]; then
        rm -rf '/contract/contract_fs/seed/state/bootstrap_contract'
        rm -rf '/contract/contract_fs/seed/state/bootstrap_upgrade.sh'
        rm -rf '/contract/cfg/hp.cfg'
        cp /deploy/contract/* /contract/contract_fs/seed/state/
        cp /deploy/hp.cfg /contract/cfg/
        rm -rf /deploy
    fi

    /usr/local/bin/hotpocket/hpcore "$@"
}
