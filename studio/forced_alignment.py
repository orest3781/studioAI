"""Local supplied-text alignment using the installed Whisper attention heads.

Teacher-forced decoding, selected cross-attention heads and dynamic time
warping follow Whisper's word-alignment approach. No generated replacement
transcript is used. Heavy imports stay inside the isolated CPU worker.
References: openai/whisper timing.py; Transformers generation_whisper.py.
"""
import copy
import math
from pathlib import Path

METHOD = 'Whisper base · text-conditioned DTW · offline CPU'
MAX_CUE_SECONDS = 28


def validate_result(options, result, cues):
    """Never accept a worker result which rewrote text, ranges or other cues."""
    before=options['cues']
    if result.get('input_cues')!=before or len(cues)!=len(before):
        raise ValueError('Alignment input snapshot did not match')
    entries=result.get('entries',[])
    if [e['index'] for e in entries]!=options['indices']:
        raise ValueError('Alignment selection did not match')
    aligned={e['index'] for e in entries if e['state']=='aligned'}
    for i,(old,new) in enumerate(zip(before,cues)):
        if any(old[k]!=new[k] for k in ('start','end','text')):
            raise ValueError('Alignment changed caption text or range')
        if i not in aligned and old!=new:
            raise ValueError('Alignment changed a caption marked unchanged')
        if i in aligned and new['timing']!='aligned':
            raise ValueError('Alignment did not produce valid word timing')
    if result.get('aligned_count')!=len(aligned):
        raise ValueError('Alignment result count did not match')


def decode_alignment_audio(source, duration):
    """Decode onto source time, retaining delayed audio and timestamp gaps."""
    import av
    import numpy as np
    if not 0 < duration <= 600:
        raise ValueError('Local alignment supports clips up to 10 minutes')
    audio = np.zeros(math.ceil(duration*16000),dtype=np.float32)
    converter = av.AudioResampler(format='fltp',layout='mono',rate=16000)
    with av.open(str(source)) as container:
        if not container.streams.audio:
            raise ValueError('This file has no audio track. Manual caption timing remains available.')
        origin = float(container.start_time or 0)/av.time_base
        stream = container.streams.audio[0];stream.codec_context.thread_count=1
        fallback = float(stream.start_time*stream.time_base) if stream.start_time is not None else origin
        decoded = 0
        def consume(frame):
            nonlocal fallback,decoded
            t=float(frame.pts*frame.time_base) if frame.pts is not None else fallback
            samples=frame.to_ndarray().reshape(-1)
            if not np.isfinite(samples).all():raise ValueError('The audio contains invalid samples')
            offset=round((t-origin)*16000);fallback=t+len(samples)/16000
            a=max(0,offset);b=min(len(audio),offset+len(samples))
            if b>a:audio[a:b]=samples[a-offset:b-offset]
            decoded+=len(samples)
        for frame in container.decode(stream):
            for converted in converter.resample(frame):consume(converted)
            if fallback-origin>duration+1:break
        for converted in converter.resample(None):consume(converted)
        if not decoded:raise ValueError('The audio track has no decodable samples')
    return audio


def align_cue(engine, audio, cue, language):
    import numpy as np
    import torch
    from transformers.models.whisper.generation_whisper import _dynamic_time_warping, _median_filter
    from transformers.models.whisper.tokenization_whisper import _combine_tokens_into_words, LANGUAGES
    # Context on both sides helps words touching a cue boundary; outputs remain
    # bounded by the original caption interval.
    begin=max(0,round((cue['start']-.5)*16000));finish=min(len(audio),round((cue['end']+.5)*16000))
    segment=audio[begin:finish];offset=begin/16000
    speech=audio[round(cue['start']*16000):round(cue['end']*16000)]
    if not len(speech) or float(np.max(np.abs(speech)))<=1e-5:
        raise ValueError('No audible signal inside this caption range')
    if cue['end']-cue['start']>MAX_CUE_SECONDS:
        raise ValueError('Split captions longer than 28 seconds before alignment')
    features=engine.feature_extractor(segment,sampling_rate=16000,return_tensors='pt').input_features
    model,tokenizer=engine.model,engine.tokenizer
    if language=='auto':
        with torch.inference_mode():detected=model.detect_language(input_features=features)[0].item()
        language=tokenizer.decode([detected]).removeprefix('<|').removesuffix('|>')
    tokenizer.set_prefix_tokens(language=language,task='transcribe',predict_timestamps=False)
    prefix=tokenizer.prefix_tokens
    text_tokens=tokenizer.encode(' '+cue['text'],add_special_tokens=False)
    if not text_tokens or len(text_tokens)+len(prefix)+1>model.config.max_target_positions:
        raise ValueError('This caption has too many text tokens; split it and align again')
    # Never treat user-entered model control markers as executable decoder
    # instructions. They remain ordinary caption text outside this feature.
    if any(t>=tokenizer.eos_token_id for t in text_tokens):
        raise ValueError('Remove model control markers from caption text before alignment')
    decoder=torch.tensor([prefix+text_tokens+[tokenizer.eos_token_id]],dtype=torch.long)
    with torch.inference_mode():
        result=model(input_features=features,decoder_input_ids=decoder,output_attentions=True,use_cache=False)
        frames=max(1,min(1500,len(segment)//320))
        weights=torch.stack([result.cross_attentions[layer][0,head,:,:frames] for layer,head in model.generation_config.alignment_heads])
        weights=weights/weights.sum(dim=-1,keepdim=True).clamp_min(1e-12)
        weights=(weights-weights.mean(dim=-2,keepdim=True))/weights.std(dim=-2,keepdim=True,unbiased=False).clamp_min(1e-6)
        matrix=_median_filter(weights,model.config.median_filter_width).mean(dim=0)[len(prefix)-1:-1]
        if not torch.isfinite(matrix).all():raise ValueError('Alignment attention was not usable')
        text_indices,time_indices=_dynamic_time_warping(-matrix.cpu().double().numpy())
        jumps=np.pad(np.diff(text_indices),(1,0),constant_values=1).astype(bool)
        boundaries=time_indices[jumps]*.02+offset
        logits=result.logits[0,len(prefix)-1:len(prefix)-1+len(text_tokens),:tokenizer.eos_token_id]
        probabilities=logits.softmax(-1)[torch.arange(len(text_tokens)),text_tokens].cpu().numpy()
    words,_,indices=_combine_tokens_into_words(tokenizer,text_tokens,language=LANGUAGES.get(language,language))
    aligned=[];scores=[];cursor=0
    for word,tokens in zip(words,indices):
        literal=word.strip()
        if not literal:continue
        position=cue['text'].find(literal,cursor)
        if position<0 or cue['text'][cursor:position].strip():
            raise ValueError('Tokenizer could not preserve the edited caption text')
        cursor=position+len(literal)
        start=round(max(cue['start'],float(boundaries[min(tokens)])),3)
        end=round(min(cue['end'],float(boundaries[max(tokens)+1])),3)
        start,end=trim_silent_edges(audio,start,end)
        aligned.append({'text':literal,'start':start,'end':end})
        scores.append(float(np.exp(np.log(np.clip(probabilities[tokens],1e-9,1)).mean())))
    if cue['text'][cursor:].strip() or not aligned:
        raise ValueError('Tokenizer could not preserve all edited caption text')
    return aligned,scores,language


def trim_silent_edges(audio,start,end):
    """DTW can assign a pause to a word; trim only clear edge silence.

    A relative threshold, 80ms minimum silence and 20ms padding protect quiet
    consonants. This never invents a missing word or moves it outside its span.
    """
    import numpy as np
    segment=audio[max(0,round(start*16000)):max(0,round(end*16000))]
    count=len(segment)//160
    if count<8:return start,end
    rms=np.sqrt(np.mean(segment[:count*160].reshape(count,160)**2,axis=1))
    active=np.flatnonzero(rms>max(1e-5,float(rms.max())*.02))
    if not len(active):return start,end
    left,right=int(active[0])*.01,(int(active[-1])+1)*.01
    old_start=start
    if left>=.08:start=round(start+max(0,left-.02),3)
    if end-old_start-right>=.08:end=round(min(end,old_start+right+.02),3)
    return start,end


def align(request):
    from caption_worker import offline,verify_model,load_engine
    offline();verify_model(request['model'])
    options=request['options'];cues=copy.deepcopy(options['cues'])
    audio=decode_alignment_audio(request['source'],request['duration'])
    engine=load_engine(request['model']);entries=[];warnings=[]
    language=options['language'];indices=options['indices']
    for position,index in enumerate(indices):
        cue=cues[index]
        try:
            words,scores,detected=align_cue(engine,audio,cue,language)
            previous=cue['start']
            for word in words:
                if not previous<=word['start']<word['end']<=cue['end']:
                    raise ValueError('Some words could not be located reliably inside this caption range')
                previous=word['end']
            confidence=sum(scores)/len(scores)
            if confidence<.03 or sum(score<.01 for score in scores)>len(scores)/2:
                raise ValueError('Edited text did not match the audio reliably; review text and caption range')
            cue['words']=words;cue['timing']='aligned'
            entries.append({'index':index,'state':'aligned','language':detected,'confidence':round(confidence,3),
                            'words':words,'low_confidence_words':[w['text'] for w,p in zip(words,scores) if p<.1]})
        except ValueError as error:
            message=str(error);warnings.append(f'Caption {index+1}: {message}. Existing timing kept.')
            entries.append({'index':index,'state':'unchanged','reason':message})
        Path(request['progress']).write_text(str((position+1)/len(indices)),encoding='ascii')
    return {'points':[],'cues':cues,'entries':entries,'input_cues':options['cues'],
            'warnings':warnings,'method':METHOD,'aligned_count':sum(e['state']=='aligned' for e in entries),
            'unchanged_count':sum(e['state']=='unchanged' for e in entries)}
