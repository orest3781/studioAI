"""Small, allowlisted product controls over the verified local graphs."""
import io
import json
import math
import secrets
from pathlib import Path
from studio_paths import WORKSPACE
import av
from PIL import Image, ImageOps
from quality_profiles import apply as apply_quality, options as quality_options
from duration_profiles import apply as apply_duration, options as duration_options, validate as validate_duration, SOURCE_VIDEO
from aspect_profiles import apply as apply_aspect, options as aspect_options, validate as validate_aspect, dimensions as portrait_dimensions

ROOT = Path(__file__).resolve().parent
INPUT = WORKSPACE / 'ComfyUI/input/studio-uploads'
INPUT.mkdir(exist_ok=True)
PROMPTS = ROOT / 'tests/render-prompts'
TEXT = {'animal':'21','sdxl':'2','image':'2','flux3':'2','inpaint':'2','control':'2','reference':'2','edit':'4','video':'4','wan14':'4','ltxlegacy':'4','motion':'4','vace':'4','talk':'4','ltx':'5'}
# key, friendly label, media kind, destination node, destination field
FIELDS = {
 'animal':[('video','Performance video','video','145','file'),('image','Animal reference','image','10','image')],
 'video':[('image','Starting image','image','12','image')],
 'edit':[('image','Image to edit','image','6','image')],
 'inpaint':[('image','Image to edit','image','8','image'),('mask','Area to replace (white = replace)','mask','9','image')],
 'control':[('image','Pose map (OpenPose colors)','image','8','image')],
 'reference':[('image','Character reference','image','10','image')],
 'background':[('image','Image','image','1','image')],
 'upscale':[('image','Image','image','1','image')],
 'motion':[('image','Character reference','image','12','image'),('video','Driving performance','video','13','file')],
 'talk':[('image','Character image','image','12','image'),('audio','Voice recording','audio','13','audio')],
 'vace':[('video','Video to edit','video',None,None),('mask','Area to replace (white = replace)','mask','14','image')],
 'interpolate':[('video','Video to smooth','video','1','file')],
}
IDS = set(TEXT) | set(FIELDS)
HINTS = {'animal':'2-second silent preview. For your own clip, click the performer in its first frame. Face detail may need refinement.', 'vace':'1-second preview. Use a white-on-black mask; the same mask is applied throughout the short clip.', 'control':'Upload a prepared OpenPose color map, not a photograph.', 'interpolate':'Smooths the first nine frames into 17 frames.', 'talk':'Short speaking preview using the start of your recording. Sample mode uses a test tone, not speech.', 'motion':'Short silent preview. Describe the character and scene; exact clothing and background may vary.'}

def graph(ident):
    if ident not in IDS: raise ValueError('Unknown workflow')
    return json.loads((PROMPTS / (ident+'.json')).read_text(encoding='utf-8'))

def catalog():
    return {ident:{'prompt':graph(ident)[TEXT[ident]]['inputs']['text'] if ident in TEXT else None,
                   'fields':[{'key':k,'label':label+(' (optional)' if ident=='video' else ''),'kind':kind,'optional':ident=='video'} for k,label,kind,_,_ in FIELDS.get(ident,[])],
                   'quality':quality_options(ident),
                   'portrait':aspect_options(ident),
                   'durations':duration_options(ident),'duration_needs_video':ident in SOURCE_VIDEO,
                   'duration_source':'video' if ident in SOURCE_VIDEO else 'audio' if ident=='talk' else None,
                   'hint':{'animal':'Click the performer in the first frame of your clip. Face detail may need refinement.', 'vace':'Paint a selection on the first frame. That fixed selection applies throughout the clip.', 'control':'Upload a prepared OpenPose color map, not a photograph.', 'talk':'Uses the beginning of your recording. The sample uses a test tone, not speech.', 'flux3':'Describe the full scene: subject, framing, background, lighting, and style.'}.get(ident,'Choose Preview to explore, or High quality for a more detailed result.')} for ident in sorted(IDS)}

def media(token, kind=None):
    if not isinstance(token,str) or len(token)!=32 or any(c not in '0123456789abcdef' for c in token):
        raise ValueError('Upload the required media first')
    file=INPUT/(token+'.json')
    if not file.is_file():raise ValueError('This upload is no longer available. Please upload it again.')
    data=json.loads(file.read_text())
    if kind and data['kind']!=kind:raise ValueError('Wrong media type')
    return data

def upload(raw,kind):
    if kind not in ('image','mask','video','audio'):raise ValueError('Unsupported media type')
    token=secrets.token_hex(16)
    name=token+({'image':'.png','mask':'.png','video':'.mp4','audio':'.wav'}[kind])
    dest=INPUT/name
    try:
        if kind in ('image','mask'):
            with Image.open(io.BytesIO(raw)) as im:
                if im.width*im.height>40_000_000:raise ValueError('Use an image smaller than 40 megapixels')
                im=ImageOps.exif_transpose(im)
                if kind=='image':
                    # Retain the oriented full frame for native portrait conditioning.
                    # Existing square uploads and mask coordinates stay unchanged.
                    original_size=im.size
                    im.convert('RGB').save(INPUT/(token+'-source.png'))
                full=im.convert('RGB').resize((1024,1024),Image.Resampling.NEAREST) if kind=='mask' else ImageOps.fit(im.convert('RGB'),(1024,1024),method=Image.Resampling.LANCZOS)
                full.save(INPUT/(token+'-high.png'))
                im=im.convert('RGB').resize((512,512),Image.Resampling.NEAREST) if kind=='mask' else ImageOps.fit(im.convert('RGB'),(512,512),method=Image.Resampling.LANCZOS)
                im.save(dest)
        elif kind=='video':
            frames=[]
            with av.open(io.BytesIO(raw)) as src:
                stream=src.streams.video[0]
                if stream.width*stream.height>4096*2160:raise ValueError('Use a video at 4K or smaller')
                rate=float(stream.average_rate or 24)
                previous=None;first_time=None;last_time=0.0
                for index,frame in enumerate(src.decode(video=0)):
                    stamp=float(frame.time) if frame.time is not None else index/rate
                    if first_time is None:first_time=stamp
                    stamp=max(0.0,stamp-first_time)
                    while previous is not None and len(frames)<240 and len(frames)/24<stamp-1e-6:
                        frames.append(previous)
                    previous=frame.reformat(width=768,height=432,format='rgb24')
                    last_time=stamp
                    if stamp>=10:break
                end=min(10.0,last_time+1/rate)
                while previous is not None and len(frames)<240 and len(frames)/24<end-1e-6:frames.append(previous)
            if len(frames)<9:raise ValueError('Use a clip with at least nine frames')
            source_seconds=min(end,len(frames)/24)
            frames[0].to_image().save(INPUT/(token+'-preview.png'))
            with av.open(str(dest),'w') as out:
                stream=out.add_stream('libx264',rate=24);stream.width=768;stream.height=432;stream.pix_fmt='yuv420p'
                for i in range(max(49,len(frames)+1)):
                    frame=av.VideoFrame.from_image(frames[min(i,len(frames)-1)].to_image());frame.pts=i
                    for packet in stream.encode(frame):out.mux(packet)
                for packet in stream.encode():out.mux(packet)
        else:
            samples=0
            with av.open(io.BytesIO(raw)) as src, av.open(str(dest),'w') as out:
                stream=out.add_stream('pcm_s16le',rate=16000);stream.layout='mono'
                resampler=av.AudioResampler(format='s16',layout='mono',rate=16000)
                for frame in src.decode(audio=0):
                    for converted in resampler.resample(frame):
                        remaining=160000-samples
                        if remaining<=0:break
                        if converted.samples>remaining:
                            converted=av.AudioFrame.from_ndarray(converted.to_ndarray()[:,:remaining],format='s16',layout='mono')
                            converted.sample_rate=16000
                        converted.pts=None
                        for packet in stream.encode(converted):out.mux(packet)
                        samples+=converted.samples
                    if samples>=160000:break
                for packet in stream.encode():out.mux(packet)
                if samples<1600:raise ValueError('Use an audio clip longer than 0.1 seconds')
        result={'token':token,'kind':kind,'name':'studio-uploads/'+name,'preview':'/api/media/'+token+('/preview' if kind=='video' else '')}
        if kind in ('image','mask'):result['high_name']='studio-uploads/'+token+'-high.png'
        if kind=='image':result.update(source_name='studio-uploads/'+token+'-source.png',source_width=original_size[0],source_height=original_size[1],source_preview='/api/media/'+token+'/source')
        if kind=='video':result.update(duration_seconds=source_seconds,prepared_frames=max(49,len(frames)+1))
        if kind=='audio':result['duration_seconds']=samples/16000
        (INPUT/(token+'.json')).write_text(json.dumps(result))
        return result
    except Exception as error:
        dest.unlink(missing_ok=True)
        (INPUT/(token+'-source.png')).unlink(missing_ok=True)
        if isinstance(error,ValueError):raise
        raise ValueError('Could not read this media. Try PNG/JPEG, MP4, or WAV/MP3.') from error

def build(data):
    ident=data.get('workflow','animal');g=graph(ident)
    aspect=data.get('aspect_ratio','original')
    validate_aspect(ident,aspect)
    quality=data.get('quality','preview')
    if quality not in ('preview','high'):raise ValueError('Choose Preview or High quality')
    seconds=data.get('duration',0)
    validate_duration(ident,seconds,data.get('mode','sample'),data.get('uploads',{}),media)
    if data.get('mode','sample') not in ('sample','custom'):raise ValueError('Choose sample or your own files')
    seed=data.get('seed',secrets.randbelow(2**32))
    if type(seed)!=int or not 0<=seed<2**53:raise ValueError('Invalid variation')
    if ident in TEXT:
        text=data.get('prompt',g[TEXT[ident]]['inputs']['text'])
        if not isinstance(text,str) or not 1<=len(text.strip())<=4000:raise ValueError('Describe your result in 1–4000 characters')
        g[TEXT[ident]]['inputs']['text']=text.strip()
    for node in g.values():
        for key in ('seed','noise_seed'):
            if key in node['inputs'] and isinstance(node['inputs'][key],int):node['inputs'][key]=seed
        if node['class_type'] in ('SaveVideo','SaveImage'):node['inputs']['filename_prefix']='studio/'+ident
    if ident=='inpaint':
        # Preserve the user's unpainted pixels rather than VAE-reconstructing them.
        g['studio_composite']={'class_type':'ImageCompositeMasked','inputs':{'destination':['8',0],'source':['6',0],'mask':['10',0],'x':0,'y':0,'resize_source':False}}
        g['7']['inputs']['images']=['studio_composite',0]
    if data.get('mode')=='custom':
        uploads=data.get('uploads',{})
        if not isinstance(uploads,dict):raise ValueError('Invalid uploads')
        for key,label,kind,node,field in FIELDS.get(ident,[]):
            if ident=='video' and not uploads.get(key):
                g['7']['inputs'].pop('start_image',None)
                g.pop('12',None)
                continue
            item=media(uploads.get(key),kind)
            value=item.get('high_name',item['name']) if quality=='high' else item['name']
            if node:g[node]['inputs'][field]=value
            else:
                g['studio_video']={'class_type':'LoadVideo','inputs':{'file':value}}
                g['studio_frames']={'class_type':'GetVideoComponents','inputs':{'video':['studio_video',0]}}
                g['13']={'class_type':'ImageFromBatch','inputs':{'image':['studio_frames',0],'batch_index':0,'length':17}}
        if ident=='animal':
            point=data.get('point')
            if not isinstance(point,list) or len(point)!=2 or any(type(v) not in (int,float) or not math.isfinite(v) or not 0<=v<=1 for v in point):raise ValueError('Click the performer in the first frame')
            coords=json.dumps([{'x':round(point[0]*767),'y':round(point[1]*431)}])
            g['229']['inputs'].update(coordinates=coords,neg_coordinates='[]',points_store=json.dumps({'positive':json.loads(coords),'negative':[]}))
            g['1062']['inputs'].pop('face_video',None)
            for key in ('1402','1403'):g.pop(key,None)
        if ident=='interpolate':
            g['studio_short']={'class_type':'ImageFromBatch','inputs':{'image':['2',0],'batch_index':0,'length':9}}
            g['3']['inputs']['frames']=['studio_short',0]
            g['4']['inputs']['fps']=48.0
    g=apply_aspect(apply_duration(apply_quality(g,ident,quality),ident,quality,seconds),ident,quality,seconds,aspect)
    if aspect=='9:16' and ident=='video' and 'start_image' in g['7']['inputs']:
        # Wan's conditioning node center-crops a mismatched input. Supply an
        # already fitted full frame so it cannot silently remove source content.
        source=g['12']['inputs']['image']
        if data.get('mode')=='custom':
            item=media(data.get('uploads',{}).get('image'),'image')
            source=item.get('source_name')
            if not source:raise ValueError('Re-upload the original starting image for native portrait generation')
        w,h=portrait_dimensions(ident,quality,seconds)
        path=INPUT.parent/source
        target=INPUT/(path.stem+f'-portrait-{w}x{h}.png')
        with Image.open(path) as im:
            ImageOps.pad(ImageOps.exif_transpose(im).convert('RGB'),(w,h),method=Image.Resampling.LANCZOS,color=(0,0,0)).save(target)
        g['12']['inputs']['image']='studio-uploads/'+target.name
    return g
