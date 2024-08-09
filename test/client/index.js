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
            if (inp === "upgrade") {
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

