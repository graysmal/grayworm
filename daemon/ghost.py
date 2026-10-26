#!/usr/bin/env python3
"""Visible opt-in client. Only modifies its dedicated demo folder."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import json

DEMO = Path.home() / 'GhostDemo'

def notify(message):
    print(message, flush=True)
    try:
        subprocess.run(['notify-send', 'Ghost in the Machine', message], timeout=3, check=False)
    except (OSError, subprocess.TimeoutExpired):
        pass

def effect(name):
    # All paths are fixed; no server-provided path, code, or command is executed.
    if name == 'boo_file':
        (DEMO / 'booooo.txt').write_text('blood blod blood blod blood blood\n', encoding='utf-8')
    elif name == 'ghost_comment':
        path = DEMO / 'haunted_example.py'
        marker = '# 👻 The ghost suggests: beware of spooky code!\n'
        old = path.read_text(encoding='utf-8') if path.exists() else 'print("Hello from the haunted demo")\n'
        if marker not in old:
            path.write_text(marker + old, encoding='utf-8')
    elif name == 'desktop_gif':
        source = Path(__file__).resolve().parent / 'skeleton.gif'
        if source.is_file():
            shutil.copyfile(source, DEMO / 'skeleton.gif')
        else:
            notify('Add daemon/skeleton.gif to enable the GIF effect.')
    else:
        return
    notify('Effect: ' + name + ' (GhostDemo)')

def main():
    parser = argparse.ArgumentParser(description='Opt-in spooky demo client')
    parser.add_argument('--server', default='http://127.0.0.1:3000')
    parser.add_argument('--interval', type=int, default=5)
    args = parser.parse_args()
    if args.interval < 1: parser.error('--interval must be at least 1 second')
    token = os.environ.get('GHOST_TOKEN')
    if not token: parser.error('Set the GHOST_TOKEN environment variable')
    DEMO.mkdir(exist_ok=True)
    notify('Client running. Effects are limited to ~/GhostDemo. Press Ctrl+C to stop.')
    last = None
    while True:
        try:
            req = urllib.request.Request(args.server.rstrip('/') + '/api/effect', headers={'Authorization':'Bearer ' + token})
            with urllib.request.urlopen(req, timeout=4) as response:
                payload = json.load(response)
            state = payload['state']
            if state != last:
                notify('State: ' + state + (' (ghost activated!)' if state == 'open' else ''))
                last = state
            if state == 'open': effect(payload.get('effect'))
        except (OSError, ValueError, KeyError, urllib.error.URLError) as exc:
            if last != 'offline': notify('Server unavailable; effects paused: ' + str(exc))
            last = 'offline'
        time.sleep(args.interval)

if __name__ == '__main__':
    try: main()
    except KeyboardInterrupt: print('\nGhost stopped.', flush=True)
