"""Bounded presets for the RTX 4070 Ti SUPER (16 GB), not arbitrary sliders.

Keep distilled schedules intact. Larger video jobs use tiled VAE decoding and
one clip per job; ComfyUI retains its normal model offloading. See QUALITY.txt.
"""
IMAGE_IDS = {'sdxl', 'image', 'flux3', 'edit', 'inpaint', 'control', 'reference'}
VIDEO = {
    # latent node, HQ width, height, frames, sampler steps
    'video': ('7', 768, 448, 49, 20),
    'wan14': ('7', 640, 384, 49, 30),
    'vace': ('7', 768, 432, 49, 30),
    'talk': ('7', 640, 384, 49, 24),
    'motion': ('7', 768, 432, 49, 10),
    'ltxlegacy': ('7', 768, 448, 49, 8),
    'ltx': ('8', 768, 448, 49, 8),
}


def options(ident):
    if ident in IMAGE_IDS:
        small, large = '512 × 512 · quick draft', '1024 × 1024 · finer detail'
    elif ident in VIDEO:
        _, w, h, frames, _ = VIDEO[ident]
        fps = 24 if ident in ('ltx', 'motion', 'video', 'vace') else 16
        small = '320 × 192 · about 1 second'
        large = f'{w} × {h} · about {frames/fps:.0f} seconds'
    elif ident == 'animal':
        small, large = '768 × 432 · first 17 frames', '768 × 432 · first 49 frames'
    elif ident == 'background':
        small, large = '512 × 512 · quick cutout', '1024 × 1024 · finer edges'
    elif ident == 'upscale':
        small, large = '1024 × 1024 · quick enlargement', '4096 × 4096 · detailed enlargement'
    else:
        small, large = 'First 9 frames · quick smoothing', 'Up to 49 frames · more accurate smoothing'
    return {'preview': {'label': 'Preview', 'description': small},
            'high': {'label': 'High quality', 'description': large + ' · takes longer'}}


def apply(g, ident, quality):
    high = quality == 'high'
    size = 1024 if high else 512
    if ident in IMAGE_IDS:
        for n in g.values():
            if n['class_type'] in ('EmptyLatentImage', 'EmptySD3LatentImage', 'EmptyFlux2LatentImage', 'Flux2Scheduler'):
                n['inputs'].update(width=size, height=size)
        if ident in ('sdxl', 'inpaint', 'control', 'reference'):
            g['5']['inputs'].update(steps=30 if high else 12, sampler_name='dpmpp_2m', scheduler='karras')
        elif ident == 'image':
            g['5']['inputs']['steps'] = 28 if high else 12
        elif ident == 'flux3':
            g['5']['inputs']['steps'] = 16 if high else 8
        # FLUX.2 Klein is distilled for four steps in both modes.
    if ident in VIDEO:
        latent, w, h, frames, steps = VIDEO[ident]
        if high:
            g[latent]['inputs'].update(width=w, height=h, length=frames)
        if ident in ('video', 'talk', 'vace'):
            g['8']['inputs']['steps'] = steps if high else 12
        if ident == 'wan14':
            total = steps if high else 12
            g['8']['inputs'].update(steps=total, end_at_step=total//2)
            g['14']['inputs'].update(steps=total, start_at_step=total//2, end_at_step=total)
        if ident == 'ltxlegacy':
            old = g['8']['inputs']
            g['quality_sigmas'] = {'class_type':'ManualSigmas','inputs':{
                'sigmas':'1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0'}}
            g['quality_sampler'] = {'class_type':'KSamplerSelect','inputs':{'sampler_name':'euler'}}
            g['8'] = {'class_type':'SamplerCustom','inputs':{
                'model':old['model'],'positive':old['positive'],'negative':old['negative'],
                'latent_image':old['latent_image'],'add_noise':True,'noise_seed':old['seed'],
                'cfg':1.0,'sampler':['quality_sampler',0],'sigmas':['quality_sigmas',0]}}
        if high:
            for n in g.values():
                if n['class_type'] == 'VAEDecode':
                    n['class_type'] = 'VAEDecodeTiled'
                    n['inputs'].update(tile_size=256, overlap=64, temporal_size=16, temporal_overlap=4)
            if ident == 'ltx':
                g['9']['inputs']['frames_number'] = frames
            if ident == 'motion':
                g['15']['inputs']['length'] = frames
            if ident == 'vace':
                g['13']['inputs']['length' if g['13']['class_type']=='ImageFromBatch' else 'amount'] = frames
                g['15']['inputs']['amount'] = frames
        if ident in ('motion', 'video', 'vace'):
            g['10']['inputs']['fps'] = 24.0
    if ident == 'animal':
        frames = 49 if high else 17
        g['1062']['inputs']['length'] = frames
        g['1300']['inputs']['length'] = frames
        g['1063']['inputs']['steps'] = 8 if high else 4
    if ident == 'background':
        g['3']['inputs'].update(width=size, height=size)
    if ident == 'interpolate':
        g['3']['inputs'].update(fast_mode=not high, ensemble=high)
        if 'studio_short' in g:
            g['studio_short']['inputs']['length'] = 49 if high else 9
    # Normalize image inputs explicitly for both samples and uploaded files.
    # Mask geometry uses the same square fit; never infer scale from the VAE.
    image_nodes = {'inpaint': ['8', '9'], 'edit': ['6'], 'control': ['8'],
                   'reference': ['10'], 'background': ['1'], 'upscale': ['1']}
    for source in image_nodes.get(ident, []):
        target = (1024 if high else 256) if ident == 'upscale' else size
        name = 'quality_scale_' + source
        # Rewire consumers before adding the scaler to avoid a self-reference.
        for node in g.values():
            for key, value in node['inputs'].items():
                if value == [source, 0]:
                    node['inputs'][key] = [name, 0]
        g[name] = {'class_type': 'ImageScale', 'inputs': {'image': [source, 0],
            'width': target, 'height': target, 'upscale_method': 'nearest-exact' if ident=='inpaint' and source=='9' else 'lanczos', 'crop': 'disabled'}}
    for node in g.values():
        if node['class_type'] in ('SaveImage', 'SaveVideo'):
            node['inputs']['filename_prefix'] = f'studio/{ident}-{quality}'
    return g
