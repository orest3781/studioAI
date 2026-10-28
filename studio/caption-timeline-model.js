'use strict';
// Pure caption operations shared by the browser and local Node acceptance tests.
const CaptionTimelineModel=(()=>{
 const copy=value=>structuredClone(value),round=value=>Math.round(value*1000)/1000;
 const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
 function spans(cue){let cursor=0;const result=[];for(const word of cue.words){const a=cue.text.indexOf(word.text,cursor);if(a<0||cue.text.slice(cursor,a).trim())throw Error('Word text does not match its caption. Review the text first.');result.push([a,a+word.text.length]);cursor=a+word.text.length;}if(cue.text.slice(cursor).trim())throw Error('Word text does not match its caption.');return result;}
 function validate(cues,duration){
  if(!Array.isArray(cues)||cues.length>1000||!Number.isFinite(duration)||duration<=0)throw Error('Choose a valid clip and caption list.');
  let previous=0,total=0;
  for(const cue of cues){
   if(![cue.start,cue.end].every(Number.isFinite)||cue.start<previous||cue.end<=cue.start||cue.end>duration)throw Error('Fix overlapping or out-of-range caption times first.');
   if(typeof cue.text!=='string'||!cue.text.trim()||cue.text.length>300)throw Error('Captions need 1–300 characters.');
   if(!Array.isArray(cue.words)||!cue.words.length||cue.words.length>300)throw Error('This caption needs word timings. Save or reset its estimated timing first.');
   let end=cue.start;
   for(const word of cue.words){if(typeof word.text!=='string'||!word.text.trim()||![word.start,word.end].every(Number.isFinite)||word.start<end||word.end<=word.start||word.end>cue.end)throw Error('Fix invalid word timings before using the timeline.');end=word.end;}
   spans(cue);previous=cue.end;total+=cue.words.length;
  }
  if(total>20000)throw Error('Use at most 20000 timed words.');return cues;
 }
 function bounds(cue,index,edge){
  const w=cue.words[index];if(!w)throw Error('Select a word first.');
  const low=index?cue.words[index-1].end:cue.start,high=index+1<cue.words.length?cue.words[index+1].start:cue.end;
  const minimum=Math.min(.01,round(w.end-w.start));
  if(edge==='start')return [low,round(w.end-minimum)];
  if(edge==='end')return [round(w.start+minimum),high];
  if(edge==='move')return [low,round(high-(w.end-w.start))];
  throw Error('Choose a word boundary.');
 }
 function adjust(cues,ci,wi,edge,value,duration){
  validate(cues,duration);if(!Number.isFinite(value))throw Error('Choose a finite word time.');
  const result=copy(cues),cue=result[ci];if(!cue)throw Error('Select a caption first.');const w=cue.words[wi],range=bounds(cue,wi,edge),next=round(clamp(value,...range));
  if(edge==='move'){const length=round(w.end-w.start);w.start=next;w.end=round(next+length);}else w[edge]=next;
  if(w.start!==cues[ci].words[wi].start||w.end!==cues[ci].words[wi].end)cue.timing='manual';return validate(result,duration);
 }
 function split(cues,ci,wi,duration){
  validate(cues,duration);const cue=cues[ci];if(!cue||!Number.isInteger(wi)||wi<0||wi>=cue.words.length-1)throw Error('Select a word with another word after it.');
  if(cues.length>=1000)throw Error('Use at most 1000 captions.');
  const positions=spans(cue),cut=positions[wi][1],time=round((cue.words[wi].end+cue.words[wi+1].start)/2);
  const left={...copy(cue),end:time,text:cue.text.slice(0,cut).trim(),words:copy(cue.words.slice(0,wi+1))};
  const right={...copy(cue),start:time,text:cue.text.slice(cut).trim(),words:copy(cue.words.slice(wi+1))};
  const result=copy(cues);result.splice(ci,1,left,right);return validate(result,duration);
 }
 function splitWordAt(cue,time){
  if(!cue||cue.words.length<2||time<=cue.start||time>=cue.end)return -1;
  let best=-1,distance=Infinity;
  for(let i=0;i<cue.words.length-1;i++){const boundary=(cue.words[i].end+cue.words[i+1].start)/2,delta=Math.abs(time-boundary);if(delta<distance){distance=delta;best=i;}}
  return best;
 }
 function merge(cues,ci,duration){
  validate(cues,duration);const a=cues[ci],b=cues[ci+1];if(!a||!b)throw Error('Select a caption with a following caption.');
  const noSpace=/^[,.;:!?，。！？、）】」』]/u.test(b.text)||(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}，。！？、）】」』]$/u.test(a.text)&&/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(b.text));
  const text=a.text+(noSpace?'':' ')+b.text;if(text.length>300||a.words.length+b.words.length>300)throw Error('Merged captions must stay within 300 characters and 300 words.');
  const timing=a.timing==='estimated'||b.timing==='estimated'?'estimated':a.timing===b.timing?a.timing:'manual';
  const result=copy(cues);result.splice(ci,2,{...copy(a),end:b.end,text,words:copy([...a.words,...b.words]),timing});return validate(result,duration);
 }
 return {copy,round,clamp,validate,bounds,adjust,split,merge,splitWordAt};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=CaptionTimelineModel;
