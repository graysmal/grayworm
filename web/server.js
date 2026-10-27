const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

const OLLAMA_URL =
    process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

const OLLAMA_MODEL =
    process.env.OLLAMA_MODEL || 'llama3.2';

const pagePath = path.join(__dirname, 'index.html');
const mediaDirectory = path.join(__dirname, 'effect-media');

const imageFiles = {
  '/images/bg0.png': path.join(
      __dirname,
      'images',
      'bg0.png'
  ),

  '/images/bg1.png': path.join(
      __dirname,
      'images',
      'bg1.png'
  ),
  '/images/bg2.png': path.join(__dirname, 'images', 'bg2.png'),

  '/images/vopen.png': path.join(
      __dirname,
      'images',
      'vopen.png'
  ),

  '/images/vclose.png': path.join(
      __dirname,
      'images',
      'vclose.png'
  )
};

const allowedMediaTypes = {
  '.mkv': 'video/x-matroska',
  '.mp4': 'video/mp4',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

let state = 'close';
let stateVersion = 0;

function replyJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify(value));
}

function setState(nextState) {
  if (nextState === state) {
    return;
  }

  state = nextState;
  stateVersion += 1;

  console.log(`State changed to: ${state}`);
}

function chooseSpookyTheme() {
  const themes = [
    'a skeleton with a day job',
    'a ghost who is hungry',
    'a vampire who loves spreadsheets',
    'a haunted vending machine',
    'a very polite zombie',
    'a witch with computer problems',
    'a suspicious pumpkin',
    'a monster trying to pay rent',
    'a ghost stuck in a printer',
    'a dramatic haunted refrigerator'
  ];

  return themes[Math.floor(Math.random() * themes.length)];
}

/*
 * Turn Ollama's response into a simple filename.
 * The random suffix helps avoid collisions.
 */
function makeSafeFilename(text, extension) {
  const baseName = text
      .trim()
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);

  const safeBase = baseName || 'spooky-ghost';
  const suffix = randomBytes(4).toString('hex');

  return `${safeBase}-${suffix}${extension}`;
}

async function generateFilename(extension) {
  const url = `${OLLAMA_URL.replace(/\/$/, '')}/api/generate`;

  const response = await fetch(url, {
    method: 'POST',

    headers: {
      'Content-Type': 'application/json'
    },

    body: JSON.stringify({
      model: OLLAMA_MODEL,

      prompt:
          'Invent one short, silly, spooky filename inspired by ' +
          chooseSpookyTheme() + '. ' +
          'Return only the filename, without a file extension. ' +
          'Use two to four words.',

      stream: false,

      options: {
        num_predict: 50,
        temperature: 1.0
      }
    }),

    signal: AbortSignal.timeout(90000)
  });

  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }

  const data = await response.json();

  if (
      typeof data.response !== 'string' ||
      !data.response.trim()
  ) {
    throw new Error('Ollama returned an empty filename');
  }

  return makeSafeFilename(data.response, extension);
}

async function generateSillyContents() {
  const url = `${OLLAMA_URL.replace(/\/$/, '')}/api/generate`;

  const response = await fetch(url, {
    method: 'POST',

    headers: {
      'Content-Type': 'application/json'
    },

    body: JSON.stringify({
      model: OLLAMA_MODEL,

      prompt:
          'Write one short, funny, spooky message inspired by ' +
          chooseSpookyTheme() + '. ' +
          'It will be placed in a text file as a harmless prank. ' +
          'Use one or two sentences. Return only the message.',

      stream: false,

      options: {
        num_predict: 80,
        temperature: 1.0
      }
    }),

    signal: AbortSignal.timeout(90000)
  });

  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }

  const data = await response.json();

  if (
      typeof data.response !== 'string' ||
      !data.response.trim()
  ) {
    throw new Error('Ollama returned empty text');
  }

  // Keep the result small enough for the daemon to accept it.
  return data.response.trim().slice(0, 1000) + '\n';
}

async function chooseMediaFile() {
  const entries = await fs.promises.readdir(mediaDirectory, {
    withFileTypes: true
  });

  const files = entries.filter(entry => {
    const extension = path.extname(entry.name).toLowerCase();

    return (
        entry.isFile() &&
        Object.hasOwn(allowedMediaTypes, extension)
    );
  });

  if (files.length === 0) {
    return null;
  }

  return files[
      Math.floor(Math.random() * files.length)
      ].name;
}

function sendFile(res, filePath, contentType, extraHeaders = {}) {
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      return replyJson(res, 404, {
        error: 'File not found'
      });
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
  // Serve the control page.
  if (req.method === 'GET' && req.url === '/') {
    return sendFile(
        res,
        pagePath,
        'text/html; charset=utf-8',
        { 'Cache-Control': 'no-store' }
    );
  }

  // Serve the images used by the page.
  if (
      req.method === 'GET' &&
      Object.hasOwn(imageFiles, req.url)
  ) {
    return sendFile(
        res,
        imageFiles[req.url],
        'image/png'
    );
  }

  // Return the current state.
  if (req.method === 'GET' && req.url === '/api/state') {
    return replyJson(res, 200, { state });
  }

  // Toggle the switch.
  if (req.method === 'POST' && req.url === '/api/toggle') {
    setState(state === 'open' ? 'close' : 'open');

    return replyJson(res, 200, { state });
  }

  // Generate and describe an effect.
  if (req.method === 'GET' && req.url === '/api/effect') {
    if (state !== 'open') {
      return replyJson(res, 200, {
        state,
        type: 'none'
      });
    }

    const requestStateVersion = stateVersion;

    async function createEffect() {
      // 50% chance of choosing an existing media file.
      const chooseExistingFile = Math.random() < 0.5;

      let selectedFile = null;

      if (chooseExistingFile) {
        selectedFile = await chooseMediaFile();
      }

      /*
       * If no supported media files exist, create a text effect.
       * The effect-media directory itself must still exist.
       */
      const extension = selectedFile
          ? path.extname(selectedFile).toLowerCase()
          : '.txt';

      console.log('Generating a filename for an effect...');

      const filename = await generateFilename(extension);

      if (
          state !== 'open' ||
          stateVersion !== requestStateVersion
      ) {
        return replyJson(res, 200, {
          state,
          type: 'none'
        });
      }

      if (selectedFile) {
        console.log(
            `File effect: ${selectedFile} -> ${filename}`
        );

        return replyJson(res, 200, {
          state,
          type: 'file',
          url: `/api/media/${encodeURIComponent(selectedFile)}`,
          filename,
          destination: 'desktop'
        });
      }

      console.log('Generating text file contents...');

      const contents = await generateSillyContents();

      // The switch may have changed while Ollama was generating.
      if (
          state !== 'open' ||
          stateVersion !== requestStateVersion
      ) {
        return replyJson(res, 200, {
          state,
          type: 'none'
        });
      }

      console.log(`Text effect: ${filename}`);
      console.log(`Contents: ${contents}`);

      return replyJson(res, 200, {
        state,
        type: 'text',
        filename,
        contents,
        destination: 'desktop'
      });
    }

    createEffect().catch(error => {
      console.error('Could not create effect:', error.message);

      if (!res.headersSent) {
        replyJson(res, 503, {
          error: 'Could not create effect'
        });
      }
    });

    return;
  }

  // Serve an allowed file from effect-media.
  if (
      req.method === 'GET' &&
      req.url.startsWith('/api/media/')
  ) {
    if (state !== 'open') {
      return replyJson(res, 403, {
        error: 'The switch is closed'
      });
    }

    let filename;

    try {
      filename = decodeURIComponent(
          req.url.slice('/api/media/'.length)
      );
    } catch {
      return replyJson(res, 400, {
        error: 'Invalid filename'
      });
    }

    const extension = path.extname(filename).toLowerCase();

    if (
        !filename ||
        filename !== path.basename(filename) ||
        filename.includes('\\') ||
        filename === '.' ||
        filename === '..' ||
        !Object.hasOwn(allowedMediaTypes, extension)
    ) {
      return replyJson(res, 400, {
        error: 'Invalid media filename'
      });
    }

    const filePath = path.join(mediaDirectory, filename);

    // Reject symbolic links and non-files.
    return fs.lstat(filePath, (error, stats) => {
      if (error || !stats.isFile()) {
        return replyJson(res, 404, {
          error: 'Media file not found'
        });
      }

      return sendFile(
          res,
          filePath,
          allowedMediaTypes[extension]
      );
    });
  }

  // Serve the page's sound effects.
  const soundFiles = {
    '/media/open.mp3': 'open.mp3',
    '/media/close.mp3': 'close.mp3',
    '/media/laugh.mp3': 'laugh.mp3',
    '/media/riddle.mp3': 'riddle.mp3',
    '/media/response.mp3': 'response.mp3'
  };

  if (
      req.method === 'GET' &&
      Object.hasOwn(soundFiles, req.url)
  ) {
    const soundPath = path.join(
        __dirname,
        'media',
        soundFiles[req.url]
    );

    return sendFile(res, soundPath, 'audio/mpeg');
  }

  return replyJson(res, 404, {
    error: 'Not found'
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Ghost server listening on ${HOST}:${PORT}`);
  console.log(`Initial state: ${state}`);
  console.log(`Ollama: ${OLLAMA_URL}, model: ${OLLAMA_MODEL}`);
});