const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

const pagePath = path.join(__dirname, 'index.html');
const mediaPath = path.join(__dirname, 'effect-media', 'jtf.mkv');

const imageFiles = {
  '/images/bg0.png': path.join(__dirname, 'images', 'bg0.png'),
  '/images/bg1.png': path.join(__dirname, 'images', 'bg1.png'),
  '/images/vopen.png': path.join(__dirname, 'images', 'vopen.png'),
  '/images/vclose.png': path.join(__dirname, 'images', 'vclose.png')
};

let state = 'close';
let mediaFilename = 'spooky-ghost.mkv';

/*
 * Used to ignore an old Ollama response if the switch closes and
 * opens again while the previous request is still running.
 */
let generationId = 0;

function replyJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify(value));
}

/*
 * Convert the model's response into a short, safe filename.
 * The model only chooses the name; it cannot choose a directory.
 */
function makeSafeFilename(text) {
  const baseName = text
      .trim()
      .toLowerCase()
      .replace(/\.mkv$/i, '')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);

  return `${baseName || 'spooky-ghost'}.mkv`;
}

async function generateMediaFilename() {
  const response = await fetch(
      `${OLLAMA_URL.replace(/\/$/, '')}/api/generate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt:
              'Invent one short, silly, spooky filename for a video. ' +
              'Return only the filename, without a file extension. ' +
              'Use two to four words.',
          stream: false,
          options: {
            num_predict: 50
          }
        }),
        signal: AbortSignal.timeout(90000)
      }
  );

  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }

  const data = await response.json();

  if (typeof data.response !== 'string' || !data.response.trim()) {
    throw new Error('Ollama returned an empty filename');
  }

  return makeSafeFilename(data.response);
}

function setState(nextState) {
  if (nextState === state) {
    return;
  }

  state = nextState;
  generationId += 1;

  console.log(`State changed to: ${state}`);

  if (state === 'open') {
    // Use a fallback while Ollama generates the filename.
    mediaFilename = 'spooky-ghost.mkv';

    const currentGeneration = generationId;

    generateMediaFilename()
        .then(filename => {
          /*
           * Only apply the result if this is still the same opening
           * of the switch.
           */
          if (state === 'open' && generationId === currentGeneration) {
            mediaFilename = filename;
            console.log(`Generated media filename: ${mediaFilename}`);
          }
        })
        .catch(error => {
          console.error(
              'Could not generate filename; using fallback:',
              error.message
          );
        });
  }
}

function sendFile(res, filePath, contentType, extraHeaders = {}) {
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      return replyJson(res, 404, { error: 'File not found' });
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      ...extraHeaders
    });

    const stream = fs.createReadStream(filePath);

    stream.on('error', error => {
      console.error('Error reading file:', error);
      res.destroy();
    });

    stream.pipe(res);
  });
}

const server = http.createServer((req, res) => {
  // Serve the HTML page.
  if (req.method === 'GET' && req.url === '/') {
    return sendFile(
        res,
        pagePath,
        'text/html; charset=utf-8',
        { 'Cache-Control': 'no-store' }
    );
  }

  // Serve the four page images.
  if (req.method === 'GET' && imageFiles[req.url]) {
    return sendFile(res, imageFiles[req.url], 'image/png');
  }

  // Return the current switch state.
  if (req.method === 'GET' && req.url === '/api/state') {
    return replyJson(res, 200, { state });
  }

  // Toggle the switch from the webpage.
  if (req.method === 'POST' && req.url === '/api/toggle') {
    setState(state === 'open' ? 'close' : 'open');

    return replyJson(res, 200, { state });
  }

  /*
   * Tell the daemon which effect is available.
   *
   * The client decides where to save it. The server does not send
   * an arbitrary destination path.
   */
  if (req.method === 'GET' && req.url === '/api/effect') {
    if (state !== 'open') {
      return replyJson(res, 200, {
        state,
        type: 'none'
      });
    }

    return replyJson(res, 200, {
      state,
      type: 'file',
      url: '/api/media/jtf',
      filename: mediaFilename,
      destination: 'desktop'
    });
  }

  // Serve the predefined media file.
  if (req.method === 'GET' && req.url === '/api/media/jtf') {
    if (state !== 'open') {
      return replyJson(res, 403, { error: 'The switch is closed' });
    }

    return sendFile(
        res,
        mediaPath,
        'video/x-matroska',
        {
          'Content-Disposition': 'attachment; filename="jtf.mkv"'
        }
    );
  }

  return replyJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`Ghost server listening on ${HOST}:${PORT}`);
  console.log(`Initial state: ${state}`);
  console.log(`Ollama: ${OLLAMA_URL}, model: ${OLLAMA_MODEL}`);
});