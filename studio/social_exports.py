"""Non-destructive social delivery formats, separate from GPU generation graphs."""
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
import uuid

from PIL import Image, ImageFilter, ImageOps

RATIOS = {'9:16': (1080, 1920), '4:5': (1080, 1350), '1:1': (1080, 1080), '16:9': (1920, 1080)}
PRESETS = {
    'reels': {'name': 'Instagram Reels', 'ratio': '9:16', 'fps': '30'},
    'tiktok': {'name': 'TikTok', 'ratio': '9:16', 'fps': '30'},
    'shorts': {'name': 'YouTube Shorts', 'ratio': '9:16', 'fps': 'source'},
    'portrait': {'name': 'Portrait feed', 'ratio': '4:5', 'fps': '30'},
    'square': {'name': 'Square post', 'ratio': '1:1', 'fps': '30'},
    'landscape': {'name': 'Landscape video', 'ratio': '16:9', 'fps': 'source'},
    'custom': {'name': 'Custom format', 'ratio': '9:16', 'fps': '30'},
}
COLORS = {'black': '#101214', 'white': '#ffffff', 'transparent': None}
TERMINAL = ('completed', 'failed', 'cancelled', 'interrupted')


def ffmpeg_binary():
    executable = shutil.which('ffmpeg')
    if not executable: return None
    # Scoop's launcher spawns a child. Launch the real encoder so cancelling
    # our Popen process also stops encoding and releases its output files.
    shim = Path(executable).with_suffix('.shim')
    if os.name == 'nt' and shim.is_file():
        match = re.search(r'^path\s*=\s*"([^"]+)"', shim.read_text(encoding='utf-8'), re.M)
        if match:
            target = Path(os.path.expandvars(match.group(1)))
            if target.name.lower() == 'ffmpeg.exe' and target.is_file(): return str(target)
    return executable


def catalog():
    return {'presets': PRESETS, 'ratios': RATIOS, 'ffmpeg_available': bool(ffmpeg_binary()),
            'reviewed': '2026-10-26'}


def normalize(data, kind):
    if kind not in ('image', 'video'):
        raise ValueError('Social framing supports images and videos. Download the original audio instead.')
    preset = data.get('preset', 'reels')
    if preset not in PRESETS:
        raise ValueError('Unknown export preset')
    ratio = data.get('ratio', PRESETS[preset]['ratio'])
    if ratio not in RATIOS or (preset != 'custom' and ratio != PRESETS[preset]['ratio']):
        raise ValueError('Choose a matching preset or use Custom format')
    size = data.get('size', 1080)
    if type(size) is not int or size not in (720, 1080):
        raise ValueError('Choose 720 or 1080 resolution')
    width, height = RATIOS[ratio]
    width, height = width * size // 1080, height * size // 1080
    fit = data.get('fit', 'contain')
    fmt = data.get('format', 'mp4' if kind == 'video' else 'png')
    fps = str(data.get('fps', PRESETS[preset]['fps']))
    background = data.get('background', 'black')
    if fit not in ('crop', 'contain', 'blur') or background not in COLORS:
        raise ValueError('Choose a valid framing mode and background')
    if fmt not in (('mp4',) if kind == 'video' else ('png', 'jpg')):
        raise ValueError('Choose PNG/JPEG for images or MP4 for videos')
    if background == 'transparent' and (fmt != 'png' or fit == 'blur'):
        raise ValueError('Transparency requires PNG with Crop or Fit framing')
    if fps not in ('source', '30', '60'):
        raise ValueError('Choose source, 30 or 60 fps')
    positions = []
    for key in ('x', 'y'):
        value = data.get(key, 50)
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 100:
            raise ValueError('Crop position must be between 0 and 100')
        positions.append(round(value, 2))
    return {'preset': preset, 'ratio': ratio, 'size': size, 'width': width, 'height': height,
            'fit': fit, 'format': fmt, 'fps': fps, 'background': background,
            'x': positions[0], 'y': positions[1]}


def frame_image(image, options, preview=False):
    image = ImageOps.exif_transpose(image).convert('RGBA')
    width, height = options['width'], options['height']
    if preview:
        scale = min(1, 640 / max(width, height))
        width, height = round(width * scale), round(height * scale)
    position = (options['x'] / 100, options['y'] / 100)
    fill = COLORS[options['background']]
    canvas = Image.new('RGBA', (width, height), fill or (0, 0, 0, 0))
    if options['fit'] == 'crop':
        image = ImageOps.fit(image, (width, height), Image.Resampling.LANCZOS, centering=position)
        canvas.alpha_composite(image)
    else:
        if options['fit'] == 'blur':
            backdrop = ImageOps.fit(image, (width, height), Image.Resampling.LANCZOS, centering=position)
            canvas.alpha_composite(backdrop.filter(ImageFilter.GaussianBlur(max(width, height) / 45)))
        image = ImageOps.contain(image, (width, height), Image.Resampling.LANCZOS)
        canvas.alpha_composite(image, ((width - image.width) // 2, (height - image.height) // 2))
    return canvas


def video_filter(options):
    w, h = options['width'], options['height']
    x, y = options['x'] / 100, options['y'] / 100
    cover = f'scale={w}:{h}:force_original_aspect_ratio=increase:force_divisible_by=2:reset_sar=1,crop={w}:{h}:(iw-ow)*{x}:(ih-oh)*{y},setsar=1'
    points = options.get('edit_snapshot', {}).get('points', [])
    if points:
        from editing import position_expression
        px, py = (position_expression(points, key) for key in ('x', 'y'))
        cover = f"scale={w}:{h}:force_original_aspect_ratio=increase:force_divisible_by=2:reset_sar=1,crop={w}:{h}:x='clip(iw*({px})-ow/2,0,iw-ow)':y='clip(ih*({py})-oh/2,0,ih-oh)',setsar=1"
    contain = f'scale={w}:{h}:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1'
    color = COLORS[options['background']] or '#101214'
    if options['fit'] == 'crop':
        return f'[0:v:0]{cover}[framed]'
    if options['fit'] == 'contain':
        return f'[0:v:0]{contain},pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color={color},setsar=1[framed]'
    return (f'[0:v:0]split=2[bg][fg];[bg]{cover},gblur=sigma={max(w,h)/45}[blurred];'
            f'[fg]{contain}[front];[blurred][front]overlay=(W-w)/2:(H-h)/2:shortest=1,setsar=1[framed]')


class ExportManager:
    def __init__(self, workspace):
        self.workspace = workspace
        self.folder = workspace.data / 'exports'
        self.folder.mkdir(exist_ok=True)
        self.previews = workspace.data / 'export-previews'
        self.previews.mkdir(exist_ok=True)
        workspace.roots['export'] = self.folder
        self.lock = threading.RLock()
        self.preview_lock = threading.Lock()
        self.wake, self.closed = threading.Event(), threading.Event()
        with workspace.db() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS exports (
                id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, asset_id TEXT NOT NULL,
                options TEXT NOT NULL, state TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0,
                output_asset_id TEXT, error TEXT NOT NULL DEFAULT '', created REAL NOT NULL, finished REAL)''')

    def list(self):
        with self.workspace.db() as db:
            rows = db.execute('SELECT * FROM exports ORDER BY created DESC').fetchall()
        return [dict(row, options=json.loads(row['options'])) for row in rows]

    def get(self, ident):
        with self.workspace.db() as db:
            row = db.execute('SELECT * FROM exports WHERE id=?', (ident,)).fetchone()
        if not row:
            raise ValueError('Export not found')
        return dict(row, options=json.loads(row['options']))

    def update(self, ident, **values):
        if not values or not values.keys() <= {'state', 'progress', 'output_asset_id', 'error', 'finished'}:
            raise ValueError('Invalid export update')
        with self.workspace.db() as db:
            db.execute('UPDATE exports SET ' + ','.join(k+'=?' for k in values) + ' WHERE id=?', [*values.values(), ident])

    def enqueue(self, data, snapshot=None):
        request = str(uuid.UUID(data.get('request_id', str(uuid.uuid4()))))
        asset = self.workspace.asset(data.get('asset_id'))
        self.workspace.path_for(asset)
        options = normalize(data, asset['kind'])
        if snapshot is None and hasattr(self, 'editing'):
            snapshot = self.editing.snapshot(asset, data)
        if snapshot is not None: options['edit_snapshot'] = snapshot
        if asset['kind'] == 'video' and not ffmpeg_binary():
            raise ValueError('FFmpeg is required for video export')
        with self.lock, self.workspace.db() as db:
            prior = db.execute('SELECT id,asset_id,options FROM exports WHERE request_id=?', (request,)).fetchone()
            if prior:
                if prior['asset_id'] != asset['id'] or json.loads(prior['options']) != options:
                    raise ValueError('This request ID was already used with different export settings')
                return {'id': prior['id']}
            ident = uuid.uuid4().hex
            db.execute('INSERT INTO exports (id,request_id,asset_id,options,state,created) VALUES (?,?,?,?,?,?)',
                       (ident, request, asset['id'], json.dumps(options), 'queued', time.time()))
        self.wake.set()
        return {'id': ident}

    def action(self, ident, action):
        with self.lock:
            job = self.get(ident)
            if action == 'retry' and job['state'] in ('failed', 'interrupted', 'cancelled'):
                if hasattr(self,'batches') and job['options'].get('batch_id'):
                    return self.batches.retry(job['options']['batch_id'],job['options']['batch_item_id'],ident)
                return self.enqueue({'asset_id': job['asset_id'], **job['options']}, job['options'].get('edit_snapshot'))
            if action != 'cancel' or job['state'] not in ('queued', 'running'):
                raise ValueError('This export cannot perform that action')
            self.update(ident, state='cancelled' if job['state'] == 'queued' else 'cancelling',
                        finished=time.time() if job['state'] == 'queued' else None)
        return {'id': ident}

    @staticmethod
    def process_args():
        return {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}

    def source_image(self, asset):
        path = self.workspace.path_for(asset)
        if asset['kind'] == 'image':
            with Image.open(path) as image:
                return ImageOps.exif_transpose(image).convert('RGBA')
        target = self.previews / (asset['id'] + '.png')
        with self.preview_lock:
            if not target.is_file():
                ffmpeg = ffmpeg_binary()
                if not ffmpeg: raise ValueError('FFmpeg is required for video previews')
                result = subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
                    '-i', str(path), '-frames:v', '1', '-vf', 'scale=1024:1024:force_original_aspect_ratio=decrease:reset_sar=1',
                    '-update', '1', str(target)], capture_output=True, timeout=30, **self.process_args())
                if result.returncode:
                    target.unlink(missing_ok=True)
                    raise ValueError('Could not decode this video for a preview')
        with Image.open(target) as image:
            return image.convert('RGBA')

    def preview(self, data):
        asset = self.workspace.asset(data.get('asset_id'))
        options = normalize(data, asset['kind'])
        snapshot = self.editing.snapshot(asset, data) if hasattr(self, 'editing') else None
        seconds = data.get('time', 0)
        if snapshot or seconds:
            from editing import number, position_at, ass_document
            seconds = number(seconds, 0, asset['metadata'].get('duration', 0), 'Preview time')
            source = Image.open(io.BytesIO(self.editing.frame(asset['id'], seconds))).convert('RGBA')
            if snapshot and snapshot['points']:
                cx, cy = position_at(snapshot['points'], seconds)
                scale = max(options['width']/source.width, options['height']/source.height)
                for key, center, extent, output in (('x',cx,source.width*scale,options['width']),('y',cy,source.height*scale,options['height'])):
                    options[key] = max(0,min(100,(extent*center/100-output/2)/max(1,extent-output)*100))
            result = frame_image(source, options, preview=True)
            if snapshot and snapshot['cues']:
                # Use the same libass renderer and layout as the final video.
                ident = uuid.uuid4().hex
                still, script, target = [self.previews/(ident+suffix) for suffix in ('.png','.ass','-caption.png')]
                try:
                    result.save(still)
                    script.write_text(ass_document(snapshot['cues'],snapshot['style'],result.width,result.height,preview_time=seconds),encoding='utf-8')
                    encoded = subprocess.run([ffmpeg_binary(),'-hide_banner','-loglevel','error','-nostdin','-y','-i',still.name,
                        '-vf',f'ass={script.name}','-frames:v','1','-update','1',target.name],cwd=self.previews,capture_output=True,timeout=30,**self.process_args())
                    if encoded.returncode: raise ValueError('Caption preview could not be rendered')
                    with Image.open(target) as rendered: result=rendered.copy()
                finally:
                    for file in (still,script,target): file.unlink(missing_ok=True)
        else:
            result = frame_image(self.source_image(asset), options, preview=True)
        output = io.BytesIO(); result.save(output, format='PNG')
        return output.getvalue()

    def encode_video(self, asset, options, target, ident):
        source = self.workspace.path_for(asset)
        graph = video_filter(options)
        snapshot = options.get('edit_snapshot', {})
        caption_path = self.folder / (ident + '.ass')
        fps = options['fps']
        if fps == 'source':
            import av
            with av.open(str(source)) as container:
                fps = str(container.streams.video[0].average_rate or 30)
        # Render captions at delivery timestamps, including frames duplicated
        # from low-fps sources, so word transitions honor the saved timeline.
        graph += f';[framed]fps={fps}[timed]'
        if snapshot.get('cues'):
            from editing import ass_document
            caption_path.write_text(ass_document(snapshot['cues'],snapshot['style'],options['width'],options['height']),encoding='utf-8')
            graph += f';[timed]ass={caption_path.name}[captioned]'
            graph += ';[captioned]null[delivery]'
        else: graph += ';[timed]null[delivery]'
        graph += ';[delivery]format=yuv420p[out]'
        graph_path = self.folder / (ident + '.filtergraph')
        graph_path.write_text(graph, encoding='utf-8')
        progress_path = self.folder / (ident + '.progress')
        error_path = self.folder / (ident + '.log')
        args = [ffmpeg_binary(), '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
                '-i', str(source), '-filter_complex_threads', '2', '-/filter_complex', str(graph_path),
                '-map', '[out]', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
                '-maxrate', '16M', '-bufsize', '32M', '-threads', '4', '-profile:v', 'high',
                '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
                '-movflags', '+faststart', '-map_metadata', '-1', '-metadata:s:v:0', 'rotate=0',
                '-progress', str(progress_path), str(target)]
        started = time.monotonic()
        duration = asset['metadata'].get('duration', 0)
        with error_path.open('w', encoding='utf-8') as errors:
            process = subprocess.Popen(args, cwd=self.folder, stdout=subprocess.DEVNULL, stderr=errors, **self.process_args())
            try:
                while process.poll() is None:
                    if self.closed.is_set() or self.get(ident)['state'] == 'cancelling':
                        process.terminate()
                        raise InterruptedError('Export cancelled')
                    if time.monotonic() - started > 3600:
                        process.terminate()
                        raise ValueError('Export exceeded one hour; retry a shorter source')
                    if duration and progress_path.exists():
                        for line in reversed(progress_path.read_text(errors='replace').splitlines()):
                            if line.startswith('out_time_us='):
                                try: self.update(ident, progress=min(.99, max(0, int(line.split('=')[1])/1e6/duration)))
                                except ValueError: pass
                                break
                    self.closed.wait(.25)
                if process.returncode:
                    raise ValueError('Video export failed: ' + error_path.read_text(errors='replace')[-1200:])
            finally:
                if process.poll() is None:
                    try: process.wait(timeout=5)
                    except subprocess.TimeoutExpired: process.kill(); process.wait()
                try: progress_path.unlink(missing_ok=True)
                except OSError: pass
                graph_path.unlink(missing_ok=True)
                caption_path.unlink(missing_ok=True)

    def run_one(self):
        with self.lock, self.workspace.db() as db:
            row = db.execute("SELECT id FROM exports WHERE state='queued' ORDER BY created LIMIT 1").fetchone()
            if not row: return False
            ident = row['id']
            db.execute("UPDATE exports SET state='running' WHERE id=?", (ident,))
        job = self.get(ident)
        options = job['options']
        target = self.folder / (ident + '.part.' + options['format'])
        final = self.folder / (ident + '.' + options['format'])
        try:
            asset = self.workspace.asset(job['asset_id'])
            if asset['kind'] == 'image':
                image = frame_image(self.source_image(asset), options)
                if options['format'] == 'jpg' or image.getchannel('A').getextrema() == (255, 255): image = image.convert('RGB')
                image.save(target, format='PNG' if options['format'] == 'png' else 'JPEG', **({} if options['format']=='png' else {'quality':95,'subsampling':0}))
            else:
                self.encode_video(asset, options, target, ident)
            with self.lock:
                if self.closed.is_set() or self.get(ident)['state'] == 'cancelling':
                    raise InterruptedError('Export cancelled')
                target.replace(final)
                name = f"{Path(asset['name']).stem[:120]} — {PRESETS[options['preset']]['name']} {options['ratio'].replace(':','x')}.{options['format']}"
                output = self.workspace.add_asset('export', final.name, asset['project_id'], 'exported',
                    metadata={'parent_id': asset['id'], 'export': options}, name=name)
                self.update(ident, state='completed', progress=1, output_asset_id=output, finished=time.time())
        except InterruptedError:
            self.update(ident, state='interrupted' if self.closed.is_set() else 'cancelled', finished=time.time())
        except Exception as error:
            self.update(ident, state='failed', error=str(error)[:1500], finished=time.time())
        finally:
            target.unlink(missing_ok=True)
        return True

    def start(self):
        with self.workspace.db() as db:
            db.execute("UPDATE exports SET state='interrupted',error='Studio stopped during export. Retry when ready.',finished=? WHERE state IN ('running','cancelling')", (time.time(),))
        def worker():
            while not self.closed.is_set():
                try:
                    if self.run_one(): continue
                except Exception:
                    pass  # A temporary database failure leaves the durable queued request intact.
                self.wake.wait(1); self.wake.clear()
        self.thread = threading.Thread(target=worker, name='studio-social-exports', daemon=True)
        self.thread.start()

    def close(self):
        self.closed.set(); self.wake.set()
        if hasattr(self, 'thread'): self.thread.join(timeout=8)
