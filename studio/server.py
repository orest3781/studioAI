import json
import mimetypes
import urllib.request
import urllib.error
import time
import threading
import uuid
import os
import re
import socket
import secrets
from studio_paths import WORKSPACE, RUNTIME
from workflow_runner import catalog, build, upload, media, INPUT
from library import workflow_availability
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs, unquote
from workspace import Workspace
from social_exports import ExportManager, catalog as export_catalog
from editing import EditingManager, EditConflict, subtitles
from batch_exports import BatchExportManager
from waveforms import WaveformManager

ROOT = Path(__file__).resolve().parent
COMFY = 'http://127.0.0.1:8188'
availability_cache = None
availability_time = 0
submit_lock = threading.Lock()
JOBS = RUNTIME / 'frontend-jobs.json'
jobs = json.loads(JOBS.read_text()) if JOBS.exists() else {}


def comfy(path, data=None):
    request = urllib.request.Request(COMFY + path, data=None if data is None else json.dumps(data).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
        return json.loads(raw) if raw else {}


workspace = Workspace(RUNTIME, comfy, build, upload)
exports = ExportManager(workspace)
editing = EditingManager(workspace, exports)
exports.editing = editing
batches = BatchExportManager(workspace, exports, editing)
waveforms = WaveformManager(workspace)
desktop_lock = threading.RLock()
desktop_stopping = False


def desktop_authorized(handler):
    token = os.environ.get('STUDIO_DESKTOP_TOKEN', '')
    return bool(token) and secrets.compare_digest(token, handler.headers.get('X-Studio-Token', ''))


def desktop_active():
    records = workspace.snapshot()['jobs'] + exports.list() + editing.jobs()
    return any(item['state'] in ('queued', 'running', 'submitting', 'stopping', 'cancelling') for item in records)


class StudioServer(ThreadingHTTPServer):
    # SO_REUSEADDR allows competing listeners on Windows, silently serving an old UI.
    allow_reuse_address = os.name != 'nt'

    def server_bind(self):
        if os.name == 'nt':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def acquire_instance():
    """Hold an OS-released lock so two ports cannot dispatch the same saved queue."""
    handle = (workspace.data / 'workspace.lock').open('a+b')
    if handle.tell() == 0:
        handle.write(b'0')
        handle.flush()
    handle.seek(0)
    try:
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        raise SystemExit('Studio is already running. Close its existing server before starting another port.')
    return handle


class Handler(BaseHTTPRequestHandler):
    def send_file(self, path, download=False, name=None):
        size = path.stat().st_size
        start, end, status = 0, size - 1, 200
        requested = self.headers.get('Range')
        if requested:
            match = re.fullmatch(r'bytes=(\d*)-(\d*)', requested)
            if not match or not any(match.groups()):
                self.send({'error': 'Invalid byte range'}, 416); return
            left, right = match.groups()
            if left:
                start = int(left)
                end = min(int(right), size - 1) if right else size - 1
            else:
                start = max(0, size - int(right))
            if start > end or start >= size:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.send_header('Content-Length', '0')
                self.end_headers(); return
            status = 206
        self.send_response(status)
        self.send_header('Content-Type', mimetypes.guess_type(path.name)[0] or 'application/octet-stream')
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(max(0, end - start + 1)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        if status == 206:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        if download:
            from urllib.parse import quote
            filename = name or path.name
            if Path(filename).suffix.lower() != path.suffix.lower():
                filename += path.suffix
            self.send_header('Content-Disposition', "attachment; filename*=UTF-8''" + quote(filename))
        self.end_headers()
        try:
            with path.open('rb') as source:
                source.seek(start)
                remaining = end - start + 1
                while remaining > 0:
                    chunk = source.read(min(1024 * 256, remaining))
                    if not chunk: break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def send(self, data, status=200, content_type='application/json'):
        body = json.dumps(data).encode() if content_type == 'application/json' else data.encode('utf-8') if isinstance(data, str) else data
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        try: self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError): pass

    def do_GET(self):
        global availability_cache, availability_time
        path = urlparse(self.path).path
        if path == '/api/desktop':
            if not desktop_authorized(self): self.send({'error': 'Unauthorized'}, 403); return
            self.send({'app': 'studioAI', 'version': os.environ.get('STUDIO_DESKTOP_VERSION', 'source'),
                       'workspace': str(WORKSPACE), 'pid': os.getpid(), 'active': desktop_active()}); return
        if path == '/api/caption-styles':
            self.send(editing.styles()); return
        if path.startswith('/api/export-batches/'):
            try:
                parts = path.strip('/').split('/')
                if len(parts)==3: self.send(batches.detail(parts[2])); return
                if len(parts)==4 and parts[3]=='download':
                    self.send_file(batches.archive(parts[2]),True,'Studio-social-batch-'+parts[2][:8]+'.zip'); return
                raise ValueError('Unknown batch request')
            except (ValueError,TypeError,KeyError,OSError) as error: self.send({'error':str(error)},400)
            return
        if path.startswith('/api/editing/'):
            try:
                parts = path.strip('/').split('/')
                ident = parts[2]
                if len(parts)==4 and parts[3]=='waveform':
                    self.send(waveforms.get(ident)); return
                if len(parts)==3:
                    self.send({'document':editing.document(ident),'jobs':editing.jobs(ident),'capabilities':editing.capabilities()}); return
                if len(parts)==4 and parts[3]=='frame':
                    seconds = float(parse_qs(urlparse(self.path).query).get('t',['0'])[0])
                    self.send(editing.frame(ident,seconds),content_type='image/png'); return
                if len(parts)==4 and parts[3] in ('captions.srt','captions.vtt'):
                    fmt = parts[3].split('.')[-1]
                    doc = editing.document(ident)
                    self.send(subtitles(doc['cues'],fmt),content_type='text/vtt; charset=utf-8' if fmt=='vtt' else 'application/x-subrip; charset=utf-8'); return
                raise ValueError('Unknown editing request')
            except (ValueError,TypeError,KeyError,OSError) as error: self.send({'error':str(error)},400)
            return
        if path == '/api/export-presets':
            self.send(export_catalog()); return
        if path == '/api/workspace':
            self.send({**workspace.snapshot(), 'projects': workspace.projects(), 'exports': exports.list(), 'batches': batches.list(),
                       'analysis':[{k:v for k,v in job.items() if k not in ('result','options')} for job in editing.jobs()]}); return
        if path == '/api/assets':
            self.send({'assets': workspace.assets()}); return
        if path.startswith('/api/assets/'):
            try:
                parts = path.strip('/').split('/')
                if len(parts) != 4 or parts[3] not in ('file', 'thumbnail'):
                    raise ValueError('Unknown media request')
                asset = workspace.asset(parts[2])
                file = workspace.thumbnail(asset['id']) if parts[3] == 'thumbnail' else workspace.path_for(asset)
                if file is None:
                    self.send('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100" viewBox="0 0 160 100"><rect width="160" height="100" fill="#242629"/><path d="M40 45v10m10-25v40m10-50v60m10-42v24m10-35v46m10-52v58m10-38v18m10-29v40m10-25v10" stroke="#d6f587" stroke-width="3" stroke-linecap="round"/></svg>', content_type='image/svg+xml'); return
                self.send_file(file, 'download' in parse_qs(urlparse(self.path).query), asset['name']); return
            except (ValueError, OSError, StopIteration):
                self.send({'error': 'Media unavailable'}, 404); return
        if path == '/api/workflows':
            self.send(catalog()); return
        if path.startswith('/api/media/'):
            try:
                parts=path.split('/'); item=media(parts[3])
                file=INPUT/(parts[3]+'-preview.png') if len(parts)==5 and parts[4]=='preview' and item['kind']=='video' else INPUT/Path(item['name']).name
                if len(parts)==5 and parts[4]=='source' and item['kind']=='image':
                    if not item.get('source_name'):raise ValueError('Re-upload the original image')
                    file=INPUT/Path(item['source_name']).name
                self.send_file(file)
            except (ValueError,OSError):self.send({'error':'Media not found'},404)
            return
        if path == '/api/render-tests':
            report_path = RUNTIME / 'render-test-results.json'
            report=json.loads(report_path.read_text(encoding='utf-8')) if report_path.exists() else {'workflows': {}}
            quality_path=RUNTIME/'quality-render-results.json'
            try:report['quality']=json.loads(quality_path.read_text())
            except (OSError,ValueError):report['quality']={}
            self.send(report)
            return
        if path.startswith('/test-workflow/') and path.endswith('.json'):
            ident = path.removeprefix('/test-workflow/').removesuffix('.json')
            file = WORKSPACE / 'ComfyUI/user/default/workflows' / ('Studio-Test-' + ident + '.json')
            if not ident.isalnum() or not file.is_file():
                self.send({'error': 'Unknown test workflow'}, 404)
            else:
                self.send(file.read_bytes(), content_type='application/json; charset=utf-8')
            return
        if path == '/api/library':
            try:
                if availability_cache is None or time.monotonic() - availability_time > 30:
                    availability_cache = workflow_availability(comfy('/object_info'))
                    availability_time = time.monotonic()
                self.send(availability_cache)
            except (OSError, ValueError):
                self.send({'error': 'Start ComfyUI to check shared model availability.'}, 503)
            return
        if path == '/api/status':
            try:
                stats = comfy('/system_stats')
                queue = comfy('/queue')
                self.send({'online': True, 'stats': stats, 'running': len(queue['queue_running']), 'pending': len(queue['queue_pending'])})
            except (OSError, ValueError):
                self.send({'online': False})
            return
        if path.startswith('/api/job/'):
            job = path.rsplit('/', 1)[-1]
            if not all(c in '0123456789abcdef-' for c in job):
                self.send({'error': 'Invalid job'}, 400)
                return
            try:
                history=comfy('/history/' + job).get(job, {})
                if not history:
                    queue=comfy('/queue')
                    running=any(row[1]==job for row in queue['queue_running'])
                    pending=any(row[1]==job for row in queue['queue_pending'])
                    history={'state':'running' if running else 'queued' if pending else 'missing'}
                self.send(history)
            except OSError:
                self.send({'error': 'ComfyUI is unavailable'}, 503)
            return
        files = {'/': ROOT / 'workspace.html', '/classic': ROOT / 'classic.html', '/workspace.js': ROOT / 'workspace.js', '/workspace.css': ROOT / 'workspace.css', '/app.js': ROOT / 'app.js', '/ui.js': ROOT / 'ui.js', '/runner.js': ROOT / 'runner.js', '/style.css': ROOT / 'style.css', '/preview.jpg': WORKSPACE / 'animal-swap-verified.jpg', '/workflow.json': WORKSPACE / 'Animal-Swap-Simple.json'}
        files.update({'/social-export.js': ROOT / 'social-export.js', '/social-export.css': ROOT / 'social-export.css'})
        files.update({'/editing.js': ROOT / 'editing.js', '/editing.css': ROOT / 'editing.css'})
        files['/caption-ui.js'] = ROOT / 'caption-ui.js'
        files['/caption-alignment.js'] = ROOT / 'caption-alignment.js'
        files['/caption-phrase-model.js'] = ROOT / 'caption-phrase-model.js'
        files['/caption-phrases.js'] = ROOT / 'caption-phrases.js'
        files['/caption-readability-model.js'] = ROOT / 'caption-readability-model.js'
        files['/caption-readability.js'] = ROOT / 'caption-readability.js'
        files['/caption-fix-model.js'] = ROOT / 'caption-fix-model.js'
        files['/caption-fixes.js'] = ROOT / 'caption-fixes.js'
        files['/caption-timeline-model.js'] = ROOT / 'caption-timeline-model.js'
        files['/caption-timeline.js'] = ROOT / 'caption-timeline.js'
        files['/caption-waveform.js'] = ROOT / 'caption-waveform.js'
        files.update({'/batch-export.js': ROOT / 'batch-export.js', '/batch-export.css': ROOT / 'batch-export.css'})
        file = files.get(path)
        if file is None or not file.is_file():
            self.send({'error': 'Not found'}, 404)
            return
        self.send(file.read_bytes(), content_type=mimetypes.guess_type(file.name)[0] or 'application/octet-stream')

    def do_POST(self):
        global desktop_stopping
        with desktop_lock:
            if desktop_stopping:
                self.send({'error': 'Studio is restarting; retry when it is ready.'}, 503); return
            if self.path == '/api/desktop/shutdown':
                if not desktop_authorized(self): self.send({'error': 'Unauthorized'}, 403); return
                if desktop_active(): self.send({'error': 'Finish or cancel queued work before closing Studio.'}, 409); return
                desktop_stopping = True
                self.send({'stopping': True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
            self.handle_post()

    def handle_post(self):
        port = self.server.server_port
        if self.headers.get('Origin') not in (None, f'http://127.0.0.1:{port}', f'http://localhost:{port}'):
            self.send({'error': 'Origin not allowed'}, 403)
            return
        edit_path = urlparse(self.path).path
        if edit_path=='/api/export-batches' or edit_path.startswith('/api/export-batches/'):
            try:
                size = int(self.headers.get('Content-Length',0))
                if not 0 < size <= 32000: raise ValueError('Invalid batch request size')
                data = json.loads(self.rfile.read(size))
                if not isinstance(data,dict): raise ValueError('Expected batch settings')
                if edit_path=='/api/export-batches/prepare': result=batches.public_plan(batches.prepare(data))
                elif edit_path=='/api/export-batches': result=batches.enqueue(data)
                else:
                    parts=edit_path.strip('/').split('/')
                    if len(parts)!=3: raise ValueError('Unknown batch action')
                    if data.get('action')=='cancel': result=batches.cancel(parts[2])
                    elif data.get('action')=='retry': result=batches.retry(parts[2])
                    else: raise ValueError('Unknown batch action')
                self.send(result)
            except EditConflict as error: self.send({'error':str(error)},409)
            except (ValueError,TypeError,KeyError,OSError) as error: self.send({'error':str(error)},400)
            return
        if edit_path=='/api/caption-styles' or edit_path.startswith('/api/editing/') or edit_path.startswith('/api/assist-jobs/'):
            try:
                size = int(self.headers.get('Content-Length',0))
                if not 0 < size <= 1000000: raise ValueError('Invalid edit request size')
                data = json.loads(self.rfile.read(size))
                if not isinstance(data,dict): raise ValueError('Expected editing settings')
                if edit_path=='/api/caption-styles':
                    self.send(editing.save_style(data)); return
                parts = edit_path.strip('/').split('/')
                if len(parts)!=3: raise ValueError('Unknown editing action')
                if parts[1]=='assist-jobs':
                    if data.get('action')!='cancel': raise ValueError('Unknown analysis action')
                    result = editing.cancel(parts[2])
                elif data.get('action')=='save': result = editing.save(parts[2],data)
                elif data.get('action')=='check-runtime':
                    workspace.asset(parts[2])
                    result=editing.capabilities(force=True)
                else: result = editing.enqueue(parts[2],data)
                self.send(result)
            except EditConflict as error: self.send({'error':str(error)},409)
            except (ValueError,TypeError,KeyError,OSError) as error: self.send({'error':str(error)},400)
            return
        port = self.server.server_port
        if self.headers.get('Origin') not in (None, f'http://127.0.0.1:{port}', f'http://localhost:{port}'):
            self.send({'error': 'Origin not allowed'}, 403)
            return
        path = urlparse(self.path).path
        if path.startswith('/api/upload/'):
            try:
                size=int(self.headers.get('Content-Length',0))
                if not 0<size<=100*1024*1024:raise ValueError('Choose a file under 100 MB')
                kind = path.rsplit('/',1)[-1]
                query = parse_qs(urlparse(self.path).query)
                filename = unquote(self.headers.get('X-Filename', 'Imported ' + kind))
                self.send(workspace.import_media(self.rfile.read(size), kind, filename, query.get('project', ['default'])[0]))
            except (ValueError,OSError) as error:self.send({'error':str(error)},400)
            return
        if path == '/api/exports' or path.startswith('/api/exports/'):
            try:
                size = int(self.headers.get('Content-Length', 0))
                if not 0 < size < 16000: raise ValueError('Invalid export request size')
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict): raise ValueError('Expected export settings')
                if path == '/api/exports/preview':
                    self.send(exports.preview(data), content_type='image/png'); return
                if path == '/api/exports': result = exports.enqueue(data)
                else:
                    parts = path.strip('/').split('/')
                    if len(parts) != 3: raise ValueError('Unknown export action')
                    result = exports.action(parts[2], data.get('action'))
                self.send(result)
            except (ValueError, TypeError, KeyError, OSError) as error: self.send({'error': str(error)}, 400)
            except Exception: self.send({'error': 'This media could not be prepared for export.'}, 500)
            return
        if path in ('/api/projects', '/api/jobs', '/api/queue', '/api/assets/rescan') or path.startswith('/api/assets/') or path.startswith('/api/jobs/'):
            try:
                size = int(self.headers.get('Content-Length', 0))
                if not 0 < size < 120000: raise ValueError('Invalid request size')
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict): raise ValueError('Expected an object')
                if path == '/api/projects': result = workspace.create_project(data.get('name'))
                elif path == '/api/jobs': result = workspace.enqueue(data)
                elif path == '/api/queue':
                    workspace.pause(data.get('paused')); result = workspace.snapshot()
                elif path == '/api/assets/rescan': result = {'indexed': workspace.scan_outputs()}
                elif path.startswith('/api/assets/'):
                    parts = path.strip('/').split('/')
                    if len(parts) == 4 and parts[3] == 'prepare': result = workspace.prepare_asset(parts[2], data.get('kind'))
                    elif len(parts) == 3: result = workspace.edit_asset(parts[2], data)
                    else: raise ValueError('Unknown asset action')
                else:
                    parts = path.strip('/').split('/')
                    if len(parts) != 3: raise ValueError('Unknown job action')
                    result = workspace.action(parts[2], data.get('action'))
                self.send(result)
            except (ValueError, TypeError, KeyError) as error: self.send({'error': str(error)}, 400)
            except OSError: self.send({'error': 'The engine is unavailable. Your queue and inputs are saved.'}, 503)
            return
        if self.path != '/api/render':
            self.send({'error': 'Not found'}, 404)
            return
        try:
            size = int(self.headers.get('Content-Length', 0))
            if not 0 < size < 25000:
                raise ValueError('Invalid request size')
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError('Expected a render request object')
            request_id=str(uuid.UUID(data.get('request_id',str(uuid.uuid4()))))
            with submit_lock:
                if request_id in jobs:
                    self.send(jobs[request_id]);return
                prompt=build(data)
                result=comfy('/prompt', {'prompt':prompt,'client_id':'local-studio'})
                workspace.adopt(result['prompt_id'], data, prompt)
                jobs[request_id]=result
                temp=JOBS.with_suffix('.tmp');temp.write_text(json.dumps(jobs));temp.replace(JOBS)
                self.send(result)
        except (ValueError, TypeError) as error:
            self.send({'error': str(error)}, 400)
        except urllib.error.HTTPError as error:
            self.send({'error': 'ComfyUI rejected this preset. Check its model and node setup.'}, 502)
        except OSError:
            self.send({'error': 'Start ComfyUI with Launch-ComfyUI.cmd, then retry.'}, 503)


if __name__ == '__main__':
    port = int(os.environ.get('STUDIO_PORT', '8190'))
    instance_lock = acquire_instance()
    print(f'Indexing {workspace.scan_outputs()} existing assets', flush=True)
    server = StudioServer(('127.0.0.1', port), Handler)
    workspace.start()
    exports.start()
    editing.start()
    print(f'Local Studio: http://127.0.0.1:{port}', flush=True)
    try: server.serve_forever()
    finally:
        editing.close()
        exports.close()
        workspace.close()
        server.server_close()
