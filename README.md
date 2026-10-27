# Grayworm 👻

A spooky hackathon project for the **Ghost in the Machine** theme. Grayworm pairs a vault-themed control page with a Linux client: open the vault and participating desktops start receiving strange files, AI-written messages, and the occasional video.

## How it works

- A Node.js server serves the control page and holds the vault's `open` or `close` state in memory.
- The page layers artwork and sound effects over the vault. Closing it involves a timed riddle; miss the window and you'll need to solve three multiplication problems.
- A Python client polls the server and, while the vault is open, saves generated text files or selected media to the user's Desktop. Downloaded MKV and MP4 files are opened with Dragon Player when it is available.
- Ollama generates spooky filenames and the contents of text effects. Existing media is chosen from `web/effect-media/`.

The current client checks state and effects at three-second intervals. Checks run in a single loop, so Ollama generation or a download can delay the next check. Closing the vault stops new effects; an effect already in progress may still finish.

## Requirements

**Server**

- Docker and Docker Compose
- Enough memory and storage for the Ollama model. The default model is `llama3.2`; a smaller model may be appropriate on a constrained machine.
- The page artwork, sound files, and an `effect-media` directory described below

**Client**

- Linux with Python 3
- A running desktop session; the client uses `xdg-user-dir` when available and falls back to `~/Desktop`
- Dragon Player (`dragon` on `PATH`) to open downloaded videos automatically

Use Grayworm only on machines whose users have agreed to participate. The current control page and API have no authentication, and a reachable user can toggle the vault. Restrict access to a trusted network or protect the deployment before exposing it publicly. The client writes files to the Desktop and can launch videos.

## Run the server

Clone the repository and run these commands from the directory containing `docker-compose.yaml`:

```bash
git clone https://github.com/graysmal/grayworm.git
cd grayworm
docker compose up --build -d
docker compose exec ollama ollama pull llama3.2
```

The pull downloads the model used by the default Compose configuration. Ollama stores models in the `ollama_data` volume. The web app is available at `http://localhost:3000`; Compose currently publishes port 3000 on the host's interfaces.

To use a different model, set `OLLAMA_MODEL` in your environment or a Compose `.env` file, pull that same model, and recreate the web container. For example:

```bash
export OLLAMA_MODEL=llama3.2:1b
docker compose exec ollama ollama pull "$OLLAMA_MODEL"
docker compose up -d ghost
```

Use the same environment or `.env` file for later Compose commands so the chosen configuration is retained. `depends_on` starts Ollama first but does not wait for the model to be ready. Check the logs if an effect request fails:

```bash
docker compose logs -f ghost ollama
```

The default Ollama container is CPU-based. Generation can take time, especially when loading a model for the first time. The vault starts closed whenever the web server restarts.

## Run a client

On a participating desktop, from the repository root:

```bash
python3 daemon/ghost.py --server http://SERVER_ADDRESS:3000
```

Replace the URL with the address reachable by the client. HTTPS can be used if the service is behind a suitable reverse proxy or tunnel. Press **Ctrl+C** to stop the foreground client. To inspect the state or see an effect response:

```bash
curl http://SERVER_ADDRESS:3000/api/state
curl http://SERVER_ADDRESS:3000/api/effect
```

An effect request while open also invokes Ollama, so it may take a while to return. Cloudflare may reject Python's default user agent; the client sends `Grayworm/1.0` to identify itself.

### Optional: run as a user service

The included `ghost.service` is a **template**: its `ExecStart`, `WorkingDirectory`, and server URL contain machine-specific values. Edit those paths and the URL to match the client before installing it. From the directory containing the edited file:

```bash
mkdir -p ~/.config/systemd/user
cp ghost.service ~/.config/systemd/user/ghost.service
systemctl --user daemon-reload
systemctl --user enable --now ghost.service
journalctl --user -u ghost.service -f
```

Stop it with `systemctl --user disable --now ghost.service`. Run it in the participating user's desktop session so it can locate the Desktop and launch Dragon Player. Service startup and graphical session availability can vary by system.

## Artwork, sounds, and effects

The server expects the following page assets:

```text
web/
├── index.html
├── server.js
├── images/
│   ├── bg0.png
│   ├── bg1.png
│   ├── bg2.png
│   ├── vopen.png
│   └── vclose.png
├── media/
│   ├── open.mp3
│   ├── close.mp3
│   ├── laugh.mp3
│   ├── riddle.mp3
│   └── response.mp3
└── effect-media/
    └── your-media-files
```

The current server selects regular files with the extensions `.mkv`, `.mp4`, `.gif`, `.png`, `.jpg`, and `.jpeg` from `effect-media`. If the directory exists but contains no supported files, the server creates a text effect instead. Compose mounts this directory read-only into the web container, so adding or removing files there doesn't require a rebuild. Page assets and code are copied into the image; rebuild the web service after changing them.

Browsers may block audio until a visitor interacts with the page. The riddle and quiz are page behavior, not server-side access control.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/state` | Returns the current `open` or `close` state. |
| `POST /api/toggle` | Toggles the state and returns the new value. |
| `GET /api/effect` | Returns `type: none` when closed; when open, generates a `file` or `text` effect. |
| `GET /api/media/<filename>` | Serves a supported file from `effect-media` while the vault is open. |

The server checks the state again after generation, but a state change and a client action can still occur close together. Ollama errors return an API error; consult the container logs for details.

## Troubleshooting

- **Ollama reports insufficient memory:** run `free -h` inside the server VM and inspect container limits with `docker stats`. A VM's configured maximum can differ from memory visible to the guest. Consider a smaller model or increasing available memory.
- **Effects return 503 or time out:** check that Ollama is running, the configured model has been pulled, and generation completes within the client and any proxy timeouts.
- **No video player opens:** check `command -v dragon` and run the client in a KDE desktop session. The file can still download if Dragon Player is unavailable.
- **The client receives a Cloudflare 403:** inspect the response and Cloudflare security events. In particular, verify that the client's `Grayworm/1.0` User-Agent is allowed by your configuration.
- **Artwork or audio is missing:** check filenames and paths, and rebuild the web container after adding page assets.
