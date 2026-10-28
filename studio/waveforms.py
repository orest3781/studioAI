"""Bounded, local audio peak extraction; no audio copies or inference jobs."""
import hashlib
import json
import math
import threading
import time

import av
import numpy as np

VERSION = 1
BIN_SECONDS = .005
MAX_DURATION = 600


def extract_waveform(path, duration):
    if not math.isfinite(duration) or not 0 < duration <= MAX_DURATION:
        raise ValueError('Waveforms support clips up to 10 minutes. Caption editing is still available.')
    peaks = np.zeros(math.ceil(duration / BIN_SECONDS), dtype=np.float32)
    result = {'version': VERSION, 'duration': duration, 'bin_seconds': BIN_SECONDS,
              'state': 'no_audio', 'peaks': [], 'peak': 0, 'channels': 0}
    deadline = time.monotonic() + 30
    with av.open(str(path)) as container:
        if not container.streams.audio:
            return result
        stream = container.streams.audio[0]
        stream.codec_context.thread_count = 1
        channels = len(stream.codec_context.layout.channels)
        if channels > 8:
            raise ValueError('Waveforms support up to 8 audio channels.')
        # Keep the audio/video offset. Subtracting the first audio timestamp
        # would incorrectly pull delayed speech forward on the source timeline.
        origin = float(container.start_time or 0) / av.time_base
        fallback = float(stream.start_time * stream.time_base) if stream.start_time is not None else origin
        converter = av.AudioResampler(format='fltp')
        decoded = 0

        def consume(frame):
            nonlocal fallback, decoded
            start = float(frame.pts * frame.time_base) if frame.pts is not None else fallback
            rate = frame.sample_rate
            fallback = start + frame.samples / rate
            samples = np.nan_to_num(np.abs(frame.to_ndarray()), nan=0, posinf=1, neginf=1).max(axis=0)
            # Maximum across channels keeps anti-phase stereo audible in the
            # display instead of cancelling it in a mono downmix.
            indexes = np.floor(((start-origin) + np.arange(len(samples))/rate) / BIN_SECONDS + 1e-7).astype(np.int64)
            valid = (indexes >= 0) & (indexes < len(peaks))
            np.maximum.at(peaks, indexes[valid], samples[valid])
            decoded += len(samples)

        for frame in container.decode(stream):
            if time.monotonic() > deadline:
                raise ValueError('Waveform extraction took too long. Retry with a shorter clip.')
            for converted in converter.resample(frame):
                consume(converted)
            if fallback-origin > duration + 1:
                break
        for converted in converter.resample(None):
            consume(converted)
        if not decoded:
            raise ValueError('The audio track could not be decoded. Caption editing is still available.')
        quantized = np.rint(np.clip(peaks, 0, 1)*32767).astype(np.uint16)
        maximum = int(quantized.max())
        result.update(state='ready' if maximum else 'silent', peaks=quantized.tolist(),
                      peak=maximum, channels=channels)
        return result


class WaveformManager:
    def __init__(self, workspace):
        self.workspace = workspace
        self.folder = workspace.data/'waveforms'
        self.folder.mkdir(exist_ok=True)
        # Independent of the GPU, caption-analysis and export queue locks.
        self.lock = threading.Lock()

    def get(self, ident):
        asset = self.workspace.asset(ident)
        if asset['kind'] not in ('video', 'audio'):
            raise ValueError('Choose a video or audio asset for a waveform.')
        source = self.workspace.path_for(asset)
        duration = float(asset['metadata'].get('duration', 0))
        stat = source.stat()
        signature = hashlib.sha256(f'{VERSION}:{source}:{stat.st_size}:{stat.st_mtime_ns}:{duration}'.encode()).hexdigest()
        # Never use an unchecked request ID as a cache path.
        cached = self.folder/(hashlib.sha256(ident.encode()).hexdigest()+'.json')
        if not self.lock.acquire(timeout=35):
            raise ValueError('Another waveform is being prepared. Retry shortly.')
        try:
            if cached.exists():
                try:
                    value = json.loads(cached.read_text(encoding='utf-8'))
                    if value['signature'] == signature:
                        return value['waveform']
                except (ValueError, KeyError, TypeError, OSError):
                    pass
            try:
                waveform = extract_waveform(source, duration)
            except av.error.FFmpegError as error:
                raise ValueError('This audio could not be decoded for a waveform. Caption editing is still available.') from error
            latest = source.stat()
            if (stat.st_size, stat.st_mtime_ns) != (latest.st_size, latest.st_mtime_ns):
                raise ValueError('The source changed while reading audio. Reopen it and retry.')
            temp = cached.with_suffix('.tmp')
            temp.write_text(json.dumps({'signature': signature, 'waveform': waveform}, separators=(',', ':')), encoding='utf-8')
            temp.replace(cached)
            return waveform
        finally:
            self.lock.release()
