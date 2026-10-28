/* Local, preview-only readability suggestions. Applying is a separate operation. */
(function(root){
 'use strict';
 const common=typeof module==='object'&&module.exports;
 const R=common?require('./caption-readability-model.js'):CaptionReadability;
 const P=common?require('./caption-phrase-model.js'):CaptionPhraseModel;
 const M=common?require('./caption-timeline-model.js'):CaptionTimelineModel;
 const copy=v=>structuredClone(v),ceil=n=>Math.ceil((n-1e-9)*1000)/1000,floor=n=>Math.floor((n+1e-9)*1000)/1000;
 const targetKey=limits=>JSON.stringify(Object.keys(R.defaults).map(k=>R.settings(limits)[k]));
 function suggest(cues,index,duration,animation='static',options={}){
  const limits=R.settings(options),notes=[],proposals=[];
  try{M.validate(cues,duration);}catch(error){return {proposals,notes:['Fix invalid caption text or timing before applying suggestions. '+error.message]};}
  if(!Number.isInteger(index)||!cues[index])throw Error('Choose a caption to review.');
  const cue=cues[index],before=R.analyze(cues,duration,animation,limits)[index],codes=new Set(before.issues.map(i=>i.code));
  const add=(type,title,explanation,next,count=1)=>{
   if(P.signature(next)===P.signature(cues))return;
   M.validate(next,duration);
   const after=R.analyze(next,duration,animation,limits).slice(index,index+count);
   proposals.push({type,title,explanation,index,input_signature:P.signature(cues),target_key:targetKey(limits),animation,duration,cues:copy(next),before:copy(cue),after:copy(next.slice(index,index+count)),before_checks:before,after_checks:after});
  };
  if(codes.has('length')||codes.has('hold')){
   const preset=limits.characters<=32?'short':limits.characters<=42?'balanced':'relaxed';
   try{
    const split=P.plan(cues,duration,{preset,indices:[index]});notes.push(...split.entries.flatMap(e=>e.warnings));
    if(split.changed&&split.entries[0].count>1)add('split','Split into phrases','Preserves every timed word. Splitting helps phrase length, but may leave speed warnings. Review all proposed phrases.',split.cues,split.entries[0].count);
    else if(split.changed)notes.push('These words already form one phrase. A range adjustment may help instead.');
    else notes.push('No safe phrase split is available. Review long individual words or shorten the text manually.');
   }catch(error){notes.push(error.message);}
  }
  if(animation!=='word'&&(codes.has('speed')||codes.has('brief'))){
   const nextStart=index+1<cues.length?cues[index+1].start:duration;
   const wanted=ceil(cue.start+Math.max(limits.minimum,before.characters/limits.cps));
   const ceiling=floor(Math.min(nextStart,duration,cue.end+1,cue.start+Math.min(28,limits.maximum)));
   const end=Math.min(wanted,ceiling);
   if(end>cue.end+1e-9){
    const next=copy(cues);next[index].end=end;
    add('extend','Extend caption display',`Uses available space after the caption, up to 1 second. Word timings stay unchanged. Review speech and scene cuts.${end<wanted?' Available space or the display limit prevents reaching the full reading target.':''}`,next);
   }else notes.push('No room to extend this caption within its neighbor, clip, and display limits. Shorten the text or adjust timing manually.');
  }
  if(codes.has('hold')){
   if(cue.timing==='estimated')notes.push('Align estimated words before trimming a long hold; their positions may not match speech.');
   else{
    const first=cue.words[0],last=cue.words[cue.words.length-1];
    const required=Math.max(limits.minimum,before.characters/limits.cps);
    let start=Math.max(cue.start,floor(first.start-.12));
    let end=Math.min(cue.end,ceil(Math.max(last.end+.12,start+required)));
    if(end-start<required)start=Math.max(cue.start,Math.min(start,floor(end-required)));
    if(end-start<cue.end-cue.start-1e-9){
     const next=copy(cues);Object.assign(next[index],{start,end});
     const after=R.analyze(next,duration,animation,limits)[index];
     if(!after.issues.some(i=>['brief','speed'].includes(i.code)))add('trim','Trim unused caption hold','Removes time outside the existing timed words, retaining up to 0.12s of context. Word timings stay unchanged. Review the proposed range against the audio.',next);
    }
   }
  }
  if(animation==='word'&&(codes.has('word-speed')||codes.has('flash'))){
   if(cue.timing==='estimated')notes.push('Align estimated word timings before suggesting longer word holds.');
   else{
    const next=copy(cues),words=next[index].words;let changed=0;
    for(let i=0;i<words.length;i++){
     const word=words[i],wanted=ceil(word.start+Math.max(.12,R.count(word.text)/limits.cps));
     const ceiling=floor(Math.min(i+1<words.length?words[i+1].start:cue.end,word.end+.5));
     const end=Math.min(wanted,ceiling);
     if(end>word.end+1e-9){word.end=end;changed++;}
    }
    if(changed){next[index].timing='manual';add('word-hold','Hold fast words longer','Extends word display ends into existing gaps, at most 0.5s per word. Starts and neighboring words stay in place. These manual holds can outlast speech; review playback. Running alignment later may replace them.',next);}
    else notes.push('No safe gaps are available for longer word holds. Review the waveform or try a full-caption animation.');
   }
  }
  if(!proposals.length&&!notes.length)notes.push('No automatic timing or split suggestion is available for these findings. Review text, ranges and word timing manually.');
  return {proposals,notes:[...new Set(notes)]};
 }
 function apply(cues,proposal,duration,animation,limits){
  if(P.signature(cues)!==proposal.input_signature||duration!==proposal.duration||animation!==proposal.animation||targetKey(limits)!==proposal.target_key)throw Error('Captions, animation or reading targets changed. Generate fresh suggestions before applying.');
  return copy(M.validate(proposal.cues,duration));
 }
 const api={suggest,apply,targetKey};if(common)module.exports=api;else root.CaptionFixModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
