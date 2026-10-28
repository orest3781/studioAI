"""Durable workspace, media catalog and single-GPU queue around the existing graphs."""
from contextlib import contextmanager
from pathlib import Path
import json
import secrets
import sqlite3
import threading
import time
import urllib.error
import uuid

import av
from PIL import Image, ImageOps

MEDIA = {'.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image',
         '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.wav': 'audio',
         '.mp3': 'audio', '.flac': 'audio', '.m4a': 'audio', '.ogg': 'audio'}
ACTIVE = ('submitting', 'running', 'stopping')
TERMINAL = ('completed', 'failed', 'cancelled', 'interrupted')


class Workspace:
    def __init__(self, root, engine, builder, uploader):
        self.root = Path(root)
        self.data = self.root / 'data'
        self.data.mkdir(parents=True, exist_ok=True)
        self.originals = self.data / 'originals'
        self.thumbnails = self.data / 'thumbnails'
        self.originals.mkdir(exist_ok=True)
        self.thumbnails.mkdir(exist_ok=True)
        self.output = self.root.parent / 'ComfyUI' / 'output'
        self.roots = {'output': self.output, 'original': self.originals}
        self.database = self.data / 'workspace.sqlite3'
        self.engine, self.builder, self.uploader = engine, builder, uploader
        self.lock = threading.RLock()
        self.wake = threading.Event()
        self.closed = threading.Event()
        self.online = False
        self.engine_message = 'Connecting to generation engine…'
        with self.db() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, request_id TEXT NOT NULL, group_id TEXT NOT NULL,
                    project_id TEXT NOT NULL, state TEXT NOT NULL, position INTEGER NOT NULL,
                    payload TEXT NOT NULL, graph TEXT NOT NULL, prompt_id TEXT,
                    created REAL NOT NULL, started REAL, finished REAL, error TEXT NOT NULL DEFAULT '',
                    UNIQUE(request_id, id));
                CREATE INDEX IF NOT EXISTS jobs_order ON jobs(state, position);
                CREATE INDEX IF NOT EXISTS jobs_request ON jobs(request_id);
                CREATE TABLE IF NOT EXISTS assets (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
                    root TEXT NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL,
                    source TEXT NOT NULL, created REAL NOT NULL, job_id TEXT,
                    group_id TEXT NOT NULL DEFAULT '', metadata TEXT NOT NULL DEFAULT '{}',
                    favorite INTEGER NOT NULL DEFAULT 0, chosen INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(root, path));
                CREATE TABLE IF NOT EXISTS prepared (
                    asset_id TEXT NOT NULL, kind TEXT NOT NULL, media TEXT NOT NULL,
                    PRIMARY KEY(asset_id, kind));
            ''')
            db.execute('INSERT OR IGNORE INTO projects VALUES (?,?,?)',
                       ('default', 'My workspace', time.time()))

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.database, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def project(self, ident):
        with self.db() as db:
            if not db.execute('SELECT id FROM projects WHERE id=?', (ident,)).fetchone():
                raise ValueError('Project not found')
        return ident

    def projects(self):
        with self.db() as db:
            return [dict(row) for row in db.execute('SELECT * FROM projects ORDER BY created')]

    def create_project(self, name):
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
            raise ValueError('Use a project name between 1 and 80 characters')
        item = {'id': uuid.uuid4().hex, 'name': name.strip(), 'created': time.time()}
        with self.db() as db:
            db.execute('INSERT INTO projects VALUES (:id,:name,:created)', item)
        return item

    def path_for(self, asset):
        root = self.roots.get(asset['root'])
        if root is None:
            raise ValueError('Unknown asset location')
        root = root.resolve()
        path = (root / asset['path']).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError('This media file is unavailable')
        return path

    @staticmethod
    def inspect(path, kind):
        meta = {'bytes': path.stat().st_size}
        try:
            if kind == 'image':
                with Image.open(path) as im:
                    meta.update(width=im.width, height=im.height, alpha='A' in im.getbands())
            else:
                with av.open(str(path)) as container:
                    if container.duration:
                        meta['duration'] = round(container.duration / av.time_base, 3)
                    if container.streams.video:
                        stream = container.streams.video[0]
                        meta.update(width=stream.width, height=stream.height)
                        if stream.average_rate:
                            meta['fps'] = float(stream.average_rate)
        except (OSError, ValueError, av.error.FFmpegError):
            pass
        return meta

    def add_asset(self, root, relative, project='default', source='existing', job=None,
                  metadata=None, name=None):
        path = self.path_for({'root': root, 'path': str(relative)})
        kind = MEDIA.get(path.suffix.lower())
        if kind is None:
            return None
        ident = uuid.uuid5(uuid.NAMESPACE_URL, root + ':' + str(relative).replace('\\', '/')).hex
        with self.db() as db:
            known = db.execute('SELECT id FROM assets WHERE id=?', (ident,)).fetchone()
        if known and not job:
            return ident
        meta = self.inspect(path, kind)
        meta.update(metadata or {})
        if job:
            payload = job['payload']
            meta.update({key: payload[key] for key in ('workflow', 'prompt', 'seed', 'quality', 'duration', 'parent_id', 'aspect_ratio') if key in payload})
            # Keep requested duration separate from the actual decoded media duration.
            meta['requested_duration'] = payload.get('duration', 0)
            actual = self.inspect(path, kind)
            if 'duration' in actual:
                meta['duration'] = actual['duration']
        with self.db() as db:
            db.execute('''INSERT OR IGNORE INTO assets
                (id,project_id,name,root,path,kind,source,created,job_id,group_id,metadata)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)''',
                (ident, project, name or path.name, root, str(relative).replace('\\', '/'), kind,
                 source, time.time() if source != 'existing' else path.stat().st_mtime,
                 job['id'] if job else None, job['group_id'] if job else '', json.dumps(meta)))
            if known and job:
                db.execute('UPDATE assets SET project_id=?,source=?,job_id=?,group_id=?,metadata=? WHERE id=?',
                           (project, source, job['id'], job['group_id'], json.dumps(meta), ident))
        return ident

    def scan_outputs(self):
        folder = self.output / 'studio'
        count = 0
        if folder.is_dir():
            for path in folder.rglob('*'):
                if not path.is_file() or path.suffix.lower() not in MEDIA or '.preview.' in path.name:
                    continue
                try:
                    self.add_asset('output', path.relative_to(self.output))
                    count += 1
                except (ValueError, OSError):
                    continue
        return count

    @staticmethod
    def public_asset(row):
        item = dict(row)
        item['metadata'] = json.loads(item['metadata'])
        item['url'] = '/api/assets/' + item['id'] + '/file'
        item['thumbnail'] = '/api/assets/' + item['id'] + '/thumbnail'
        return item

    def assets(self):
        with self.db() as db:
            return [self.public_asset(row) for row in db.execute('SELECT * FROM assets ORDER BY created DESC')]

    def asset(self, ident):
        with self.db() as db:
            row = db.execute('SELECT * FROM assets WHERE id=?', (ident,)).fetchone()
        if row is None:
            raise ValueError('Asset not found')
        return self.public_asset(row)

    def edit_asset(self, ident, data):
        item = self.asset(ident)
        name = data.get('name', item['name'])
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 180:
            raise ValueError('Use a name between 1 and 180 characters')
        project = self.project(data.get('project_id', item['project_id']))
        with self.lock, self.db() as db:
            if data.get('chosen') and item['group_id']:
                db.execute('UPDATE assets SET chosen=0 WHERE group_id=?', (item['group_id'],))
            db.execute('UPDATE assets SET name=?,project_id=?,favorite=?,chosen=? WHERE id=?',
                       (name.strip(), project, int(bool(data.get('favorite', item['favorite']))),
                        int(bool(data.get('chosen', item['chosen']))), ident))
        return self.asset(ident)

    def import_media(self, raw, kind, name, project='default'):
        self.project(project)
        prepared = self.uploader(raw, kind)
        if kind == 'mask':
            return prepared
        suffix = Path(name).suffix.lower()
        if MEDIA.get(suffix) != kind:
            suffix = {'image': '.png', 'video': '.mp4', 'audio': '.wav'}[kind]
        filename = uuid.uuid4().hex + suffix
        target = self.originals / filename
        target.write_bytes(raw)
        try:
            ident = self.add_asset('original', filename, project, 'imported', name=Path(name).name[:180] or filename)
            prepared['asset_id'] = ident
            with self.db() as db:
                db.execute('INSERT OR REPLACE INTO prepared VALUES (?,?,?)', (ident, kind, json.dumps(prepared)))
            return prepared
        except Exception:
            target.unlink(missing_ok=True)
            raise

    def prepare_asset(self, ident, kind):
        asset = self.asset(ident)
        if kind != asset['kind'] and not (kind == 'mask' and asset['kind'] == 'image'):
            raise ValueError('Choose a matching media type')
        with self.db() as db:
            row = db.execute('SELECT media FROM prepared WHERE asset_id=? AND kind=?', (ident, kind)).fetchone()
        if row:
            prepared = json.loads(row['media'])
            from workflow_runner import media
            try:
                media(prepared['token'], kind)
                # Older prepared images only retained a square. Rebuild from the
                # library original when selected again, retaining full framing.
                if kind != 'image' or prepared.get('source_name'):
                    return prepared
            except ValueError:
                pass
        path = self.path_for(asset)
        if path.stat().st_size > 100 * 1024 * 1024:
            raise ValueError('This workflow accepts source files up to 100 MB')
        prepared = self.uploader(path.read_bytes(), kind)
        prepared['asset_id'] = ident
        with self.db() as db:
            db.execute('INSERT OR REPLACE INTO prepared VALUES (?,?,?)', (ident, kind, json.dumps(prepared)))
        return prepared

    def thumbnail(self, ident):
        item = self.asset(ident)
        path = self.path_for(item)
        if item['kind'] == 'audio':
            return None
        target = self.thumbnails / (ident + '.png')
        if not target.is_file():
            with self.lock:
                if not target.is_file():
                    if item['kind'] == 'image':
                        with Image.open(path) as im:
                            image = ImageOps.exif_transpose(im).convert('RGBA')
                    else:
                        with av.open(str(path)) as container:
                            image = next(container.decode(video=0)).to_image()
                    image.thumbnail((480, 360))
                    temp = target.with_suffix('.tmp')
                    image.save(temp, format='PNG')
                    temp.replace(target)
        return target

    def job(self, ident):
        with self.db() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (ident,)).fetchone()
        if row is None:
            raise ValueError('Job not found')
        item = dict(row)
        item['payload'] = json.loads(item['payload'])
        item['graph'] = json.loads(item['graph'])
        return item

    def update_job(self, ident, **values):
        allowed = {'state', 'started', 'finished', 'error', 'prompt_id', 'position'}
        if not values or not values.keys() <= allowed:
            raise ValueError('Invalid job update')
        with self.db() as db:
            db.execute('UPDATE jobs SET ' + ','.join(key + '=?' for key in values) + ' WHERE id=?',
                       [*values.values(), ident])

    def enqueue(self, data):
        request = str(uuid.UUID(data.get('request_id', str(uuid.uuid4()))))
        project = self.project(data.get('project_id', 'default'))
        count = data.get('variations', 1)
        if type(count) != int or count not in (1, 2, 4):
            raise ValueError('Choose one, two or four variations')
        with self.lock:
            with self.db() as db:
                prior = db.execute('SELECT id FROM jobs WHERE request_id=? ORDER BY position', (request,)).fetchall()
            if prior:
                return {'job_ids': [row['id'] for row in prior], 'group_id': self.job(prior[0]['id'])['group_id']}
            base_seed = data.get('seed', secrets.randbelow(2 ** 32))
            if type(base_seed) != int or not 0 <= base_seed < 2 ** 53:
                raise ValueError('Invalid variation seed')
            group = uuid.uuid4().hex
            prepared = []
            for index in range(count):
                payload = {k: v for k, v in data.items() if k not in ('request_id', 'variations')}
                payload['seed'] = (base_seed + index) % (2 ** 53)
                ident = str(uuid.uuid4())
                graph = self.builder(payload)
                prepared.append((ident, payload, graph))
            with self.db() as db:
                position = db.execute('SELECT COALESCE(MAX(position),0) FROM jobs').fetchone()[0]
                for index, (ident, payload, graph) in enumerate(prepared):
                    db.execute('''INSERT INTO jobs
                        (id,request_id,group_id,project_id,state,position,payload,graph,created)
                        VALUES (?,?,?,?,?,?,?,?,?)''',
                        (ident, request, group, project, 'queued', position + index + 1,
                         json.dumps(payload), json.dumps(graph), time.time()))
            self.wake.set()
            return {'job_ids': [item[0] for item in prepared], 'group_id': group}

    def adopt(self, prompt_id, data, graph):
        with self.db() as db:
            db.execute('''INSERT OR IGNORE INTO jobs
                (id,request_id,group_id,project_id,state,position,payload,graph,prompt_id,created,started)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)''',
                (prompt_id, data.get('request_id', prompt_id), uuid.uuid4().hex, 'default', 'running',
                 0, json.dumps(data), json.dumps(graph), prompt_id, time.time(), time.time()))
        self.wake.set()

    def paused(self):
        with self.db() as db:
            row = db.execute("SELECT value FROM settings WHERE key='paused'").fetchone()
        return bool(row and row['value'] == 'true')

    def pause(self, value):
        if type(value) != bool:
            raise ValueError('Invalid pause value')
        with self.lock, self.db() as db:
            db.execute("INSERT OR REPLACE INTO settings VALUES ('paused',?)", (json.dumps(value),))
        self.wake.set()

    def action(self, ident, action):
        with self.lock:
            job = self.job(ident)
            if action == 'retry':
                if job['state'] not in ('failed', 'cancelled', 'interrupted'):
                    raise ValueError('Only failed or cancelled jobs can be retried')
                # Retry the saved graph, including its seed and source tokens.
                new_id = str(uuid.uuid4())
                with self.db() as db:
                    position = db.execute('SELECT COALESCE(MAX(position),0)+1 FROM jobs').fetchone()[0]
                    db.execute('''INSERT INTO jobs
                        (id,request_id,group_id,project_id,state,position,payload,graph,created)
                        VALUES (?,?,?,?,?,?,?,?,?)''',
                        (new_id, new_id, job['group_id'], job['project_id'], 'queued', position,
                         json.dumps(job['payload']), json.dumps(job['graph']), time.time()))
                self.wake.set()
                return {'id': new_id}
            if action in ('earlier', 'later'):
                if job['state'] != 'queued':
                    raise ValueError('Only waiting jobs can be reordered')
                op, order = ('<', 'DESC') if action == 'earlier' else ('>', 'ASC')
                with self.db() as db:
                    neighbor = db.execute(f"SELECT id,position FROM jobs WHERE state='queued' AND position {op} ? ORDER BY position {order} LIMIT 1", (job['position'],)).fetchone()
                    if neighbor:
                        db.execute('UPDATE jobs SET position=? WHERE id=?', (neighbor['position'], ident))
                        db.execute('UPDATE jobs SET position=? WHERE id=?', (job['position'], neighbor['id']))
                return {'id': ident}
            if action != 'cancel':
                raise ValueError('Unknown queue action')
            if job['state'] == 'queued':
                self.update_job(ident, state='cancelled', finished=time.time())
            elif job['state'] in ACTIVE:
                queue = self.engine('/queue')
                pending = {row[1] for row in queue['queue_pending']}
                if job['prompt_id'] in pending:
                    self.engine('/queue', {'delete': [job['prompt_id']]})
                    # The job can begin between reading and deleting the engine queue.
                    self.engine('/interrupt', {'prompt_id': job['prompt_id']})
                    self.update_job(ident, state='stopping')
                else:
                    # This installed ComfyUI supports a targeted interrupt. Never interrupt other jobs.
                    self.engine('/interrupt', {'prompt_id': job['prompt_id']})
                    self.update_job(ident, state='stopping')
            else:
                raise ValueError('This job has already finished')
        self.wake.set()
        return {'id': ident}

    def snapshot(self):
        with self.db() as db:
            rows = db.execute('SELECT * FROM jobs ORDER BY position,created').fetchall()
        jobs = []
        for row in rows:
            item = dict(row)
            item.pop('graph')
            item.pop('request_id')
            item['payload'] = json.loads(item['payload'])
            jobs.append(item)
        return {'jobs': jobs, 'paused': self.paused(), 'online': self.online,
                'engine_message': self.engine_message}

    def finish(self, job, history):
        status = history.get('status', {})
        if status.get('status_str') == 'success':
            indexed = 0
            for output in history.get('outputs', {}).values():
                for key in ('images', 'videos', 'gifs', 'audio'):
                    for file in output.get(key, []):
                        if not isinstance(file, dict) or file.get('type') != 'output':
                            continue
                        relative = Path(file.get('subfolder', '')) / file.get('filename', '')
                        try:
                            if self.add_asset('output', relative, job['project_id'], 'generated', job):
                                indexed += 1
                        except (ValueError, OSError):
                            continue
            self.update_job(job['id'], state='completed' if indexed else 'failed', finished=time.time(),
                            error='' if indexed else 'The engine finished, but no saved media could be found. Your settings are saved; retry to create a new output.')
        else:
            messages = status.get('messages', [])
            detail = next((str(msg[1].get('exception_message', '')) for msg in messages
                           if len(msg) > 1 and msg[0] == 'execution_error'), '')
            cancelled = job['state'] == 'stopping' or any(msg[0] == 'execution_interrupted' for msg in messages)
            self.update_job(job['id'], state='cancelled' if cancelled else 'failed',
                            finished=time.time(), error=detail[:1500] or ('' if cancelled else 'The engine could not finish this render. Your inputs are saved.'))

    def tick(self):
        # One lock also protects cancel/reorder against the dispatch boundary.
        with self.lock:
            queue = self.engine('/queue')
            self.online = True
            self.engine_message = 'Engine ready'
            running = {row[1] for row in queue.get('queue_running', [])}
            pending = {row[1] for row in queue.get('queue_pending', [])}
            with self.db() as db:
                active = [row['id'] for row in db.execute("SELECT id FROM jobs WHERE state IN ('submitting','running','stopping')")]
            for ident in active:
                job = self.job(ident)
                history = self.engine('/history/' + job['prompt_id']).get(job['prompt_id'])
                if history and history.get('status'):
                    self.finish(job, history)
                elif job['prompt_id'] in running or job['prompt_id'] in pending:
                    if job['state'] != 'stopping':
                        self.update_job(ident, state='running')
                elif time.time() - (job['started'] or job['created']) > 15:
                    cancelled = job['state'] == 'stopping'
                    self.update_job(ident, state='cancelled' if cancelled else 'interrupted', finished=time.time(),
                                    error='' if cancelled else 'The engine no longer has this job. Your settings are saved; retry when ready.')
            with self.db() as db:
                busy = db.execute("SELECT 1 FROM jobs WHERE state IN ('submitting','running','stopping') LIMIT 1").fetchone()
                next_job = db.execute("SELECT id FROM jobs WHERE state='queued' ORDER BY position LIMIT 1").fetchone()
            if self.paused() or busy or running or pending or not next_job:
                if running or pending:
                    self.engine_message = 'Engine rendering'
                return
            job = self.job(next_job['id'])
            prompt_id = str(uuid.uuid4())
            # Save the requested engine ID before submission, so a lost response can be reconciled.
            self.update_job(job['id'], state='submitting', started=time.time(), prompt_id=prompt_id)
            try:
                result = self.engine('/prompt', {'prompt': job['graph'], 'prompt_id': prompt_id,
                                                 'client_id': 'local-studio-workspace'})
                self.update_job(job['id'], state='running', prompt_id=result['prompt_id'])
            except urllib.error.HTTPError as error:
                detail = error.read(4000).decode('utf-8', errors='replace')
                self.update_job(job['id'], state='failed', finished=time.time(),
                                error='The engine rejected this workflow. Check its models and nodes. ' + detail[:1000])

    def start(self):
        def worker():
            while not self.closed.is_set():
                try:
                    self.tick()
                except (OSError, ValueError, KeyError) as error:
                    self.online = False
                    self.engine_message = 'Engine offline · queued jobs are saved'
                except Exception as error:
                    self.engine_message = 'Queue reconnecting · ' + str(error)[:150]
                self.wake.wait(2)
                self.wake.clear()
        self.thread = threading.Thread(target=worker, name='studio-render-queue', daemon=True)
        self.thread.start()

    def close(self):
        self.closed.set()
        self.wake.set()
        if hasattr(self, 'thread'):
            self.thread.join(timeout=8)
