#!/usr/bin/env python3

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


STATE_INTERVAL = 15
EFFECT_INTERVAL = 20
REQUEST_TIMEOUT = 15

# Limit this demo to a reasonably sized media file.
MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024

# Only accept the media endpoint defined by this demo.
ALLOWED_MEDIA_PATH = '/api/media/jtf'


def get_desktop_directory():
    """Find the user's configured Desktop directory."""
    try:
        result = subprocess.run(
            ['xdg-user-dir', 'DESKTOP'],
            capture_output=True,
            text=True,
            check=True,
            timeout=3
        )

        desktop = result.stdout.strip()

        if desktop:
            return Path(desktop).expanduser()

    except (OSError, subprocess.SubprocessError):
        pass

    return Path.home() / 'Desktop'


def get_json(server, endpoint):

    url = server.rstrip('/') + endpoint

    request = urllib.request.Request(
        url,
        headers={'User-Agent': 'Grayworm/1.0'}
    )

    with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
        return json.load(response)


def safe_filename(filename):
    """
    Accept a simple MKV filename only. Fall back if the server returns
    a path, unexpected extension, or other invalid value.
    """
    if not isinstance(filename, str):
        return 'spooky-ghost.mkv'

    if not re.fullmatch(r'[A-Za-z0-9_-]{1,50}\.mkv', filename):
        return 'spooky-ghost.mkv'

    return filename


def download_effect(server, effect):
    if effect.get('url') != ALLOWED_MEDIA_PATH:
        print('Ignoring an unknown media URL.', flush=True)
        return False

    filename = safe_filename(effect.get('filename'))
    desktop = get_desktop_directory()

    if not desktop.is_dir():
        print(f'Desktop directory does not exist: {desktop}', flush=True)
        return False

    destination = desktop / filename

    # Don't overwrite an existing file.
    if destination.exists():
        print(f'File already exists; leaving it alone: {destination}', flush=True)
        return True

    url = server.rstrip('/') + ALLOWED_MEDIA_PATH
    temporary_path = None

    try:
        print(f'Downloading {url}...', flush=True)
        request = urllib.request.Request(
            url,
            headers={'User-Agent': 'Grayworm/1.0'}
        )

        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
            content_length = response.headers.get('Content-Length')

            if content_length and int(content_length) > MAX_DOWNLOAD_BYTES:
                print('Media file exceeds the size limit.', flush=True)
                return False

            # Write to a temporary file first, so failed downloads don't
            # leave a partially downloaded file on the Desktop.
            with tempfile.NamedTemporaryFile(
                dir=desktop,
                prefix='.ghost-download-',
                delete=False
            ) as temporary_file:
                temporary_path = Path(temporary_file.name)
                bytes_downloaded = 0

                while True:
                    chunk = response.read(64 * 1024)

                    if not chunk:
                        break

                    bytes_downloaded += len(chunk)

                    if bytes_downloaded > MAX_DOWNLOAD_BYTES:
                        raise ValueError('Media file exceeds the size limit')

                    temporary_file.write(chunk)

        # Avoid replacing an existing file if one appeared during download.
        try:
            os.link(temporary_path, destination)
        except FileExistsError:
            print(f'File already exists; leaving it alone: {destination}', flush=True)
            return True

        print(f'Downloaded to: {destination}', flush=True)
        return True

    except (OSError, ValueError, urllib.error.URLError) as error:
        print(f'Download failed: {error}', flush=True)
        return False

    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(
        description='Opt-in Ghost in the Machine client'
    )

    parser.add_argument(
        '--server',
        default='http://127.0.0.1:3000',
        help='URL of the Node server'
    )

    args = parser.parse_args()

    last_state = None
    downloaded_this_open_period = False

    # Query both endpoints immediately at startup.
    next_state_check = time.monotonic()
    next_effect_check = time.monotonic()

    print(
        f'Ghost client running. Server: {args.server}. '
        'Press Ctrl+C to stop.',
        flush=True
    )

    while True:
        now = time.monotonic()

        if now >= next_state_check:
            next_state_check = now + STATE_INTERVAL

            try:
                result = get_json(args.server, '/api/state')
                current_state = result.get('state')

                if current_state not in ('open', 'close'):
                    print('Server returned an invalid state.', flush=True)
                else:
                    if last_state == 'close' and current_state == 'open':
                        print('worm has opened', flush=True)

                    if current_state == 'close':
                        downloaded_this_open_period = False

                    if current_state != last_state:
                        print(f'State: {current_state}', flush=True)

                    last_state = current_state

            except (OSError, ValueError, urllib.error.URLError) as error:
                print(f'State check failed: {error}', flush=True)

        now = time.monotonic()

        if now >= next_effect_check:
            next_effect_check = now + EFFECT_INTERVAL

            try:
                effect = get_json(args.server, '/api/effect')

                if effect.get('state') == 'close':
                    downloaded_this_open_period = False

                elif (
                    effect.get('state') == 'open'
                    and effect.get('type') == 'file'
                    and effect.get('destination') == 'desktop'
                    and not downloaded_this_open_period
                ):
                    downloaded_this_open_period = download_effect(
                        args.server,
                        effect
                    )

            except (OSError, ValueError, urllib.error.URLError) as error:
                print(f'Effect check failed: {error}', flush=True)

        # Sleep until the next scheduled check.
        next_check = min(next_state_check, next_effect_check)
        time.sleep(max(0.1, next_check - time.monotonic()))


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nGhost client stopped.', flush=True)