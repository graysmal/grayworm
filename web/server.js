const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { chooseEffect } = require('../server/effects');

// Start in the closed state whenever the server starts.
let state = 'close';

// __dirname is the directory containing this server.js file.
const pagePath = path.join(__dirname, 'index.html');

const server = http.createServer((req, res) => {
  // Helper for returning JSON responses.
  function reply(status, value) {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    });

    res.end(JSON.stringify(value));
  }

  // Serve the control page.
  if (req.method === 'GET' && req.url === '/') {
    return fs.readFile(pagePath, (error, page) => {
      if (error) {
        console.error('Could not load index.html:', error);
        return reply(500, { error: 'Could not load page' });
      }

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      });

      res.end(page);
    });
  }

  // Return the current state.
  if (req.method === 'GET' && req.url === '/api/state') {
    return reply(200, { state });
  }

  // Return an effect when the program is open.
  if (req.method === 'GET' && req.url === '/api/effect') {
    return reply(200, {
      state,
      effect: state === 'open' ? chooseEffect() : null
    });
  }

  // Flip between open and close.
  if (req.method === 'POST' && req.url === '/api/toggle') {
    state = state === 'open' ? 'close' : 'open';

    return reply(200, { state });
  }

  // Set the state explicitly using a JSON request body.
  if (req.method === 'POST' && req.url === '/api/state') {
    let data = '';

    req.on('data', chunk => {
      data += chunk;

      // Prevent the server from accepting an overly large request body.
      if (data.length > 1024) {
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        const body = JSON.parse(data);

        if (!['open', 'close'].includes(body.state)) {
          return reply(400, { error: 'Invalid state' });
        }

        state = body.state;
        return reply(200, { state });
      } catch {
        return reply(400, { error: 'Invalid JSON' });
      }
    });

    return;
  }

  const imageFiles = {
    '/images/bg0.png': 'bg0.png',
    '/images/bg1.png': 'bg1.png',
    '/images/vopen.png': 'vopen.png',
    '/images/vclose.png': 'vclose.png'
  };

  if (req.method === 'GET' && imageFiles[req.url]) {
    const imagePath = path.join(__dirname, 'images', imageFiles[req.url]);

    return fs.readFile(imagePath, (error, image) => {
      if (error) {
        return reply(404, { error: 'Image not found' });
      }

      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(image);
    });
  }

  return reply(404, { error: 'Not found' });
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

server.listen(port, host, () => {
  console.log(`Ghost control listening at http://${host}:${port}`);
  console.log(`Initial state: ${state}`);
});