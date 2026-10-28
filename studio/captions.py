"""Local caption styles, editable word timing, and deterministic ASS rendering."""
import math
import re

DEFAULT_STYLE = {'position':'bottom','size':5,'margin':12,'font':'Arial','bold':True,
                 'color':'#FFFFFF','active_color':'#D6F77A','outline_color':'#101010',
                 'outline':2,'animation':'static'}
FONTS = ('Arial','Segoe UI','Verdana','Georgia')
BUILTINS = [
    {'id':'classic','name':'Classic','style':dict(DEFAULT_STYLE)},
    {'id':'spotlight','name':'Spotlight','style':dict(DEFAULT_STYLE,animation='highlight',size=6)},
    {'id':'word-pop','name':'Word pop','style':dict(DEFAULT_STYLE,animation='word',size=8,active_color='#FFE36E')},
    {'id':'editorial','name':'Editorial','style':dict(DEFAULT_STYLE,font='Georgia',bold=False,color='#FFF0D6',size=5.5)},
]


def finite(value, low, high, label):
    if type(value) not in (int,float) or not math.isfinite(value) or not low<=value<=high:
        raise ValueError(f'{label} must be between {low} and {high}')
    return round(value,3)


def validate_style(value):
    if not isinstance(value,dict): raise ValueError('Expected caption style')
    style = {**DEFAULT_STYLE,**{k:v for k,v in value.items() if k in DEFAULT_STYLE}}
    for key, choices in [('position',('bottom','middle','top')),('animation',('static','highlight','word')),('font',FONTS)]:
        if style[key] not in choices: raise ValueError('Choose a supported caption '+key)
    if type(style['bold']) is not bool: raise ValueError('Caption bold must be true or false')
    for key in ('color','active_color','outline_color'):
        if not isinstance(style[key],str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',style[key]): raise ValueError('Choose a six-digit caption color')
        style[key] = style[key].upper()
    for key,low,high in [('size',2,9),('margin',3,30),('outline',0,6)]:
        style[key] = finite(style[key],low,high,'Caption '+key)
    return style


def word_spans(text, words):
    """Map words onto literal caption text, preserving punctuation and whitespace."""
    spans=[];cursor=0
    for word in words:
        start=text.find(word['text'],cursor)
        if start<0 or text[cursor:start].strip(): return None
        end=start+len(word['text']);spans.append((start,end));cursor=end
    return spans if not text[cursor:].strip() else None


def estimate_words(cue):
    tokens=re.findall(r'\S+',cue['text'])
    if cue['end']-cue['start'] < len(tokens)*.001: tokens=[cue['text']]
    count=len(tokens)
    return [{'text':text,'start':round(cue['start']+(cue['end']-cue['start'])*i/count,3),
             'end':round(cue['start']+(cue['end']-cue['start'])*(i+1)/count,3)} for i,text in enumerate(tokens)]


def normalize_words(cue, words=None, timing='estimated'):
    if words is None: return estimate_words(cue),'estimated'
    if not isinstance(words,list) or len(words)>300: raise ValueError('Use at most 300 words per caption')
    clean=[]
    for word in words:
        if not isinstance(word,dict) or not isinstance(word.get('text'),str) or not word['text'].strip():
            raise ValueError('Each timed word needs text')
        clean.append({'text':word['text'].strip(),'start':finite(word.get('start'),0,86400,'Word start'),
                      'end':finite(word.get('end'),0,86400,'Word end')})
    # A rewritten sentence must not silently retain timestamps for different words.
    if not clean or word_spans(cue['text'],clean) is None: return estimate_words(cue),'estimated'
    previous=cue['start']
    for word in clean:
        if not previous<=word['start']<word['end']<=cue['end']:
            raise ValueError('Word times must increase, not overlap, and stay within their caption')
        previous=word['end']
    if timing not in ('speech','estimated','manual','aligned'): raise ValueError('Invalid word timing source')
    return clean,timing


def ass_escape(text):
    return text.replace('\\','＼').replace('{','｛').replace('}','｝').replace('\n',r'\N')


def ass_color(color):
    return '&H'+color[5:7]+color[3:5]+color[1:3]+'&'


def caption_text(cue,style,active):
    if style['animation']=='word':
        return '' if active is None else r'{\c'+ass_color(style['active_color'])+'}'+ass_escape(cue['words'][active]['text'])
    if style['animation']=='static' or active is None: return ass_escape(cue['text'])
    a,b=word_spans(cue['text'],cue['words'])[active]
    return (ass_escape(cue['text'][:a])+r'{\c'+ass_color(style['active_color'])+'}'+ass_escape(cue['text'][a:b])
            +r'{\c'+ass_color(style['color'])+'}'+ass_escape(cue['text'][b:]))


def ass_document(cues, style, width, height, preview_time=None):
    style=validate_style(style)
    size=max(12,round(min(width,height)*style['size']/100))
    alignment={'bottom':2,'middle':5,'top':8}[style['position']]
    margin=round(height*style['margin']/100)
    color=lambda c: ass_color(c).replace('&H','&H00').rstrip('&')
    header=f'''[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
ScaledBorderAndShadow: yes
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{style['font']},{size},{color(style['color'])},{color(style['color'])},{color(style['outline_color'])},&H80000000,{-1 if style['bold'] else 0},0,0,0,100,100,0,0,1,{max(2,size/15)*style['outline']/2:.1f},1,{alignment},{round(width*.07)},{round(width*.07)},{margin},1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
    def stamp(t):
        cs=round(t*100)
        return f'{cs//360000}:{cs//6000%60:02}:{cs//100%60:02}.{cs%100:02}'
    def line(start,end,text):
        if text and round(end*100)>round(start*100):
            return f'Dialogue: 0,{stamp(start)},{stamp(end)},Default,,0,0,0,,{text}\n'
        return ''
    for raw in cues:
        if preview_time is not None and not raw['start']<=preview_time<raw['end']: continue
        cue=dict(raw);cue['words'],_=normalize_words(cue,raw.get('words'),raw.get('timing','estimated'))
        def active_at(t): return next((i for i,w in enumerate(cue['words']) if w['start']<=t<w['end']),None)
        if preview_time is not None:
            active=active_at(preview_time);text=caption_text(cue,style,active)
            if style['animation']=='word' and active is not None:
                word=cue['words'][active];ramp=min(.12,(word['end']-word['start'])/2)
                scale=100+10*max(0,1-(preview_time-word['start'])/ramp)
                text=f'{{\\fscx{scale:.2f}\\fscy{scale:.2f}}}'+text
            header+=line(0,1,text)
        elif style['animation']=='static': header+=line(cue['start'],cue['end'],ass_escape(cue['text']))
        elif style['animation']=='word':
            for i,w in enumerate(cue['words']):
                ramp=max(1,round(min(.12,(w['end']-w['start'])/2)*1000))
                effect=f'{{\\fscx110\\fscy110\\t(0,{ramp},\\fscx100\\fscy100)}}'
                header+=line(w['start'],w['end'],effect+caption_text(cue,style,i))
        else:
            boundaries=sorted({cue['start'],cue['end'],*[w[k] for w in cue['words'] for k in ('start','end')]})
            for a,b in zip(boundaries,boundaries[1:]): header+=line(a,b,caption_text(cue,style,active_at((a+b)/2)))
    return header
