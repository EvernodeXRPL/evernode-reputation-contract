import { execSync } from 'child_process';
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const sodium = require('libsodium-wrappers');

const CONTRACT_PATH = "/contract";
const INIT_FLAG = "/init.flag";
const INSTANCE_INFO_FILE = "/instance.json";

function readHpCfg() {
    return JSON.parse(fs.readFileSync(`${CONTRACT_PATH}/cfg/hp.cfg`));
}

function writeHpCfg(cfg) {
    fs.writeFileSync(`${CONTRACT_PATH}/cfg/hp.cfg`, JSON.stringify(cfg, null, 2));
}

function updateHpContract(unl, peers) {
    if (fs.existsSync('/deploy')) {
        const out = execSync(`
                rm -rf ${CONTRACT_PATH}/contract_fs/seed/state/bootstrap_contract &&
                rm -rf ${CONTRACT_PATH}/contract_fs/seed/state/bootstrap_upgrade.sh &&
                cp /deploy/contract/* ${CONTRACT_PATH}/contract_fs/seed/state/ &&
                rm -rf /deploy
                `);
        console.log(out.toString());
    }

    console.log('Upgrading the config...');

    let cfg = readHpCfg();

    cfg.contract.consensus = {
        ...cfg.contract.consensus,
        roundtime: 10000,
        threshold: 60
    }
    cfg.contract.unl = unl;
    cfg.contract = {
        ...cfg.contract,
        bin_path: "/usr/bin/node",
        bin_args: "index.js"
    }


    cfg.mesh.peer_discovery = {
        ...cfg.mesh.peer_discovery,
        enabled: true
    }
    cfg.mesh.known_peers = peers;

    writeHpCfg(cfg);

    console.log('Writing init flag...');
    fs.writeFileSync(INIT_FLAG, '1');
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
        cert: fs.readFileSync(`${CONTRACT_PATH}/cfg/tlscert.pem`),
        key: fs.readFileSync(`${CONTRACT_PATH}/cfg/tlskey.pem`)
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
                    writeInstanceDetails(data.data.instanceDetails);

                    console.log('Upgrading the contract...');
                    updateHpContract(data.data.unl, data.data.peers);
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