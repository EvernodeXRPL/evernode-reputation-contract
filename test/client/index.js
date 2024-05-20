const WebSocket = require('ws');
const readline = require('readline');

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
    rl.question('', (inp) => {

        if (inp.length > 0) {
            if (inp === "upgrade") {
                ws.send(JSON.stringify({
                    type: 'upgrade',
                    data: {
                        unl: [
                            "ed41046de99622ed2699e7d18658e6f15a7353f2cbeb699515fd9a858f661209cf",
                            "ed8b91e708d8877a1586b5b09bd021856ed84fe92451df7efe02a6313371d78a3b"
                        ],
                        peers: [
                            "45.77.199.188:22861"
                        ]
                    }
                }));
            }
        }
        inputPump();
    })
}
inputPump();

