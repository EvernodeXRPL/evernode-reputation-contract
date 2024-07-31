const WebSocket = require('ws');
const https = require('https');
const dgram = require('dgram');
const fs = require('fs');
const crypto = require('node:crypto');

const CONTRACT_PATH = "/contract";
const INSTANCE_INFO_FILE = `${CONTRACT_PATH}/instance.json`;

let instanceInfo = null;
if (fs.existsSync(INSTANCE_INFO_FILE))
  instanceInfo = JSON.parse(fs.readFileSync(INSTANCE_INFO_FILE));

let pubkey = instanceInfo.pubkey;
const tcpPortList = instanceInfo?.gp_tcp_port ? [parseInt(instanceInfo.gp_tcp_port), parseInt(instanceInfo.gp_tcp_port) + 1] : [];
const udpPortList = instanceInfo?.gp_udp_port ? [parseInt(instanceInfo.gp_udp_port), parseInt(instanceInfo.gp_udp_port) + 1] : [];
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

tcpPortList.map((port) => {
  const serverAddr = `wss://${domain}:${port}`

  function logInf(...args) {
    console.log(`[GPTCPServer] ${serverAddr} -`, ...args);
  }

  function logErr(...args) {
    console.error(`[GPTCPServer] ${serverAddr} -`, ...args);
  }

  const server = https.createServer(serverOptions);
  const ws = new WebSocket.Server({ server });

  const terminate = () => {
    server.close();
    ws.close();
  }

  ws.on('connection', (ws) => {
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

  server.on('close', () => {
    logInf('Server terminated');
  });

  server.on('error', (error) => {
    logErr('Error:', error);
  });

  server.on('listening', () => {
    logInf('GP port evaluation server is running...');
  });

  server.listen(port);

  process.on('SIGINT', function () {
    terminate();
  });
});

udpPortList.map((port) => {
  const serverAddr = `wss://${domain}:${port}`

  function logInf(...args) {
    console.log(`[GPUDPServer] ${serverAddr} -`, ...args);
  }

  function logErr(...args) {
    console.error(`[GPUDPServer] ${serverAddr} -`, ...args);
  }

  const server = dgram.createSocket('udp4');

  const terminate = () => {
    server.close();
  }

  server.on('message', (message, rinfo) => {
    logInf('Received:', message.toString());
    // Do the pow and send result back to the client.
    const res = pow(message);
    server.send(res, rinfo.port, rinfo.address, (error) => {
      if (error)
        logErr('Send error:', error);
    });
  });

  server.on('close', () => {
    logInf('Server terminated');
  });

  server.on('error', (error) => {
    logErr('Error:', error);
  });

  server.on('listening', () => {
    logInf('GP port evaluation server is running...');
  });

  server.bind(port);

  process.on('SIGINT', function () {
    terminate();
  });
});
