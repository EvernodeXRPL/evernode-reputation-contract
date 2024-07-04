const WebSocket = require('ws');

const GP_PORT = 36525;
const server = new WebSocket.Server({ port: GP_PORT });

server.on('connection', (socket) => {
  console.log('Client connected');

  socket.on('message', (message) => {
    console.log('Received:', message.toString());
    // Echo the message back to the client
    socket.send(message);
  });

  socket.on('close', () => {
    console.log('Client disconnected');
  });

  socket.on('error', (error) => {
    console.error('Error:', error);
  });
});

console.log(`GP ports evaluationg server is running on ws://localhost:${GP_PORT}`);
