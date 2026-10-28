"""Local, versioned framing/caption edits and isolated CPU analysis jobs."""
import io
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
import uuid

from PIL import Image
from captions import ass_document, validate_style, normalize_words, BUILTINS, FONTS


class EditConflict(ValueError):
    pass


def number(value, low, high, label):
    if type(value) not in (float, int) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f'{label} must be between {low} and {high}')
    return round(value, 3)


def validate_document(data, duration):
    if not isinstance(data, dict): raise ValueError('Expected editing settings')
    points, cues = data.get('points', []), data.get('cues', [])
    if not isinstance(points, list) or len(points) > 1500: raise ValueError('Use at most 1500 framing keyframes')
    if not isinstance(cues, list) or len(cues) > 1000: raise ValueError('Use at most 1000 captions')
    clean_points, clean_cues = [], []
    previous = -1
    for p in points:
        t = number(p['t'], 0, duration, 'Keyframe time')
        if t <= previous: raise ValueError('Keyframe times must increase without duplicates')
        clean_points.append({'t': t, 'x': number(p['x'], 0, 100, 'Subject X'), 'y': number(p['y'], 0, 100, 'Subject Y')})
        previous = t
    previous = 0
    for cue in cues:
        start = number(cue['start'], 0, duration, 'Caption start')
        end = number(cue['end'], 0, duration, 'Caption end')
        if end <= start or start < previous: raise ValueError('Captions must have positive duration and cannot overlap')
        text = cue['text']
        if not isinstance(text, str) or not text.strip() or len(text) > 300:
            raise ValueError('Each caption needs 1–300 characters')
        if any(ord(c) < 32 and c not in '\n\t' for c in text): raise ValueError('Caption contains unsupported control characters')
        clean = {'start': start, 'end': end, 'text': text.strip().replace('\t', ' ')}
        clean['words'], clean['timing'] = normalize_words(clean,cue.get('words'),cue.get('timing','estimated'))
        clean_cues.append(clean)
        previous = end
    if sum(len(c['words']) for c in clean_cues)>20000: raise ValueError('Use at most 20000 timed words')
    return {'points': clean_points, 'cues': clean_cues, 'style': validate_style(data.get('style', {}))}


def position_at(points, t):
    if not points: return (50, 50)
    before = points[0]
    for after in points[1:]:
        if t <= after['t']:
            k = max(0, min(1, (t-before['t'])/(after['t']-before['t'])))
            return tuple(before[key]+k*(after[key]-before[key]) for key in ('x','y'))
        before = after
    return before['x'], before['y']


def position_expression(points, key):
    # A sum of clamped ramps interpolates without deeply nested FFmpeg expressions.
    result = f"{points[0][key]/100:.7f}"
    for a, b in zip(points, points[1:]):
        delta = (b[key]-a[key])/100
        if abs(delta) > 1e-7:
            result += f"+({delta:.7f})*clip((t-{a['t']:.3f})/{b['t']-a['t']:.3f},0,1)"
    return result


def subtitle_time(seconds, separator=','):
    ms = round(seconds*1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}{separator}{ms%1000:03}'


def subtitles(cues, fmt):
    import html
    if fmt not in ('srt', 'vtt'): raise ValueError('Choose SRT or VTT')
    lines = ['WEBVTT', ''] if fmt == 'vtt' else []
    for index, cue in enumerate(cues, 1):
        sep = '.' if fmt == 'vtt' else ','
        # Escape markup so edited text remains literal, including angle brackets.
        text = html.escape(cue['text'], quote=False).replace('\n\n', '\n')
        lines += [str(index), f"{subtitle_time(cue['start'],sep)} --> {subtitle_time(cue['end'],sep)}", text, '']
    return '\n'.join(lines)+'\n'


class EditingManager:
    def __init__(self, workspace, exports):
        self.workspace, self.exports = workspace, exports
        self.folder = workspace.data/'editing'
        self.folder.mkdir(exist_ok=True)
        self.lock = threading.RLock()
        self.closed, self.wake = threading.Event(), threading.Event()
        self.caption_python = workspace.root/'.caption-torch-env'/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
        self.model = workspace.root/'models'/'whisper-base-torch'
        with workspace.db() as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS edits (asset_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS assist_jobs (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL,
                asset_id TEXT NOT NULL, task TEXT NOT NULL, options TEXT NOT NULL, state TEXT NOT NULL,
                progress REAL NOT NULL DEFAULT 0, result TEXT, error TEXT NOT NULL DEFAULT '', created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS caption_styles (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                    name_key TEXT UNIQUE NOT NULL, revision INTEGER NOT NULL, style TEXT NOT NULL);''')

    def styles(self):
        with self.workspace.db() as db:
            rows=db.execute('SELECT * FROM caption_styles ORDER BY name_key').fetchall()
        return {'fonts':list(FONTS),'styles':[dict(p,builtin=True,revision=0) for p in BUILTINS]+
                [dict(id=r['id'],name=r['name'],revision=r['revision'],style=json.loads(r['style']),builtin=False) for r in rows]}

    def save_style(self, data):
        name=data.get('name','')
        if not isinstance(name,str) or not 1<=len(name.strip())<=60 or any(ord(c)<32 for c in name):
            raise ValueError('Style name needs 1–60 characters')
        name=name.strip();style=validate_style(data.get('style',{}));ident=data.get('id')
        if ident in {p['id'] for p in BUILTINS}: raise ValueError('Built-in styles cannot be replaced; save a new style')
        with self.lock,self.workspace.db() as db:
            current=db.execute('SELECT * FROM caption_styles WHERE id=?',(ident,)).fetchone() if ident else None
            if ident and not current: raise ValueError('Caption style not found')
            revision=current['revision'] if current else 0
            if type(data.get('revision',0)) is not int or data.get('revision',0)!=revision:
                raise EditConflict('This style changed in another window. Reopen the editor before updating it.')
            duplicate=db.execute('SELECT id FROM caption_styles WHERE name_key=?',(name.casefold(),)).fetchone()
            if duplicate and duplicate['id']!=ident: raise ValueError('A style with that name exists. Select it to update, or choose another name.')
            ident=ident or uuid.uuid4().hex
            db.execute('INSERT OR REPLACE INTO caption_styles VALUES (?,?,?,?,?)',(ident,name,name.casefold(),revision+1,json.dumps(style)))
        return {'id':ident,'name':name,'revision':revision+1,'style':style,'builtin':False}

    def capabilities(self, force=False):
        from caption_runtime import check
        health = check(self.caption_python,self.model,force)
        return {'captions_ready':health['ready'],'caption_error':health.get('error',''),
                'model':'Whisper base · multilingual · PyTorch CPU','backend':'pytorch-cpu',
                'alignment_ready':health['ready'],'alignment_max_cue_seconds':28,
                'max_duration':600,'local_only':True}

    def document(self, ident):
        asset = self.workspace.asset(ident)
        with self.workspace.db() as db:
            row = db.execute('SELECT * FROM edits WHERE asset_id=?',(ident,)).fetchone()
        return {'asset_id':ident, 'revision':row['revision'] if row else 0,
                **validate_document(json.loads(row['document']) if row else {},asset['metadata'].get('duration',0))}

    def save(self, ident, data):
        asset = self.workspace.asset(ident)
        if asset['kind'] not in ('video','audio'): raise ValueError('Choose a video or audio asset')
        document = validate_document(data, asset['metadata'].get('duration',0))
        if asset['kind']=='audio' and document['points']: raise ValueError('Audio has no crop path')
        with self.lock, self.workspace.db() as db:
            current = db.execute('SELECT revision FROM edits WHERE asset_id=?',(ident,)).fetchone()
            revision = current['revision'] if current else 0
            if type(data.get('revision')) is not int or data['revision'] != revision:
                raise EditConflict('Edits changed in another window. Reopen the editor before saving.')
            db.execute('INSERT OR REPLACE INTO edits VALUES (?,?,?)',(ident,revision+1,json.dumps(document)))
        return self.document(ident)

    def snapshot(self, asset, data):
        tracking, captions = data.get('use_reframe',False), data.get('burn_captions',False)
        if type(tracking) is not bool or type(captions) is not bool: raise ValueError('Invalid editing option')
        if not tracking and not captions: return None
        if asset['kind']!='video': raise ValueError('Tracked framing and burned captions require video')
        doc = self.document(asset['id'])
        if data.get('editing_revision') != doc['revision']: raise EditConflict('Saved edits changed. Reopen Export to use the latest version.')
        if tracking and (data.get('fit')!='crop' or not doc['points']): raise ValueError('Save a crop path and choose Fill to follow the subject')
        if captions and not doc['cues']: raise ValueError('Save captions before including them')
        return {**doc, 'points':doc['points'] if tracking else [], 'cues':doc['cues'] if captions else []}

    def frame(self, ident, seconds):
        asset = self.workspace.asset(ident)
        if asset['kind']!='video': raise ValueError('Choose a video')
        seconds = number(seconds,0,asset['metadata'].get('duration',0),'Preview time')
        from social_exports import ffmpeg_binary
        result = subprocess.run([ffmpeg_binary(),'-hide_banner','-loglevel','error','-nostdin','-ss',str(seconds),
            '-i',str(self.workspace.path_for(asset)),'-frames:v','1','-vf','scale=960:960:force_original_aspect_ratio=decrease:reset_sar=1',
            '-f','image2pipe','-vcodec','png','pipe:1'],capture_output=True,timeout=30,**self.exports.process_args())
        if result.returncode or not result.stdout: raise ValueError('No frame at this time. Move slightly earlier.')
        return result.stdout

    def jobs(self, ident=None):
        with self.workspace.db() as db:
            rows = db.execute('SELECT * FROM assist_jobs'+(' WHERE asset_id=?' if ident else '')+' ORDER BY created DESC', (ident,) if ident else ()).fetchall()
        return [dict(r,options=json.loads(r['options']),result=json.loads(r['result']) if r['result'] else None) for r in rows]

    def job(self, ident):
        with self.workspace.db() as db:
            row = db.execute('SELECT * FROM assist_jobs WHERE id=?',(ident,)).fetchone()
        if not row: raise ValueError('Analysis job not found')
        return dict(row)

    def update(self, ident, **values):
        if not values.keys() <= {'state','progress','result','error'}: raise ValueError('Invalid analysis update')
        with self.workspace.db() as db:
            db.execute('UPDATE assist_jobs SET '+','.join(k+'=?' for k in values)+' WHERE id=?', [*values.values(),ident])

    def enqueue(self, ident, data):
        asset = self.workspace.asset(ident)
        duration = asset['metadata'].get('duration',0)
        if not 0 < duration <= 600: raise ValueError('Local analysis supports clips up to 10 minutes')
        task = data.get('action')
        if task not in ('track','transcribe','align'): raise ValueError('Unknown analysis task')
        if asset['kind'] not in (('video',) if task=='track' else ('video','audio')): raise ValueError('Choose compatible media')
        self.workspace.path_for(asset)
        options = {}
        if task=='track':
            box = data.get('box')
            if box is not None:
                if not isinstance(box,list) or len(box)!=4: raise ValueError('Draw a subject box on the first frame')
                box = [number(v,0,100,'Subject box') for v in box]
                if box[2]<2 or box[3]<2 or box[0]+box[2]>100.01 or box[1]+box[3]>100.01: raise ValueError('Keep a subject box of at least 2% inside the frame')
            options['box'] = box
        else:
            capabilities=self.capabilities()
            if not capabilities['captions_ready']: raise ValueError(capabilities['caption_error'])
            language = data.get('language','auto')
            if language not in ('auto','en','es','fr','de','it','pt','ja','ko','zh','hi','ar','ru','nl'): raise ValueError('Choose a supported language')
            import av
            with av.open(str(self.workspace.path_for(asset))) as container:
                if not container.streams.audio: raise ValueError('This file has no audio track. Add captions manually instead.')
            options['language'] = language
            if task=='align':
                cues=validate_document({'cues':data.get('cues')},duration)['cues']
                if not cues: raise ValueError('Add or transcribe captions before aligning edited text')
                indices=data.get('indices',list(range(len(cues))))
                if (not isinstance(indices,list) or not indices or
                    any(type(i) is not int or not 0<=i<len(cues) for i in indices) or
                    len(set(indices))!=len(indices)):
                    raise ValueError('Choose valid, distinct caption indices to align')
                options.update(cues=cues,indices=sorted(indices))
        request = str(uuid.UUID(data.get('request_id',str(uuid.uuid4()))))
        with self.lock, self.workspace.db() as db:
            prior = db.execute('SELECT * FROM assist_jobs WHERE request_id=?',(request,)).fetchone()
            if prior:
                if prior['asset_id']!=ident or prior['task']!=task or json.loads(prior['options'])!=options: raise ValueError('Request ID already used with different settings')
                return {'id':prior['id']}
            job_id = uuid.uuid4().hex
            db.execute('INSERT INTO assist_jobs (id,request_id,asset_id,task,options,state,created) VALUES (?,?,?,?,?,?,?)',
                (job_id,request,ident,task,json.dumps(options),'queued',time.time()))
        self.wake.set()
        return {'id':job_id}

    def cancel(self, ident):
        with self.lock:
            job = self.job(ident)
            if job['state'] not in ('queued','running'): raise ValueError('This job is no longer active')
            self.update(ident,state='cancelled' if job['state']=='queued' else 'cancelling')
        return {'id':ident}

    def run_process(self, args, ident, progress=None):
        log = self.folder/(ident+'.log')
        env = dict(os.environ, HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1', DO_NOT_TRACK='1')
        with log.open('a',encoding='utf-8') as stream:
            process = subprocess.Popen(args,stdout=stream,stderr=stream,env=env,**self.exports.process_args())
            start = time.monotonic()
            try:
                while process.poll() is None:
                    if self.closed.is_set() or self.job(ident)['state']=='cancelling': raise InterruptedError()
                    if time.monotonic()-start>3600: raise ValueError('Analysis exceeded one hour')
                    if progress and progress.is_file():
                        try: self.update(ident,progress=min(.99,float(progress.read_text())))
                        except (OSError,ValueError): pass
                    self.closed.wait(.25)
                if process.returncode: raise ValueError(log.read_text(encoding='utf-8',errors='replace')[-1200:])
            finally:
                if process.poll() is None:
                    process.terminate()
                    try: process.wait(timeout=5)
                    except subprocess.TimeoutExpired: process.kill(); process.wait()

    def run_one(self):
        with self.lock, self.workspace.db() as db:
            row = db.execute("SELECT id FROM assist_jobs WHERE state='queued' ORDER BY created LIMIT 1").fetchone()
            if not row: return False
            ident = row['id']; db.execute("UPDATE assist_jobs SET state='running' WHERE id=?",(ident,))
        request, output, progress, clip = [self.folder/(ident+suffix) for suffix in ('.request.json','.result.json','.progress','.mp4')]
        job = None
        try:
            job = self.job(ident)
            asset = self.workspace.asset(job['asset_id'])
            source = self.workspace.path_for(asset)
            if job['task']=='track':
                from social_exports import ffmpeg_binary
                self.run_process([ffmpeg_binary(),'-hide_banner','-loglevel','error','-nostdin','-y','-i',str(source),
                    '-an','-vf','fps=10,scale=640:640:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1',
                    '-c:v','libx264','-preset','ultrafast','-crf','16','-threads','2',str(clip)],ident)
                source = clip
            request.write_text(json.dumps({'task':job['task'],'source':str(source),'model':str(self.model),
                'options':json.loads(job['options']),'duration':asset['metadata']['duration'],
                'output':str(output),'progress':str(progress)}),encoding='utf-8')
            python = str(self.caption_python) if job['task'] in ('transcribe','align') else sys.executable
            worker='caption_worker.py' if job['task'] in ('transcribe','align') else 'editing_worker.py'
            self.run_process([python,str(Path(__file__).with_name(worker)),str(request)],ident,progress)
            result = json.loads(output.read_text(encoding='utf-8'))
            clean = validate_document(result,asset['metadata']['duration'])
            if job['task']=='align':
                from forced_alignment import validate_result
                validate_result(json.loads(job['options']),result,clean['cues'])
            with self.lock:
                if self.closed.is_set() or self.job(ident)['state']=='cancelling': raise InterruptedError()
                self.update(ident,state='completed',progress=1,result=json.dumps({**result,**clean}))
        except InterruptedError:
            self.update(ident,state='interrupted' if self.closed.is_set() else 'cancelled')
        except Exception as error:
            self.update(ident,state='failed',error=str(error)[-1500:])
            if job and job['task'] in ('transcribe','align') and any(s in str(error) for s in ('Application Control','DLL load failed','model integrity check failed')):
                from caption_runtime import record_failure
                record_failure(self.caption_python,self.model,str(error))
        finally:
            for file in (request,output,progress,clip): file.unlink(missing_ok=True)
        return True

    def start(self):
        with self.workspace.db() as db:
            db.execute("UPDATE assist_jobs SET state='interrupted',error='Studio stopped during analysis. Start analysis again.' WHERE state IN ('running','cancelling')")
        def worker():
            while not self.closed.is_set():
                try:
                    if self.run_one(): continue
                except Exception: pass
                self.wake.wait(1); self.wake.clear()
        self.thread = threading.Thread(target=worker,name='studio-local-editing',daemon=True)
        self.thread.start()

    def close(self):
        self.closed.set(); self.wake.set()
        if hasattr(self,'thread'): self.thread.join(timeout=8)
