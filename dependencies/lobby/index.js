const childProcess = require('child_process');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const sodium = require('libsodium-wrappers');

const CONTRACT_PATH = "/contract";
const STATUS_FLAG = `${CONTRACT_PATH}/status.flag`;
const INSTANCE_INFO_FILE = `${CONTRACT_PATH}/instance.json`;

function readHpCfg() {
    return JSON.parse(fs.readFileSync(`${CONTRACT_PATH}/cfg/hp.cfg`));
}

function writeHpCfg(cfg) {
    fs.writeFileSync(`${CONTRACT_PATH}/cfg/hp.cfg`, JSON.stringify(cfg, null, 2));
}

function readInstanceInfo() {
    return fs.existsSync(INSTANCE_INFO_FILE) ? JSON.parse(fs.readFileSync(INSTANCE_INFO_FILE)) : null;
}

function updateHpContract(unl, peers) {
    if (fs.existsSync('/deploy')) {
        const out = childProcess.execSync(`
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
}

function writeInstanceDetails(instanceDetails) {
    fs.writeFileSync(INSTANCE_INFO_FILE, JSON.stringify(instanceDetails, null, 2));
}

async function lobby(handleData, handleError) {
    await sodium.ready;

    const instanceInfo = readInstanceInfo();

    const cfg = readHpCfg();
    const port = instanceInfo?.gp_tcp_port ? parseInt(instanceInfo?.gp_tcp_port) : cfg.user.port;
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

    server.listen(port, () => {
        console.log(`WebSocket ${instanceInfo?.gp_tcp_port ? `[upgrade]` : `[prep]`} server is running on wss://localhost:${port}`);
    });

    process.on('SIGINT', function () {
        terminate();
    });
}

async function main() {
    await lobby(async (data, ack, terminate) => {
        console.log('Received command :', data.type ?? 'unknown');
        switch (data.type) {
            case 'run':
                try {
                    console.log('Writing the instance details...');
                    writeInstanceDetails(data.instanceDetails);

                    console.log('Writing run status flag...');
                    fs.writeFileSync(STATUS_FLAG, '0');

                    ack({
                        type: 'run',
                        status: 'SUCCESS'
                    });

                    console.log('Terminating the connection...');
                    terminate();
                    process.exit(0);
                }
                catch (e) {
                    console.error(e);
                    ack({
                        type: 'run',
                        status: 'ERROR',
                        data: e
                    });
                }
                break;
            case 'upgrade':
                try {
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