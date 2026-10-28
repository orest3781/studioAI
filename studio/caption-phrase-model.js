/* Deterministic, entirely local phrase planning. Shared by UI and tests. */
(function(root){
 'use strict';
 const M=typeof module==='object'&&module.exports?require('./caption-timeline-model.js'):CaptionTimelineModel;
 const presets={short:{words:4,characters:32,seconds:3},balanced:{words:6,characters:42,seconds:4},relaxed:{words:8,characters:56,seconds:6}};
 const copy=v=>structuredClone(v),round=n=>Math.round(n*1000)/1000;
 const signature=cues=>JSON.stringify(cues.map(c=>({start:c.start,end:c.end,text:c.text,timing:c.timing,words:c.words.map(w=>({text:w.text,start:w.start,end:w.end}))})));
 function positions(cue){let cursor=0;return cue.words.map(w=>{const start=cue.text.indexOf(w.text,cursor);cursor=start+w.text.length;return [start,cursor];});}
 function sentence(text){return /[.!?…。！？][”’"')\]}]*$/u.test(text)&&!/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)|\b[A-Z])\.$/u.test(text);}
 function splitCue(cue,limits){
  const words=cue.words,n=words.length,at=positions(cue);
  if(words.some(w=>round(w.end-w.start)>28))return {cues:[copy(cue)],warnings:['A timed word exceeds 28 seconds. Fix its timing or split it manually before alignment.'],changed:false};
  if(n<=limits.words&&Array.from(cue.text).length<=limits.characters&&round(cue.end-cue.start)<=limits.seconds)return {cues:[copy(cue)],warnings:[],changed:false};
  const text=(i,j)=>cue.text.slice(i?at[i][0]:0,j===n-1?cue.text.length:at[j][1]).trim();
  // Dynamic programming balances phrases globally, avoiding a tiny last phrase.
  // A long real pause is a mandatory boundary; no speech or punctuation is lost.
  const cost=Array(n+1).fill(Infinity),next=Array(n).fill(-1);cost[n]=0;
  for(let i=n-1;i>=0;i--)for(let j=i;j<Math.min(n,i+limits.words);j++){
   if(j>i&&words[j].start-words[j-1].end>=.65)break;
   const count=j-i+1,phrase=text(i,j),seconds=round(words[j].end-words[i].start),chars=Array.from(phrase).length;
   if(j>i&&(seconds>limits.seconds||chars>limits.characters))break;
   const pause=j+1<n?words[j+1].start-words[j].end:0;
   let penalty=1+Math.pow(1-count/limits.words,2)*.7;
   if(j<n-1){
    penalty+=sentence(phrase)||pause>=.35?0:/[,;:，；：、][”’"')\]}]*$/u.test(phrase)?.25:1.1;
    if(/\b(?:a|an|the|to|of|and|or|with|in|on|for)$/iu.test(phrase))penalty+=.7;
   }
   if(count===1&&!sentence(phrase))penalty+=.8;
   const value=penalty+cost[j+1];if(value<cost[i]){cost[i]=value;next[i]=j+1;}
  }
  const result=[];let i=0;
  while(i<n){
   const end=next[i];if(end<=i)throw Error('Could not find safe phrase boundaries. Review word timings.');
   const j=end-1;
   // Keep modest audio context for forced alignment; split gaps at their midpoint
   // and leave long pauses blank. Never truncate or re-estimate a timed word.
   const lower=i?M.clamp(round((words[i-1].end+words[i].start)/2),words[i-1].end,words[i].start):cue.start;
   const upper=j+1<n?M.clamp(round((words[j].end+words[j+1].start)/2),words[j].end,words[j+1].start):cue.end;
   const start=Math.max(cue.start,lower,Math.min(words[i].start,round(words[i].start-.12)));
   const finish=Math.min(cue.end,upper,Math.max(words[j].end,round(words[j].end+.12)));
   let item={...copy(cue),start,end:finish,text:text(i,j),words:copy(words.slice(i,end))};
   // A single unusually long word can exceed the reading preference, but its
   // source range must still fit the aligner's hard 28-second window.
   if(round(item.end-item.start)>28)item={...item,start:words[i].start,end:words[j].end};
   result.push(item);i=end;
  }
  const warnings=[];
  if(result.some(c=>c.words.length===1&&(Array.from(c.text).length>limits.characters||round(c.end-c.start)>limits.seconds+.24)))warnings.push('A single word exceeds the reading preference; its text and timing were kept intact.');
  if(cue.timing==='estimated')warnings.push('Timing is estimated. Align and listen to these phrases; adjust ranges if a word falls outside them.');
  return {cues:result,warnings,changed:signature([cue])!==signature(result)};
 }
 function plan(cues,duration,{preset='balanced',indices=cues.map((_,i)=>i)}={}){
  M.validate(cues,duration);const limits=presets[preset];if(!limits)throw Error('Choose a phrase length.');
  if(!Array.isArray(indices)||!indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=cues.length)||new Set(indices).size!==indices.length)throw Error('Select captions to split.');
  const selected=new Set(indices),result=[],entries=[];
  for(let i=0;i<cues.length;i++){
   const item=selected.has(i)?splitCue(cues[i],limits):{cues:[copy(cues[i])],warnings:[],changed:false};
   if(selected.has(i))entries.push({index:i,offset:result.length,count:item.cues.length,changed:item.changed,warnings:item.warnings});
   result.push(...item.cues);
  }
  if(result.length>1000)throw Error('Splitting would exceed 1000 captions. Choose fewer captions or longer phrases.');
  M.validate(result,duration);
  return {input_signature:signature(cues),preset,cues:result,entries,changed:entries.filter(e=>e.changed).length,added:result.length-cues.length};
 }
 function apply(cues,preview,duration){
  if(signature(cues)!==preview.input_signature)throw Error('Captions changed since this preview. Preview phrase splits again.');
  return copy(M.validate(preview.cues,duration));
 }
 const api={plan,apply,signature,presets};if(typeof module==='object'&&module.exports)module.exports=api;else root.CaptionPhraseModel=api;
})(typeof globalThis!=='undefined'?globalThis:this);
