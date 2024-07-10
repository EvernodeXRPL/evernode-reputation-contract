const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');
const crypto = require('node:crypto');

const CONTRACT_PATH = "/contract";
const INSTANCE_INFO_FILE = `${CONTRACT_PATH}/instance.json`;

let instanceInfo = null;
if (fs.existsSync(INSTANCE_INFO_FILE))
  instanceInfo = JSON.parse(fs.readFileSync(INSTANCE_INFO_FILE));

let pubkey = instanceInfo.pubkey;
const tcpPortList = instanceInfo ? [instanceInfo.gp_tcp_port, instanceInfo.gp_tcp_port + 1] : [];
const udpPortList = instanceInfo ? [instanceInfo.gp_udp_port, instanceInfo.gp_udp_port + 1] : [];
const domain = instanceInfo.domain;

const serverOptions = {
  cert: fs.readFileSync(`${CONTRACT_PATH}/cfg/tlscert.pem`),
  key: fs.readFileSync(`${CONTRACT_PATH}/cfg/tlskey.pem`)
};

const pow = (message) => {
  const portEvalpow = getShaHash(`${message}${pubkey}`);
  return portEvalpow;
}

function getShaHash(input) {
  let buf = Buffer.from(input, "hex");
  return crypto.createHash('sha512').update(buf).digest('hex');
}

[...tcpPortList, ...udpPortList].map((port) => {
  const serverAddr = `wss://${domain}:${port}`

  function logInf(...args) {
    console.log(`[GPServer] ${serverAddr} -`, ...args);
  }

  function logErr(...args) {
    console.error(`[GPServer] ${serverAddr} -`, ...args);
  }

  const server = https.createServer(serverOptions);
  const ws = new WebSocket.Server({ server });

  const terminate = () => {
    server.close();
    ws.close();
  }

  ws.on('connection', function connection(ws) {
    logInf('Client connected');

    ws.on('message', (message) => {
      logInf('Received:', message.toString());
      // Do the pow and send result back to the client.
      const res = pow(message);
      ws.send(res);
    });

    ws.on('close', () => {
      logInf('Client disconnected');
    });

    ws.on('error', (error) => {
      logErr('Error:', error);
    });
  });

  server.listen(port, () => {
    logInf('GP port evaluation server is running...');
  });

  process.on('SIGINT', function () {
    terminate();
  });
});
