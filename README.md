# Evernode reputation contract

Evernode reputation contract used by ReputationD on host machine as the contract of keeping track of reputations of the hosts. This contract's purpose is to collect reputation of the hosts in the same universe and record it in a file. Then ReputationD will submit the reputation scores to the Reputation Hook.

## Development test
- If you are running on hpdevkit.
  - Create `hp.cfg.override` file with following content inside the `./dist` directory.
    ```json
    {
        "contract": {
            "bin_path": "/usr/bin/node",
            "bin_args": "index.js"
        }
    }
    ```
  - Run `npm start`
- If you are trying to create a local docker cluster.
  - Go to `./test/local-cluster` directory/
  - Run `./cluster-create <number-of-nodes>` to initiate cluster.
  - Run `./cluster-start <node-number>` to start the instances.