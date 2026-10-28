"""Exercise staged code against separate persistent data, never the user's database."""
import json
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error

desktop = Path(__file__).resolve().parents[1]
code = desktop / 'stage/studio'
token = 'integration-test-only-token'

def request(route, method='GET', credential=token):
    req = urllib.request.Request('http://127.0.0.1:8193'+route, method=method,
                                 headers={'X-Studio-Token': credential})
    with urllib.request.urlopen(req, timeout=5) as response:
        return json.loads(response.read())

with tempfile.TemporaryDirectory(prefix='packaged-', dir=desktop) as folder:
    root = Path(folder)
    (root/'ComfyUI/input/studio-uploads').mkdir(parents=True)
    (root/'ComfyUI/output').mkdir(parents=True)
    env = {**os.environ, 'STUDIO_WORKSPACE_ROOT': str(root), 'STUDIO_PORT': '8193',
           'STUDIO_DESKTOP_TOKEN': token, 'STUDIO_DESKTOP_VERSION': '0.1.0', 'PYTHONDONTWRITEBYTECODE': '1'}
    with (root/'server.log').open('w') as log:
        process = subprocess.Popen([sys.executable, '-u', str(code/'server.py')], env=env, stdout=log, stderr=log)
        try:
            for _ in range(100):
                try: identity = request('/api/desktop'); break
                except OSError:
                    if process.poll() is not None: raise RuntimeError((root/'server.log').read_text())
                    time.sleep(.1)
            else: raise RuntimeError('Backend did not start')
            assert Path(identity['workspace']) == root
            assert identity['version'] == '0.1.0' and not identity['active']
            for route, method in [('/api/desktop','GET'), ('/api/desktop/shutdown','POST')]:
                try: request(route, method, credential='wrong'); raise AssertionError('Unauthorized access accepted')
                except urllib.error.HTTPError as error: assert error.code == 403
            for file in ['/', '/classic', '/workspace.js', '/caption-fixes.js', '/caption-waveform.js', '/batch-export.js']:
                with urllib.request.urlopen('http://127.0.0.1:8193'+file) as response: assert response.status == 200 and len(response.read()) > 100
            database = root/'studio/data/workspace.sqlite3'
            with closing(sqlite3.connect(database)) as db:
                db.execute("INSERT OR REPLACE INTO settings VALUES ('paused','true')")
                db.execute("INSERT INTO jobs (id,request_id,group_id,project_id,state,position,payload,graph,created) VALUES ('test','test','test','default','queued',0,'{}','{}',0)")
                db.commit()
            assert request('/api/desktop')['active']
            try: request('/api/desktop/shutdown', 'POST'); raise AssertionError('Busy backend stopped')
            except urllib.error.HTTPError as error: assert error.code == 409
            with closing(sqlite3.connect(database)) as db:
                db.execute("DELETE FROM jobs WHERE id='test'")
                db.commit()
            assert request('/api/desktop/shutdown', 'POST')['stopping']
            process.wait(timeout=15)
            assert process.returncode == 0
            assert database.exists()
            assert not (code/'data').exists()
            print('PASS: staged UI, external data, identity, authorization, queued-work shutdown refusal, graceful shutdown and persistence')
        finally:
            if process.poll() is None: process.terminate(); process.wait(timeout=15)
