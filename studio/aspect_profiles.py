"""Native generation canvases, bounded for the local 16 GB GPU.

These change the latent BEFORE sampling. No output crop, pad or resize is added.
Source-editing recipes keep their established geometry and mask coordinates.
"""
IMAGES = {'sdxl', 'image', 'flux3', 'reference'}
VIDEOS = {'video', 'wan14', 'ltxlegacy', 'ltx'}
SUPPORTED = IMAGES | VIDEOS


def validate(ident, aspect):
    if not isinstance(aspect, str) or aspect not in ('original', '9:16'):
        raise ValueError('Choose Original or Portrait 9:16 for generation')
    if aspect == '9:16' and ident not in SUPPORTED:
        raise ValueError('Native portrait generation is not enabled for this recipe. Use a supported generator or social export.')


def dimensions(ident, quality, seconds=0):
    if ident in IMAGES:
        return (720, 1280) if quality == 'high' else (432, 768)
    # The A14B experts use 16-pixel alignment. Bound attention cost as well
    # as VRAM: 576 x 1024 proved impractically slow on this local GPU.
    if ident == 'wan14' and quality == 'high' and not seconds:
        return 432, 768
    # 32-pixel alignment for Wan 5B and LTX; exact 9:16 at both sizes.
    # Longer clips trade spatial resolution for duration to stay bounded.
    return (576, 1024) if quality == 'high' and not seconds else (288, 512)


def options(ident):
    if ident not in SUPPORTED:
        return None
    result = {}
    for seconds in ((0, 5, 10) if ident in VIDEOS else (0,)):
        result[str(seconds)] = {}
        for quality, label in (('preview', 'Preview'), ('high', 'High quality')):
            w, h = dimensions(ident, quality, seconds)
            duration = f' · {seconds} seconds' if seconds else ' · short clip' if ident in VIDEOS else ''
            result[str(seconds)][quality] = {'label': label, 'width': w, 'height': h,
                'description': f'{w} × {h} · native 9:16{duration}' + (' · several minutes' if quality == 'high' and ident == 'wan14' else ' · takes longer' if quality == 'high' else '')}
    return result


def apply(g, ident, quality, seconds, aspect):
    validate(ident, aspect)
    if aspect == 'original':
        return g
    w, h = dimensions(ident, quality, seconds)
    if ident in IMAGES:
        for node in g.values():
            if node['class_type'] in ('EmptyLatentImage', 'EmptySD3LatentImage', 'EmptyFlux2LatentImage', 'Flux2Scheduler'):
                node['inputs'].update(width=w, height=h)
    else:
        g['8' if ident == 'ltx' else '7']['inputs'].update(width=w, height=h)
    for node in g.values():
        if node['class_type'] in ('SaveImage', 'SaveVideo'):
            node['inputs']['filename_prefix'] += '-portrait'
    return g
