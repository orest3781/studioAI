"""Atomic social delivery sets on the existing local export queue."""
import hashlib
import json
from pathlib import Path
import re
import threading
import time
import uuid
import zipfile

from editing import EditConflict, subtitles
from social_exports import PRESETS, normalize, ffmpeg_binary

FORMATS = ('reels', 'tiktok', 'shorts', 'portrait', 'square', 'landscape')
ACTIVE = ('queued', 'running', 'cancelling')
RETRYABLE = ('failed', 'interrupted', 'cancelled')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def settings(data):
    if not isinstance(data, dict): raise ValueError('Expected batch settings')
    ids, presets = data.get('asset_ids'), data.get('presets')
    if not isinstance(ids, list) or not 1 <= len(ids) <= 50 or any(not isinstance(i,str) for i in ids):
        raise ValueError('Select between 1 and 50 image or video assets')
    if len(set(ids)) != len(ids): raise ValueError('Each asset can appear only once in a batch')
    if not isinstance(presets, list) or not presets or any(p not in FORMATS for p in presets):
        raise ValueError('Select at least one social format')
    if len(set(presets)) != len(presets): raise ValueError('Choose each format only once')
    size, fit, fmt = data.get('size',1080), data.get('fallback','contain'), data.get('image_format','png')
    if type(size) is not int or size not in (720,1080): raise ValueError('Choose 720 or 1080 resolution')
    if fit not in ('contain','crop','blur'): raise ValueError('Choose a fallback framing mode')
    if fmt not in ('png','jpg'): raise ValueError('Choose PNG or JPEG for images')
    framing, captions = data.get('use_saved_framing',True), data.get('include_captions',True)
    if type(framing) is not bool or type(captions) is not bool: raise ValueError('Invalid saved-edit preference')
    return {'asset_ids':sorted(ids),'presets':[p for p in FORMATS if p in presets], 'size':size,
            'fallback':fit,'image_format':fmt,'use_saved_framing':framing,'include_captions':captions}


class BatchExportManager:
    def __init__(self, workspace, exports, editing):
        self.workspace, self.exports, self.editing = workspace, exports, editing
        self.folder = workspace.data/'batch-deliveries'
        self.folder.mkdir(exist_ok=True)
        self.archive_lock = threading.Lock()
        exports.batches = self
        with workspace.db() as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS export_batches (
                id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, settings TEXT NOT NULL,
                review_token TEXT NOT NULL, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS batch_items (
                id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, asset_id TEXT NOT NULL,
                name TEXT NOT NULL, preset TEXT NOT NULL, options TEXT NOT NULL, export_id TEXT NOT NULL,
                UNIQUE(batch_id,asset_id,preset));
                CREATE INDEX IF NOT EXISTS batch_items_batch ON batch_items(batch_id);''')

    def prepare(self, data):
        config = settings(data)
        rows, assets, fingerprints = [], [], []
        with self.editing.lock:
            for ident in config['asset_ids']:
                asset = self.workspace.asset(ident)
                if asset['kind'] not in ('image','video'): raise ValueError(f"{asset['name']}: select images or videos, not audio")
                path = self.workspace.path_for(asset)
                if asset['kind']=='video' and not ffmpeg_binary(): raise ValueError('FFmpeg is required for video exports')
                doc = self.editing.document(ident) if asset['kind']=='video' else None
                tracked = bool(doc and doc['points'] and config['use_saved_framing'])
                captioned = bool(doc and doc['cues'] and config['include_captions'])
                fit = 'crop' if tracked else config['fallback']
                snapshot = {**doc,'points':doc['points'] if tracked else [],'cues':doc['cues'] if captioned else []} if tracked or captioned else None
                notes = []
                if asset['kind']=='video':
                    if config['use_saved_framing'] and not tracked: notes.append('No saved crop path; using fallback framing.')
                    if config['include_captions'] and not captioned: notes.append('No saved captions; exporting without captions.')
                    duration = asset['metadata'].get('duration',0)
                    if 'reels' in config['presets'] and duration < 3: notes.append('Under 3 seconds: shorter than the Reels publishing API minimum. Duration is unchanged.')
                    if 'shorts' in config['presets'] and duration > 180: notes.append('Over 3 minutes: trim before publishing as a Short.')
                elif any(p in config['presets'] for p in ('reels','tiktok','shorts')):
                    notes.append('Still image for your edit; this does not turn an image into a video.')
                info = {'id':ident,'name':asset['name'],'kind':asset['kind'],'project_id':asset['project_id'],
                        'revision':doc['revision'] if doc else 0,'tracked':tracked,'captions':len(doc['cues']) if captioned else 0,
                        'fit':fit,'notes':notes}
                assets.append(info)
                stat = path.stat(); fingerprints.append((ident,stat.st_size,stat.st_mtime_ns))
                for preset in config['presets']:
                    fmt = 'mp4' if asset['kind']=='video' else config['image_format']
                    background = 'transparent' if fmt=='png' and fit!='blur' and asset['metadata'].get('alpha') else 'black'
                    options = normalize({'preset':preset,'size':config['size'],'fit':fit,'format':fmt,'background':background},asset['kind'])
                    if snapshot: options['edit_snapshot'] = snapshot
                    rows.append({'asset_id':ident,'name':asset['name'],'preset':preset,'options':options})
        token = hashlib.sha256(canonical({'config':config,'rows':rows,'assets':assets,'sources':fingerprints}).encode()).hexdigest()
        return {'settings':config,'review_token':token,'assets':assets,'rows':rows,'total':len(rows)}

    @staticmethod
    def public_plan(plan):
        # The browser needs the delivery settings, not repeated transcript/keyframe payloads.
        return {**plan,'rows':[dict(row, options={k:v for k,v in row['options'].items() if k!='edit_snapshot'}) for row in plan['rows']]}

    def enqueue(self, data):
        config = settings(data)
        request = str(uuid.UUID(data.get('request_id',str(uuid.uuid4()))))
        token = data.get('review_token')
        if not isinstance(token,str) or not re.fullmatch('[a-f0-9]{64}',token): raise ValueError('Review the batch before starting exports')
        with self.exports.lock, self.editing.lock:
            with self.workspace.db() as db:
                prior = db.execute('SELECT * FROM export_batches WHERE request_id=?',(request,)).fetchone()
            if prior:
                if json.loads(prior['settings'])!=config or prior['review_token']!=token: raise ValueError('This request ID was already used for a different batch')
                return {'id':prior['id']}
            plan = self.prepare(config)
            if plan['review_token']!=token: raise EditConflict('Sources or saved edits changed after review. Review the batch again; nothing has been queued.')
            ident, created = uuid.uuid4().hex, time.time()
            with self.workspace.db() as db:
                db.execute('INSERT INTO export_batches VALUES (?,?,?,?,?)',(ident,request,canonical(config),token,created))
                for index,row in enumerate(plan['rows']):
                    item_id, export_id = uuid.uuid4().hex, uuid.uuid4().hex
                    options = {**row['options'],'batch_id':ident,'batch_item_id':item_id}
                    db.execute('INSERT INTO batch_items VALUES (?,?,?,?,?,?,?)',
                        (item_id,ident,row['asset_id'],row['name'],row['preset'],canonical(options),export_id))
                    db.execute('INSERT INTO exports (id,request_id,asset_id,options,state,created) VALUES (?,?,?,?,?,?)',
                        (export_id,str(uuid.uuid4()),row['asset_id'],canonical(options),'queued',created+index*.00001))
        self.exports.wake.set()
        return {'id':ident}

    def detail(self, ident):
        with self.workspace.db() as db:
            batch = db.execute('SELECT * FROM export_batches WHERE id=?',(ident,)).fetchone()
            if not batch: raise ValueError('Batch not found')
            rows = db.execute('''SELECT i.id AS item_id,i.name,i.preset,e.* FROM batch_items i
                JOIN exports e ON e.id=i.export_id WHERE i.batch_id=? ORDER BY e.created,i.id''',(ident,)).fetchall()
        jobs = [dict(r,options=json.loads(r['options'])) for r in rows]
        result = dict(batch,settings=json.loads(batch['settings']),jobs=jobs)
        result.update(self.summarize(jobs))
        return result

    @staticmethod
    def summarize(jobs):
        counts = {key:sum(j['state']==key for j in jobs) for key in (*ACTIVE,'completed',*RETRYABLE)}
        active = sum(counts[k] for k in ACTIVE)
        state = 'running' if counts['running'] or counts['cancelling'] else 'queued' if counts['queued'] else 'completed' if counts['completed']==len(jobs) else 'cancelled' if counts['cancelled']==len(jobs) else 'needs_attention'
        return {'state':state,'total':len(jobs),'ready':counts['completed'],'active':active,
                'retryable':sum(counts[k] for k in RETRYABLE),'counts':counts,
                'progress':sum(1 if j['state'] not in ACTIVE else j['progress'] for j in jobs)/max(1,len(jobs))}

    def list(self):
        with self.workspace.db() as db:
            batches = db.execute('SELECT id,created,settings FROM export_batches ORDER BY created DESC').fetchall()
            jobs = db.execute('SELECT i.batch_id,e.state,e.progress FROM batch_items i JOIN exports e ON e.id=i.export_id').fetchall()
        grouped = {}
        for row in jobs: grouped.setdefault(row['batch_id'],[]).append(row)
        return [dict(b,settings=json.loads(b['settings']),**self.summarize(grouped.get(b['id'],[]))) for b in batches]

    def cancel(self, ident):
        with self.exports.lock, self.workspace.db() as db:
            if not db.execute('SELECT id FROM export_batches WHERE id=?',(ident,)).fetchone(): raise ValueError('Batch not found')
            db.execute("UPDATE exports SET state='cancelled',finished=? WHERE state='queued' AND id IN (SELECT export_id FROM batch_items WHERE batch_id=?)",(time.time(),ident))
            db.execute("UPDATE exports SET state='cancelling' WHERE state='running' AND id IN (SELECT export_id FROM batch_items WHERE batch_id=?)",(ident,))
        return {'id':ident}

    def retry(self, ident, item=None, previous_export=None):
        with self.exports.lock, self.workspace.db() as db:
            if not db.execute('SELECT id FROM export_batches WHERE id=?',(ident,)).fetchone(): raise ValueError('Batch not found')
            rows = db.execute('''SELECT i.*,e.state FROM batch_items i JOIN exports e ON i.export_id=e.id
                WHERE i.batch_id=?'''+(' AND i.id=?' if item else ''),(ident,item) if item else (ident,)).fetchall()
            ids = []
            for row in rows:
                if previous_export and row['export_id']!=previous_export: return {'id':row['export_id']}
                if row['state'] not in RETRYABLE: continue
                export_id = uuid.uuid4().hex
                db.execute('INSERT INTO exports (id,request_id,asset_id,options,state,created) VALUES (?,?,?,?,?,?)',
                    (export_id,str(uuid.uuid4()),row['asset_id'],row['options'],'queued',time.time()+len(ids)*.00001))
                db.execute('UPDATE batch_items SET export_id=? WHERE id=?',(export_id,row['id']))
                ids.append(export_id)
        self.exports.wake.set()
        return {'id':ids[0]} if item and ids else {'id':ident,'retried':len(ids)}

    def archive(self, ident):
        batch = self.detail(ident)
        if batch['active']: raise ValueError('Wait for exports to finish or cancel remaining work before downloading the batch')
        if not batch['ready']: raise ValueError('This batch has no completed files to download')
        signature = hashlib.sha256(canonical([(j['id'],j['state']) for j in batch['jobs']]).encode()).hexdigest()[:16]
        target = self.folder/(ident+'-'+signature+'.zip')
        with self.archive_lock:
            if target.is_file(): return target
            temporary = target.with_suffix('.part.zip')
            manifest = {'batch_id':ident,'created':batch['created'],'complete':batch['ready']==batch['total'],'outputs':[]}
            try:
                with zipfile.ZipFile(temporary,'w',compression=zipfile.ZIP_STORED,allowZip64=True) as bundle:
                    caption_files = set()
                    for job in batch['jobs']:
                        entry = {'source_asset_id':job['asset_id'],'source_name':job['name'],'preset':job['preset'],
                                 'state':job['state'],'options':job['options'],'error':job['error']}
                        if job['state']=='completed':
                            asset = self.workspace.asset(job['output_asset_id']);source = self.workspace.path_for(asset)
                            safe = re.sub(r'[^\w .-]','_',Path(job['name']).stem,flags=re.UNICODE).strip(' .')[:70] or 'asset'
                            folder = safe+'--'+job['asset_id']
                            filename = folder+'/'+job['preset']+'-'+job['options']['ratio'].replace(':','x')+source.suffix
                            bundle.write(source,filename)
                            entry.update(file=filename,output_asset_id=asset['id'])
                            snapshot = job['options'].get('edit_snapshot',{})
                            if snapshot.get('cues') and folder not in caption_files:
                                for fmt in ('srt','vtt'): bundle.writestr(folder+'/captions.'+fmt,subtitles(snapshot['cues'],fmt))
                                caption_files.add(folder)
                        manifest['outputs'].append(entry)
                    bundle.writestr('manifest.json',json.dumps(manifest,indent=2,ensure_ascii=False))
                temporary.replace(target)
            finally: temporary.unlink(missing_ok=True)
        return target
