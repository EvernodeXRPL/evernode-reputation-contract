const childProcess = require('child_process');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const sodium = require('libsodium-wrappers');
const uuid = require('uuid');

const CONTRACT_DIR_PATH = "/contract";
const STATUS_FLAG = `${CONTRACT_DIR_PATH}/status.flag`;
const INSTANCE_INFO_FILE = `${CONTRACT_DIR_PATH}/instance.json`;
const HP_CFG_DIR_PATH = `${CONTRACT_DIR_PATH}/cfg`;
const HP_CFG_BK_DIR_PATH = `${CONTRACT_DIR_PATH}/cfg-bk`;
const PEER_LIST_SIZE = 20;

function readHpCfg(path = null) {
    return JSON.parse(fs.readFileSync(path || `${CONTRACT_DIR_PATH}/cfg/hp.cfg`));
}

function writeHpCfg(cfg, path = null) {
    fs.writeFileSync(path || `${CONTRACT_DIR_PATH}/cfg/hp.cfg`, JSON.stringify(cfg, null, 2));
}

function readInstanceInfo() {
    return fs.existsSync(INSTANCE_INFO_FILE) ? JSON.parse(fs.readFileSync(INSTANCE_INFO_FILE)) : null;
}

function generateContractId(unl) {
    const sorted = unl.sort();
    const id = uuid.v4({
        random: Buffer.from(sorted.length > 0 ? sorted[0] : 'edd6cf8900758cc0107194df27736b1c92afb2c006bd165b5a1c196dba2a9c2418', 'hex')
    });

    return id;
}

function shuffle(array) {
    return array
        .map(value => ({ value, sort: (Math.random() * 1) }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value);
}

function updateHpContract(unl, peers) {
    const out = childProcess.execSync(`cp -r ${HP_CFG_DIR_PATH} ${HP_CFG_BK_DIR_PATH}`);
    console.log(out.toString());

    const hpCfgBk = `${HP_CFG_BK_DIR_PATH}/hp.cfg`;

    console.log('Upgrading the config...');

    let cfg = readHpCfg(hpCfgBk);

    const contractId = generateContractId(unl);
    const shuffledPeers = ((peers?.length ?? 0) > PEER_LIST_SIZE) ? shuffle(peers).slice(0, PEER_LIST_SIZE) : (peers ?? []);

    cfg.contract.consensus = {
        ...cfg.contract.consensus,
        roundtime: 10000,
        threshold: 51
    }
    cfg.contract.unl = unl;
    cfg.contract = {
        ...cfg.contract,
        id: contractId,
        bin_path: "/usr/bin/node",
        bin_args: "index.js"
    }


    cfg.mesh.msg_forwarding = true;
    cfg.mesh.peer_discovery = {
        ...cfg.mesh.peer_discovery,
        enabled: false
    }
    cfg.mesh.known_peers = shuffledPeers;

    writeHpCfg(cfg, hpCfgBk);
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
        cert: fs.readFileSync(`${CONTRACT_DIR_PATH}/cfg/tlscert.pem`),
        key: fs.readFileSync(`${CONTRACT_DIR_PATH}/cfg/tlskey.pem`)
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