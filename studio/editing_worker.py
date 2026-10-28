"""One local analysis per process; caption dependencies never enter Studio's venv."""
import json
import os
from pathlib import Path
import sys
from studio_paths import RUNTIME


def disable_network():
    import socket
    def blocked(*args, **kwargs):
        raise OSError('Network access is disabled for local Studio analysis')
    socket.socket.connect = blocked
    socket.socket.connect_ex = blocked
    socket.create_connection = blocked


def report(request, value):
    Path(request['progress']).write_text(str(value),encoding='ascii')


def track(request):
    import cv2
    import numpy as np
    cv2.setNumThreads(2)
    cap = cv2.VideoCapture(request['source'])
    try:
        ok, frame = cap.read()
        if not ok: raise ValueError('Could not decode the first frame')
        h,w = frame.shape[:2]
        selected = request['options'].get('box')
        if selected:
            box = tuple(round(v*dimension/100) for v,dimension in zip(selected,(w,h,w,h)))
        else:
            cascade = RUNTIME/'models'/'haarcascade_frontalface_default.xml'
            detector = cv2.CascadeClassifier(str(cascade))
            if detector.empty(): raise ValueError('Local face detector is unavailable. Draw a subject box instead.')
            faces = detector.detectMultiScale(cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY),scaleFactor=1.1,minNeighbors=5,minSize=(24,24))
            if not len(faces): raise ValueError('No face found in the first frame. Draw a box around the subject and track again.')
            box = tuple(int(x) for x in max(faces,key=lambda b:b[2]*b[3]))
        tracker = cv2.TrackerCSRT_create()
        tracker.init(frame,box)
        samples, lost = [], []
        total = max(1,int(cap.get(cv2.CAP_PROP_FRAME_COUNT)))
        index = 0
        while ok:
            if index:
                found, tracked = tracker.update(frame)
                if found: box = tracked
                else: lost.append(round(index/10,2))
            x,y,bw,bh = box
            samples.append([min(request['duration'],index/10), max(0,min(100,(x+bw/2)/w*100)),max(0,min(100,(y+bh/2)/h*100))])
            index += 1
            if index%5==0: report(request,index/total)
            ok,frame = cap.read()
        # Symmetric short smoothing reduces tracker jitter without introducing camera lag.
        values = np.array(samples)
        for axis in (1,2): values[:,axis] = np.convolve(np.pad(values[:,axis],(2,2),mode='edge'),np.ones(5)/5,mode='valid')
        # Keep half-second keyframes, plus both endpoints; user can correct any point.
        indices = sorted(set([0,len(values)-1,*range(0,len(values),5)]))
        points = [{'t':round(float(values[i,0]),3),'x':round(float(values[i,1]),3),'y':round(float(values[i,2]),3)} for i in indices]
        warnings = [f'Tracker lost the subject in {len(lost)} of {len(samples)} sampled frames. It held the last position; review and correct the crop path.'] if lost else []
        return {'points':points,'cues':[], 'warnings':warnings,'lost_times':lost[:200],
                'method':'Selected subject · CSRT' if selected else 'Largest face · CSRT', 'samples':len(samples)}
    finally: cap.release()


def transcribe(request):
    # Compatibility entry point. Use the isolated CPU caption interpreter.
    from caption_worker import transcribe as run_local_caption
    return run_local_caption(request)


if __name__=='__main__':
    request = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    disable_network()
    try:
        result = track(request) if request['task']=='track' else transcribe(request)
        Path(request['output']).write_text(json.dumps(result),encoding='utf-8')
    except Exception as error:
        print(str(error),file=sys.stderr)
        sys.exit(1)
