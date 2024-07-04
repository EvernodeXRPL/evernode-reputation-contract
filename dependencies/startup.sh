#!/bin/bash

{
    /usr/bin/node /usr/local/bin/hotpocket/watchdog &
    /usr/local/bin/hotpocket/hpcore $@
}
