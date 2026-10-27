#!/usr/bin/env python3

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from urllib.parse import quote, unquote


STATE_INTERVAL = 3
EFFECT_INTERVAL = 3

# Ollama may need time to load and generate a response.
REQUEST_TIMEOUT = 100

MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024
MAX_TEXT_BYTES = 4096

ALLOWED_MEDIA_EXTENSIONS = {
    '.mkv',
    '.mp4',
    '.gif',
    '.png',
    '.jpg',
    '.jpeg'
}

VIDEO_EXTENSIONS = {
    '.mkv',
    '.mp4'
}

USER_AGENT = 'Grayworm/1.0'


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


def make_request(url):
    return urllib.request.Request(
        url,
        headers={'User-Agent': USER_AGENT}
    )


def get_json(server, endpoint):
    url = server.rstrip('/') + endpoint
    request = make_request(url)

    with urllib.request.urlopen(
        request,
        timeout=REQUEST_TIMEOUT
    ) as response:
        return json.load(response)


def safe_filename(filename, allowed_extensions):
    """Accept a simple filename with an allowed extension."""
    if not isinstance(filename, str):
        return None

    match = re.fullmatch(
        r'[A-Za-z0-9_-]{1,50}(\.[A-Za-z0-9]{1,5})',
        filename
    )

    if not match:
        return None

    extension = match.group(1).lower()

    if extension not in allowed_extensions:
        return None

    return filename


def open_video_in_dragon(file_path):
    """Open a downloaded video in Dragon Player."""
    if file_path.suffix.lower() not in VIDEO_EXTENSIONS:
        return

    try:
        subprocess.Popen(
            ['dragon', str(file_path)],
            start_new_session=True
        )

        print(
            f'Opened in Dragon Player: {file_path}',
            flush=True
        )

    except FileNotFoundError:
        print(
            'Dragon Player was not found. Is it installed?',
            flush=True
        )

    except OSError as error:
        print(
            f'Could not open Dragon Player: {error}',
            flush=True
        )


def download_effect(server, effect):
    media_url = effect.get('url')

    if not isinstance(media_url, str):
        print('Missing media URL.', flush=True)
        return False

    prefix = '/api/media/'

    if not media_url.startswith(prefix):
        print('Ignoring an unknown media URL.', flush=True)
        return False

    encoded_name = media_url[len(prefix):]
    source_name = unquote(encoded_name)

    # Accept one filename only, not a directory path.
    if (
        not source_name
        or '/' in source_name
        or '\\' in source_name
        or source_name in ('.', '..')
        or Path(source_name).suffix.lower()
            not in ALLOWED_MEDIA_EXTENSIONS
    ):
        print('Ignoring an invalid media filename.', flush=True)
        return False

    filename = safe_filename(
        effect.get('filename'),
        ALLOWED_MEDIA_EXTENSIONS
    )

    if filename is None:
        print(
            'Ignoring an invalid destination filename.',
            flush=True
        )
        return False

    # The destination extension must match the source extension.
    if (
        Path(filename).suffix.lower()
        != Path(source_name).suffix.lower()
    ):
        print(
            'Source and destination extensions differ.',
            flush=True
        )
        return False

    desktop = get_desktop_directory()

    if not desktop.is_dir():
        print(
            f'Desktop directory does not exist: {desktop}',
            flush=True
        )
        return False

    destination = desktop / filename

    if destination.exists():
        print(
            f'File already exists; leaving it alone: {destination}',
            flush=True
        )
        return False

    url = (
        server.rstrip('/')
        + prefix
        + quote(source_name, safe='')
    )

    temporary_path = None

    try:
        print(f'Downloading {source_name}...', flush=True)

        request = make_request(url)

        with urllib.request.urlopen(
            request,
            timeout=REQUEST_TIMEOUT
        ) as response:
            content_length = response.headers.get('Content-Length')

            if (
                content_length
                and int(content_length) > MAX_DOWNLOAD_BYTES
            ):
                print(
                    'Media file exceeds the size limit.',
                    flush=True
                )
                return False

            # Download to a temporary file first so incomplete downloads
            # don't appear under their final names.
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
                        raise ValueError(
                            'Media file exceeds the size limit'
                        )

                    temporary_file.write(chunk)

        # Create the final name without replacing an existing file.
        try:
            os.link(temporary_path, destination)

        except FileExistsError:
            print(
                f'File already exists; leaving it alone: {destination}',
                flush=True
            )
            return False

        print(f'Downloaded to: {destination}', flush=True)

        # Opens MKV and MP4 files only.
        open_video_in_dragon(destination)

        return True

    except (OSError, ValueError, urllib.error.URLError) as error:
        print(f'Download failed: {error}', flush=True)
        return False

    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def create_text_effect(effect):
    filename = safe_filename(
        effect.get('filename'),
        {'.txt'}
    )

    contents = effect.get('contents')

    if filename is None or not isinstance(contents, str):
        print('Ignoring an invalid text effect.', flush=True)
        return False

    if len(contents.encode('utf-8')) > MAX_TEXT_BYTES:
        print('Text effect is too large.', flush=True)
        return False

    desktop = get_desktop_directory()

    if not desktop.is_dir():
        print(
            f'Desktop directory does not exist: {desktop}',
            flush=True
        )
        return False

    destination = desktop / filename

    try:
        # "x" creates a new file without overwriting an existing one.
        with destination.open('x', encoding='utf-8') as file:
            file.write(contents)

        print(
            f'Created text file: {destination}',
            flush=True
        )
        return True

    except FileExistsError:
        print(
            f'File already exists; leaving it alone: {destination}',
            flush=True
        )
        return False

    except OSError as error:
        print(
            f'Could not create text file: {error}',
            flush=True
        )
        return False


def main():
    parser = argparse.ArgumentParser(
        description='Ghost in the Machine client'
    )

    parser.add_argument(
        '--server',
        default='http://127.0.0.1:3000',
        help='URL of the Node server'
    )

    args = parser.parse_args()

    last_state = None

    # Check both endpoints immediately at startup.
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
                    print(
                        'Server returned an invalid state.',
                        flush=True
                    )

                else:
                    if (
                        last_state == 'close'
                        and current_state == 'open'
                    ):
                        print('worm has opened', flush=True)

                    if current_state != last_state:
                        print(
                            f'State: {current_state}',
                            flush=True
                        )

                    last_state = current_state

            except (
                OSError,
                ValueError,
                urllib.error.URLError
            ) as error:
                print(
                    f'State check failed: {error}',
                    flush=True
                )

        now = time.monotonic()

        if now >= next_effect_check:
            next_effect_check = now + EFFECT_INTERVAL

            try:
                effect = get_json(args.server, '/api/effect')

                if (
                    effect.get('state') == 'open'
                    and effect.get('destination') == 'desktop'
                ):
                    if effect.get('type') == 'file':
                        download_effect(args.server, effect)

                    elif effect.get('type') == 'text':
                        create_text_effect(effect)

            except (
                OSError,
                ValueError,
                urllib.error.URLError
            ) as error:
                print(
                    f'Effect check failed: {error}',
                    flush=True
                )

        next_check = min(
            next_state_check,
            next_effect_check
        )

        time.sleep(
            max(0.1, next_check - time.monotonic())
        )


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nGhost client stopped.', flush=True)