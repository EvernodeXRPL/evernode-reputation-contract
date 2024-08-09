const childProcess = require('child_process');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const sodium = require('libsodium-wrappers');

const CONTRACT_DIR_PATH = "/contract";
const DEPLOY_DIR_PATH = "/deploy";
const STATUS_FLAG = `${CONTRACT_DIR_PATH}/status.flag`;
const INSTANCE_INFO_FILE = `${CONTRACT_DIR_PATH}/instance.json`;
const HP_CFG_DIR_PATH = `${CONTRACT_DIR_PATH}/cfg`;
const PEER_LIST_SIZE = 20;

function readHpCfg(path = null) {
    return JSON.parse(fs.readFileSync(path || `${HP_CFG_DIR_PATH}/hp.cfg`));
}

function writeHpCfg(cfg, path = null) {
    fs.writeFileSync(path || `${HP_CFG_DIR_PATH}/hp.cfg`, JSON.stringify(cfg, null, 2));
}

function shuffle(array) {
    return array
        .map(value => ({ value, sort: (Math.random() * 1) }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value);
}

function updateHpContract(unl, peers) {
    if (fs.existsSync(DEPLOY_DIR_PATH)) {
        const out = childProcess.execSync(`
                rm -rf ${CONTRACT_DIR_PATH}/contract_fs/seed/state/bootstrap_contract &&
                rm -rf ${CONTRACT_DIR_PATH}/contract_fs/seed/state/bootstrap_upgrade.sh &&
                cp ${DEPLOY_DIR_PATH}/contract/* ${CONTRACT_DIR_PATH}/contract_fs/seed/state/ &&
                rm -rf ${DEPLOY_DIR_PATH}
                `);
        console.log(out.toString());
    }

    console.log('Upgrading the config...');

    let cfg = readHpCfg();

    const shuffledPeers = ((peers?.length ?? 0) > PEER_LIST_SIZE) ? shuffle(peers).slice(0, PEER_LIST_SIZE) : (peers ?? []);

    cfg.contract.consensus = {
        ...cfg.contract.consensus,
        roundtime: 10000,
        threshold: 51
    }
    cfg.contract.unl = unl;
    cfg.contract = {
        ...cfg.contract,
        bin_path: "/usr/bin/node",
        bin_args: "index.js"
    }

    cfg.mesh.msg_forwarding = true;
    cfg.mesh.peer_discovery = {
        ...cfg.mesh.peer_discovery,
        enabled: false
    }
    cfg.mesh.known_peers = shuffledPeers;

    writeHpCfg(cfg);
}

function writeInstanceDetails(instanceDetails) {
    fs.writeFileSync(INSTANCE_INFO_FILE, JSON.stringify(instanceDetails, null, 2));
}

async function lobby(handleData, handleError) {
    await sodium.ready;

    const cfg = readHpCfg();
    const userPort = cfg.user.port;
    const userPubkeyHex = cfg.contract.bin_args;
    const userPubkey = sodium.from_hex(userPubkeyHex.slice(2));

    const serverOptions = {
        cert: fs.readFileSync(`${HP_CFG_DIR_PATH}/tlscert.pem`),
        key: fs.readFileSync(`${HP_CFG_DIR_PATH}/tlskey.pem`)
    };

    const server = https.createServer(serverOptions);
    const wss = new WebSocket.Server({ server });

    const terminate = () => {
        server.close();
        wss.close();
    }

    wss.on('connection', function connection(ws) {
        console.log('A new client connected!');

        const ack = (response) => {
            ws.send(JSON.stringify(response));
        }

        ws.on('message', function incoming(message) {
            console.log('Received:', message.toString());
            try {
                const data = JSON.parse(message);
                console.log('Verifying the signature..');
                const signature = sodium.from_hex(data.signature);
                const isValid = sodium.crypto_sign_verify_detached(signature, data.message, userPubkey);
                if (!isValid) {
                    console.error('Invalid signature');
                    ack({
                        errorCode: 'UNAUTHORIZED',
                        e: 'Invalid signature'
                    });
                }
                else {
                    const obj = JSON.parse(data.message);
                    handleData(obj, ack, terminate);
                }

            }
            catch (e) {
                console.error('Error occurred while handling the message.', e);
                ack({
                    errorCode: 'UNKNOWN',
                    e: e
                });
            }
        });

        ws.on('close', function close() {
            console.log('Client disconnected');
        });

        ws.on('error', function error(err) {
            handleError('Server error:', err);
        });
    });

    server.listen(userPort, () => {
        console.log(`WebSocket server is running on wss://localhost:${userPort}`);
    });

    process.on('SIGINT', function () {
        terminate();
    });
}

async function main() {
    await lobby(async (data, ack, terminate) => {
        console.log('Received command :', data.type ?? 'unknown');
        switch (data.type) {
            case 'upgrade':
                try {
                    console.log('Writing the instance details...');
                    writeInstanceDetails(data.instanceDetails);

                    console.log('Upgrading the contract...');
                    updateHpContract(data.unl, data.peers);

                    console.log('Writing upgrade status flag...');
                    fs.writeFileSync(STATUS_FLAG, '1');

                    ack({
                        type: 'upgrade',
                        status: 'SUCCESS'
                    });

                    console.log('Terminating the connection...');
                    terminate();
                    process.exit(0);
                }
                catch (e) {
                    console.error(e);
                    ack({
                        type: 'upgrade',
                        status: 'ERROR',
                        data: e
                    });
                }
                break;
            default:
                break;
        }
    }, (err) => {
        console.error(err);
        process.exit(1);
    });
}

main().catch(console.error);