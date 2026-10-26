const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const { chooseEffect } = require('../server/effects');
const token = process.env.GHOST_TOKEN;
if (!token) { console.error('Set GHOST_TOKEN before starting the server.'); process.exit(1); }
let state = 'close';
const page = `<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Ghost control</title><style>body{background:#12101d;color:#eee;font:18px system-ui;max-width:42rem;margin:5rem auto;padding:1rem}button,input{font:inherit;padding:.7rem}button{cursor:pointer}strong{color:#9ee9bd}</style></head><body><h1>👻 Ghost control</h1><p>State: <strong id="state">unknown</strong></p><label>Shared token <input id="token" type="password" autocomplete="off"></label> <button id="toggle">Toggle</button><p>Clients poll every few seconds. A close state stops new effects.</p><script>async function refresh(){let r=await fetch('/api/state');document.querySelector('#state').textContent=(await r.json()).state}document.querySelector('#toggle').onclick=async()=>{let current=(await (await fetch('/api/state')).json()).state;let r=await fetch('/api/state',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+document.querySelector('#token').value},body:JSON.stringify({state:current==='open'?'close':'open'})});if(!r.ok)alert('Could not change state: '+r.status);await refresh()};refresh();setInterval(refresh,3000)</script></body></html>`;
function authorized(req) { const given = Buffer.from(req.headers.authorization || ''); const expected = Buffer.from('Bearer ' + token); return given.length === expected.length && timingSafeEqual(given, expected); }
http.createServer((req, res) => {
  const reply = (status, value) => { res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store'}); res.end(JSON.stringify(value)); };
  if (req.method === 'GET' && req.url === '/') { res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); return res.end(page); }
  if (req.method === 'GET' && req.url === '/api/state') return reply(200, {state});
  if (req.method === 'GET' && req.url === '/api/effect') { if (!authorized(req)) return reply(401,{error:'unauthorized'}); return reply(200, {state, effect: state === 'open' ? chooseEffect() : null}); }
  if (req.method === 'POST' && req.url === '/api/state') {
    if (!authorized(req)) return reply(401,{error:'unauthorized'});
    let data = ''; req.on('data', chunk => {data += chunk; if (data.length > 1024) req.destroy();});
    req.on('end', () => { try { const value = JSON.parse(data).state; if (!['open','close'].includes(value)) return reply(400,{error:'invalid state'}); state=value; return reply(200,{state}); } catch { return reply(400,{error:'invalid JSON'}); } }); return;
  }
  reply(404,{error:'not found'});
}).listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log('Ghost control listening; initial state: close'));
