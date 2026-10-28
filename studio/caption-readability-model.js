/* Advisory editing targets, not a platform compliance validator. No I/O. */
(function(root){
 'use strict';
 const defaults={characters:42,cps:20,minimum:.8,maximum:6};
 const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
 const count=text=>Array.from(segmenter.segment(text.trim().replace(/\s+/gu,' '))).length;
 function settings(value={}){
  const result={...defaults,...value};
  for(const [key,low,high] of [['characters',10,300],['cps',5,60],['minimum',.1,3],['maximum',1,28]]){
   if(typeof result[key]!=='number'||!Number.isFinite(result[key])||result[key]<low||result[key]>high)throw Error('Choose valid readability targets.');
  }
  if(result.minimum>result.maximum)throw Error('Minimum display time must not exceed maximum.');
  return result;
 }
 function analyze(cues,duration,animation='static',options={}){
  const limits=settings(options);
  return cues.map((cue,index)=>{
   const issues=[],add=(code,message)=>issues.push({code,message});
   const text=typeof cue.text==='string'?cue.text:'',characters=count(text),seconds=cue.end-cue.start;
   const valid=[cue.start,cue.end,duration].every(Number.isFinite)&&cue.start>=0&&seconds>0&&cue.end<=duration;
   if(!characters)add('empty','Add caption text.');
   if(!valid)add('timing','Fix the caption range before checking reading speed.');
   if(index&&Number.isFinite(cue.start)&&Number.isFinite(cues[index-1].end)&&cue.start<cues[index-1].end)add('overlap','This caption overlaps the previous caption.');
   if(characters>limits.characters)add('length',`${characters} characters; target ${limits.characters}. ${animation==='word'?'Long phrase in SRT/VTT.':'Try shorter phrases or simpler wording.'}`);
   const cps=valid?characters/seconds:null;
   if(valid&&seconds>limits.maximum+1e-9)add('hold',`${seconds.toFixed(2)}s ${animation==='word'?'caption range in SRT/VTT':'on screen'}; target at most ${limits.maximum}s. Check for pauses or split into phrases.`);
   if(valid&&animation!=='word'){
    if(seconds<limits.minimum-1e-9)add('brief',`${seconds.toFixed(2)}s on screen; target at least ${limits.minimum}s.`);
    if(cps>limits.cps+1e-9)add('speed',`${cps.toFixed(1)} characters/s; target ${limits.cps}. Shorten text or extend the range if speech allows. Splitting alone may not slow it down.`);
   }
   let fastest=null,flashes=0;
   if(animation==='word'&&valid){
    let previous=cue.start,cursor=0,usable=Array.isArray(cue.words)&&cue.words.length>0;
    for(const word of Array.isArray(cue.words)?cue.words:[]){
     if(!word||typeof word!=='object'){usable=false;break;}
     const literal=typeof word.text==='string'?word.text:'',at=text.indexOf(literal,cursor),length=word.end-word.start;
     if(!literal.trim()||at<0||text.slice(cursor,at).trim()||![word.start,word.end].every(Number.isFinite)||word.start<previous||length<=0||word.end>cue.end){usable=false;break;}
     cursor=at+literal.length;previous=word.end;
     const rate=count(literal)/length;
     if(!fastest||rate>fastest.cps)fastest={text:literal,cps:rate,start:word.start,seconds:length};
     if(length<.12-1e-9)flashes++;
    }
    if(text.slice(cursor).trim())usable=false;
    if(!usable){fastest=null;flashes=0;add('words','Review missing or invalid word timings before checking word-pop speed.');}
    else{
     if(fastest.cps>limits.cps+1e-9)add('word-speed',`“${fastest.text}” appears for ${fastest.seconds.toFixed(3)}s (${fastest.cps.toFixed(1)} characters/s; target ${limits.cps}). Adjust word timing or try a full-caption animation.`);
     if(flashes)add('flash',`${flashes} word${flashes===1?'':'s'} shown for less than 0.12s. Review word timing or use full-caption animation.`);
    }
    if(cue.timing==='estimated')add('estimated','Word timings are estimated. Align and review before judging word-pop speed.');
   }
   return {index,text,characters,seconds:valid?seconds:null,cps,fastest,issues};
  });
 }
 const api={defaults,settings,count,analyze};if(typeof module==='object'&&module.exports)module.exports=api;else root.CaptionReadability=api;
})(typeof globalThis!=='undefined'?globalThis:this);
