const WebSocket = require('ws');
const readline = require('readline');
const sodium = require('libsodium-wrappers');

let server = 'wss://localhost:8080'
if (process.argv.length == 3) server = 'wss://localhost:' + process.argv[2]
if (process.argv.length == 4) server = 'wss://' + process.argv[2] + ':' + process.argv[3]

// Connect to the WebSocket server using wss protocol
const ws = new WebSocket(server, {
    rejectUnauthorized: false // For self-signed certificates
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

ws.on('message', function incoming(data) {
    console.log('Received from server:', data.toString());
});

ws.on('close', function close() {
    console.log('Disconnected from the server');
});

ws.on('error', function error(err) {
    console.error('Client error:', err);
});

// On ctrl + c we should close connection gracefully.
rl.on('SIGINT', () => {
    console.log('SIGINT received...');
    rl.close();
    ws.close();
});

console.log("Ready to accept inputs.");
const inputPump = () => {
    rl.question('', async (inp) => {
        await sodium.ready;

        const userKey = sodium.from_hex('ed797ecd191b0364db559896c648c21cda7763db551a97577ed9ffb0ebb41881d8f9d1af6ff29af9287b0411758aac472016fb186220ef39db7959294c28857909');

        if (inp.length > 0) {
            if (inp === "run") {
                const message = JSON.stringify({
                    type: 'run',
                    instanceDetails: {
                        name: 'F920261F99FA543974B59784B375A7574563B0BB3989A026BC133AF463CDE52F',
                        pubkey: 'ed2d3d12a985c98cb0c185cb21116f006c77ce7bb2dc1e85a2a3e7b41e0cb37eff',
                        contract_id: 'f28b556b-174c-4783-8a94-fd78e15f967c',
                        peer_port: '22862',
                        user_port: '26202',
                        gp_tcp_port: '36527',
                        gp_udp_port: '39066',
                        domain: 'dapps-dev2.geveo.com',
                        outbound_ip: '2401:C080:2000:29EB:0000:0000:0000:0001',
                        created_timestamp: 1722859387193
                    }
                });
                const messageUint8 = sodium.from_string(message);
                const signature = sodium.crypto_sign_detached(messageUint8, userKey.slice(1));
                const signatureHex = sodium.to_hex(signature);

                console.log('Sending the message...');
                ws.send(JSON.stringify({
                    signature: signatureHex,
                    message: message
                }));
            }
            else if (inp === "upgrade") {
                const message = JSON.stringify({
                    type: 'upgrade',
                    unl: [
                        "ed41046de99622ed2699e7d18658e6f15a7353f2cbeb699515fd9a858f661209cf",
                        "ed24132e4c21c0f8e45178574d861b0b18711926e2ce5ded3fea53c321ac0bd6be"
                    ],
                    peers: [
                        "45.77.199.188:22861"
                    ]
                });
                const messageUint8 = sodium.from_string(message);
                const signature = sodium.crypto_sign_detached(messageUint8, userKey.slice(1));
                const signatureHex = sodium.to_hex(signature);

                console.log('Sending the message...');
                ws.send(JSON.stringify({
                    signature: signatureHex,
                    message: message
                }));
            }
        }
        inputPump();
    })
}
inputPump();

