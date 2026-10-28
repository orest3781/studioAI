"""Bounded longer-clip profiles for local GPUs; no arbitrary frame slider."""
import json

SUPPORTED = {'video','ltxlegacy','ltx','animal','interpolate','wan14','motion','vace','talk'}
SOURCE_VIDEO = {'animal','interpolate','motion','vace'}
FPS = {'video':24,'ltxlegacy':16,'ltx':24,'animal':24,'interpolate':48,'wan14':16,'motion':24,'vace':24,'talk':16}


def dimensions(ident, quality, seconds):
    if ident == 'interpolate':return 768,432
    if quality == 'preview':return (384,224) if ident=='animal' else (320,192)
    if ident in ('wan14','motion','vace','talk'):return (640,352) if seconds==5 else (512,288)
    if ident == 'animal':return (640,352) if seconds==5 else (512,288)
    if ident == 'ltxlegacy' or seconds==5:return 768,448
    return 640,384


def options(ident):
    if ident not in SUPPORTED:return []
    choices=[{'seconds':0,'label':'Short clip'}]
    for seconds in (5,10):
        qualities={}
        for quality,label in (('preview','Preview'),('high','High quality')):
            w,h=dimensions(ident,quality,seconds)
            qualities[quality]={'label':label,'description':f'{w} × {h} · {seconds} seconds'+(' · takes longer' if quality=='high' else '')}
        choices.append({'seconds':seconds,'label':f'{seconds} seconds','quality':qualities})
    return choices


def validate(ident, seconds, mode, uploads, media):
    if type(seconds)!=int or seconds not in (0,5,10):raise ValueError('Choose Short clip, 5 seconds, or 10 seconds')
    if not seconds:return
    if ident not in SUPPORTED:raise ValueError('Longer clips are not enabled for this workflow')
    if ident in SOURCE_VIDEO or ident=='talk':
        kind='audio' if ident=='talk' else 'video'
        if mode!='custom':raise ValueError(f'Upload your own {kind} for a longer clip')
        if not isinstance(uploads,dict):raise ValueError('Invalid uploads')
        item=media(uploads.get(kind),kind)
        length=item.get('duration_seconds')
        if length is None:raise ValueError(f'Re-upload the original {kind} to use longer clips')
        if length+0.001<seconds:raise ValueError(f'Use {kind} at least {seconds} seconds long, or choose a shorter duration')


def apply(g, ident, quality, seconds):
    if not seconds:return g
    w,h=dimensions(ident,quality,seconds)
    fps=FPS[ident]
    frames=fps*seconds+1
    if ident in ('video','ltxlegacy','ltx','wan14','motion','vace','talk'):
        latent='8' if ident=='ltx' else '7'
        g[latent]['inputs'].update(width=w,height=h,length=frames)
        if ident=='ltx':g['9']['inputs']['frames_number']=frames
        if ident=='motion':g['15']['inputs']['length']=frames
        if ident=='vace':
            g['13']['inputs']['length']=frames
            g['15']['inputs']['amount']=frames
        create='19' if ident=='ltx' else '10'
    elif ident=='animal':
        g['159']['inputs']['value']=w;g['160']['inputs']['value']=h
        g['1062']['inputs']['length']=frames;g['1300']['inputs']['length']=frames
        point=g['229']['inputs']
        positive=[{'x':round(p['x']*(w-1)/767),'y':round(p['y']*(h-1)/431)} for p in json.loads(point['coordinates'])]
        negative=[{'x':round(p['x']*(w-1)/767),'y':round(p['y']*(h-1)/431)} for p in json.loads(point['neg_coordinates'])]
        point.update(width=w,height=h,coordinates=json.dumps(positive),neg_coordinates=json.dumps(negative),
                     points_store=json.dumps({'positive':positive,'negative':negative}))
        create='1015'
    else:
        # One extra source frame gives enough interpolated frames to trim exactly.
        g['studio_short']['inputs']['length']=24*seconds+1
        create='4'
    for n in g.values():
        if n['class_type']=='VAEDecode':
            n['class_type']='VAEDecodeTiled'
            n['inputs'].update(tile_size=256,overlap=64,temporal_size=16,temporal_overlap=4)
    images=g[create]['inputs']['images']
    g['duration_trim']={'class_type':'ImageFromBatch','inputs':{'image':images,'batch_index':0,'length':fps*seconds}}
    g[create]['inputs'].update(images=['duration_trim',0],fps=float(fps))
    if ident in ('ltx','talk'):
        g['duration_audio']={'class_type':'TrimAudioDuration','inputs':{'audio':g[create]['inputs']['audio'],'start_index':0.0,'duration':float(seconds)}}
        g[create]['inputs']['audio']=['duration_audio',0]
        if ident=='talk':g['15']['inputs']['audio']=['duration_audio',0]
    for n in g.values():
        if n['class_type']=='SaveVideo':n['inputs']['filename_prefix']=f'studio/{ident}-{quality}-{seconds}s'
    return g
