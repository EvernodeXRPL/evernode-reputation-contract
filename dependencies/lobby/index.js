import { execSync } from 'child_process';
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');

function readHpCfg() {
    return JSON.parse(fs.readFileSync('/contract/cfg/hp.cfg'));
}

function writeHpCfg(cfg) {
    fs.writeFileSync('/contract/cfg/hp.cfg', JSON.stringify(cfg, null, 2));
}

async function updateHpContract(unl, peers) {
    if (fs.existsSync('/deploy')) {
        const out = execSync(`
                rm -rf /contract/contract_fs/seed/state/bootstrap_contract &&
                rm -rf /contract/contract_fs/seed/state/bootstrap_upgrade.sh &&
                cp /deploy/contract/* /contract/contract_fs/seed/state/ &&
                rm -rf /deploy
                `);
        console.log(out.toString());
    }

    console.log('Upgrading the config...');

    let cfg = readHpCfg();

    cfg.contract.consensus = {
        ...cfg.contract.consensus,
        roundtime: 10000,
        threshold: 50
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
    fs.writeFileSync('/init.flag', '1');
}

function lobby(handleData, handleError) {
    const cfg = readHpCfg();
    const userPort = cfg.user.port;

    const serverOptions = {
        cert: fs.readFileSync('/contract/cfg/tlscert.pem'),
        key: fs.readFileSync('/contract/cfg/tlskey.pem')
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
                handleData(data, ack, terminate);
            }
            catch (e) {
                console.error('Error occurred while handling the message.', e);
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
    lobby(async (data, ack, terminate) => {
        console.log('Received command :', data.type ?? 'unknown');
        switch (data.type) {
            case 'upgrade':
                try {
                    console.log('Upgrading the contract...');
                    await updateHpContract(data.data.unl, data.data.peers);
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