# Ghost in the Machine 👻

A consent-based hackathon starter: a control page toggles a shared state, and an opt-in Fedora client polls for playful effects. Runs on Node.js 18+ and Python 3, using only standard libraries. No packages to install.

## Structure

- `web/server.js`: control page and HTTP API; starts closed and resets on restart.
- `server/effects.js`: chooses from three pre-defined effects.
- `daemon/ghost.py`: visible foreground client; prints and shows KDE notifications.

## Try it on one computer

In terminal 1:

```bash
export GHOST_TOKEN='replace-with-a-long-random-secret'
node web/server.js
```

Open http://127.0.0.1:3000, enter the token, and use Toggle. In terminal 2, start the client:

```bash
export GHOST_TOKEN='replace-with-the-same-secret'
python3 daemon/ghost.py --server http://127.0.0.1:3000
```

You will see notifications for state transitions, including close → open. Press Ctrl+C to stop. Effects create files only in `~/GhostDemo`; the example comment goes into a demo file, not your real code. Add a GIF you have permission to use at `daemon/skeleton.gif` to enable the GIF effect. Delete `~/GhostDemo` when finished.

## Multiple computers over Tailscale

Run the server with `HOST=0.0.0.0 node web/server.js` and connect clients using `--server http://YOUR_TAILSCALE_IP:3000`. Binding to all interfaces can also expose the server to other networks; restrict port 3000 with a firewall or bind `HOST` to the server's specific Tailscale address. Permit only participating devices via Tailscale access controls. HTTP does not itself encrypt the shared token; use Tailscale end to end or HTTPS. The shared token permits anyone who has it to toggle the switch. Treat this as a hackathon prototype, not a hardened service.

## API

- `GET /api/state` → `{"state":"open"}` or `{"state":"close"}` (public)
- `POST /api/state` with `Authorization: Bearer TOKEN` and JSON `{"state":"open"}` or `{"state":"close"}`.
- `GET /api/effect` with the same bearer token → state plus a predefined effect name, or null when closed.

Effects are selected round-robin globally, and are repeated while open. The client does not upload file names or file contents, run remote shell commands, or automatically start in the background. A response already received just before closing may still produce one effect. Polling and notifications require a running desktop session. The GIF is copied into the demo folder rather than the desktop.
