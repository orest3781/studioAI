"""Local Whisper on an isolated CPU-only PyTorch runtime. No CTranslate2.

Only local safetensors/config files are loaded. This process has no network
connections and never installs packages, downloads models or uses the GPU.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import sys

FILES = ('model.safetensors','config.json','generation_config.json','preprocessor_config.json',
         'tokenizer.json','tokenizer_config.json','special_tokens_map.json','added_tokens.json',
         'vocab.json','merges.txt','normalizer.json')
METHOD = 'Whisper base · PyTorch CPU · offline'


def offline():
    os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',
        HF_HUB_DISABLE_PROGRESS_BARS='1',DO_NOT_TRACK='1',TOKENIZERS_PARALLELISM='false',
        CUDA_VISIBLE_DEVICES='')
    import socket
    def blocked(*args, **kwargs):
        raise OSError('Network access is disabled for local Studio transcription')
    socket.socket.connect = blocked
    socket.socket.connect_ex = blocked
    socket.create_connection = blocked


def verify_model(folder):
    folder = Path(folder)
    integrity = json.loads((folder/'studio-model-integrity.json').read_text(encoding='utf-8'))
    for name in FILES:
        if hashlib.sha256((folder/name).read_bytes()).hexdigest() != integrity['sha256'].get(name):
            raise ValueError('Local caption model integrity check failed: '+name)
    return integrity['revision']


def load_engine(folder):
    import torch
    from transformers import WhisperForConditionalGeneration, WhisperProcessor, pipeline
    if torch.version.cuda is not None:
        raise ValueError('Use the isolated CPU-only caption runtime from setup-captions.ps1')
    torch.set_num_threads(4)
    torch.set_num_interop_threads(1)
    model = WhisperForConditionalGeneration.from_pretrained(str(folder),local_files_only=True,
        use_safetensors=True,attn_implementation='eager').to('cpu').eval()
    generate = model.generate
    def generate_with_empty_speech_support(*args, **kwargs):
        result = generate(*args, **kwargs)
        # Transformers 5.20's word-timestamp pipeline concatenates each segment
        # list without handling Whisper's legitimate no-speech result. Normalize
        # only a verified empty result; inference errors must still surface.
        if (isinstance(result,dict) and result.get('segments')
                and all(not segment_list for segment_list in result['segments'])
                and result['sequences'].shape[-1] == 0):
            result = {key:value for key,value in result.items() if key != 'segments'}
            result['token_timestamps'] = result['sequences'].new_empty(result['sequences'].shape,dtype=torch.float32)
        return result
    model.generate = generate_with_empty_speech_support
    processor = WhisperProcessor.from_pretrained(str(folder),local_files_only=True)
    return pipeline('automatic-speech-recognition',model=model,tokenizer=processor.tokenizer,
        feature_extractor=processor.feature_extractor,device=-1)


def decode_audio(source, max_seconds=600):
    import av
    import numpy as np
    pieces, samples = [], 0
    resampler = av.AudioResampler(format='fltp',layout='mono',rate=16000)
    with av.open(str(source)) as container:
        if not container.streams.audio: raise ValueError('This file has no audio track. Add captions manually instead.')
        for frame in container.decode(audio=0):
            for converted in resampler.resample(frame):
                piece = converted.to_ndarray().reshape(-1)
                pieces.append(piece); samples += len(piece)
                if samples > (max_seconds+1)*16000: raise ValueError('Local transcription supports clips up to 10 minutes')
        for converted in resampler.resample(None): pieces.append(converted.to_ndarray().reshape(-1))
    if not pieces: raise ValueError('The audio track contains no decodable samples')
    audio = np.concatenate(pieces).astype(np.float32)
    if not np.isfinite(audio).all(): raise ValueError('The audio contains invalid samples')
    return audio


def captions_from_words(chunks, duration):
    """Preserve real word timing, silence gaps and Unicode while bounding cues."""
    cues, words, group = [], [], []
    previous = 0.0
    def finish():
        if group:
            cues.append({'start':group[0]['start'],'end':group[-1]['end'],
                         'text':''.join(w['raw'] for w in group).strip(),'timing':'speech',
                         'words':[{k:w[k] for k in ('start','end','text')} for w in group]})
            group.clear()
    for chunk in chunks:
        start, end = chunk.get('timestamp') or (None,None)
        raw = chunk.get('text','')
        if not isinstance(raw,str) or not raw.strip() or start is None or end is None: continue
        if not all(isinstance(v,(float,int)) and math.isfinite(v) for v in (start,end)): continue
        start, end = round(max(0,previous,float(start)),3), round(min(duration,float(end)),3)
        if end<=start: continue
        word = {'start':start,'end':end,'text':raw.strip()}
        words.append(word);previous=end
        if group and (len(''.join(w['raw'] for w in group))+len(raw)>42 or end-group[0]['start']>3.5 or start-group[-1]['end']>.8): finish()
        group.append(dict(word,raw=raw))
    finish()
    return cues, words


def transcribe(request):
    offline()
    import numpy as np
    from transformers.models.whisper.tokenization_whisper import LANGUAGES
    def progress(value):
        Path(request['progress']).write_text(str(min(.99,max(0,float(value)))),encoding='ascii')
    verify_model(request['model'])
    audio = decode_audio(request['source'])
    language = request['options']['language']
    # Digital silence must never become a model hallucination. Quiet speech is
    # otherwise left intact; Whisper's no-speech/log-probability checks handle it.
    chunks = []
    if float(np.max(np.abs(audio)))>1e-5:
        engine = load_engine(request['model']);progress(.1)
        def monitor(p): progress(.1+.85*float((p[:,0]/p[:,1].clamp(min=1)).mean()))
        kwargs = {'task':'transcribe','language':None if language=='auto' else language,
            'num_beams':5,'temperature':0.0,'condition_on_prev_tokens':False,
            'no_speech_threshold':.6,'logprob_threshold':-1.0,'compression_ratio_threshold':2.4,
            'monitor_progress':monitor}
        result = engine({'raw':audio,'sampling_rate':16000},return_timestamps='word',
                        return_language=True,generate_kwargs=kwargs)
        chunks = result.get('chunks',[])
        if language=='auto':
            detected = next((c.get('language') for c in chunks if c.get('language')),None)
            language = next((code for code,name in LANGUAGES.items() if name==detected),detected)
    elif language=='auto': language=None
    cues, words = captions_from_words(chunks,request['duration'])
    progress(1)
    return {'points':[],'cues':cues,'words':words,'language':language,
        'warnings':[] if cues else ['No speech detected. You can add captions manually.'],'method':METHOD}


if __name__=='__main__':
    offline()
    try:
        if sys.argv[1]=='--check':
            folder=Path(sys.argv[2]);revision=verify_model(folder)
            engine=load_engine(folder)
            import torch
            # Exercise feature extraction, tokenizer and CPU kernels, not just imports.
            import numpy as np
            features=engine.feature_extractor(np.zeros(16000,dtype=np.float32),sampling_rate=16000,return_tensors='pt')
            with torch.inference_mode(): engine.model.model.encoder(features.input_features)
            engine.tokenizer.encode('Local transcription check')
            print(json.dumps({'ready':True,'method':METHOD,'revision':revision,'torch':torch.__version__,'cpu_only':True}))
        else:
            request=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
            if request.get('task')=='align':
                from forced_alignment import align
                result=align(request)
            else:
                result=transcribe(request)
            Path(request['output']).write_text(json.dumps(result),encoding='utf-8')
    except Exception as error:
        print(str(error),file=sys.stderr)
        sys.exit(1)
