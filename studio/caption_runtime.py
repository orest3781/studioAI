"""Cached real runtime health, without importing ML packages into the server."""
import json
import os
from pathlib import Path
import subprocess
import threading
import time

_cache = {}
_lock = threading.RLock()
WORKER = Path(__file__).with_name('caption_worker.py')


def _key(python, model):
    return str(Path(python).resolve()),str(Path(model).resolve())


def failure_message(error):
    if 'Application Control' in error or 'signing level' in error:
        return 'Windows blocked the local caption runtime. Security settings were not changed. You can still edit captions manually.'
    return 'Local caption runtime is unavailable. Recheck it, or run studio/setup-captions.ps1. You can still edit captions manually.'


def record_failure(python, model, error):
    with _lock:
        _cache[_key(python,model)] = (time.monotonic(),{'ready':False,'error':failure_message(error),'details':str(error)[-1500:]})


def check(python, model, force=False):
    key = _key(python,model)
    with _lock:
        previous = _cache.get(key)
        if previous and not force and time.monotonic()-previous[0]<300:
            return dict(previous[1])
        if not Path(python).is_file() or not (Path(model)/'studio-model-integrity.json').is_file():
            result={'ready':False,'error':'Local caption runtime or model is missing. Run studio/setup-captions.ps1. Manual captions remain available.'}
        else:
            env=dict(os.environ,HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',DO_NOT_TRACK='1',CUDA_VISIBLE_DEVICES='')
            try:
                probe=subprocess.run([str(python),str(WORKER),'--check',str(model)],capture_output=True,text=True,
                    encoding='utf-8',errors='replace',timeout=60,env=env,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
                if probe.returncode: raise RuntimeError(probe.stderr[-1500:] or 'Caption self-check failed')
                result=json.loads(probe.stdout.strip().splitlines()[-1])
                if not isinstance(result,dict) or result.get('ready') is not True or result.get('cpu_only') is not True:
                    raise ValueError('Caption worker did not verify CPU-only execution')
            except (OSError,ValueError,RuntimeError,subprocess.TimeoutExpired,IndexError) as error:
                result={'ready':False,'error':failure_message(str(error)),'details':str(error)[-1500:]}
        _cache[key]=(time.monotonic(),result)
        return dict(result)
