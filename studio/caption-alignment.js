/* Shared draft/result contract; no DOM or network dependencies. */
(function(root){
 'use strict';
 const rounded=n=>Math.round(Number(n)*1000)/1000;
 function signature(cues){return JSON.stringify(cues.map(c=>({start:rounded(c.start),end:rounded(c.end),text:c.text.trim().replace(/\t/g,' '),timing:c.timing||'estimated',words:(c.words||[]).map(w=>({text:w.text.trim(),start:rounded(w.start),end:rounded(w.end)}))})));}
 function apply(cues,result){
  if(signature(cues)!==signature(result.input_cues))throw Error('Captions changed since alignment started. Align again to use your latest text and timings.');
  if(!result.aligned_count)throw Error('No captions were aligned. Review the text and caption ranges, then try again.');
  const next=structuredClone(cues);
  for(const entry of result.entries){if(entry.state!=='aligned')continue;const aligned=result.cues[entry.index];next[entry.index].words=structuredClone(aligned.words);next[entry.index].timing='aligned';}
  return next;
 }
 const api={signature,apply};if(typeof module==='object'&&module.exports)module.exports=api;else root.CaptionAlignment=api;
})(typeof globalThis!=='undefined'?globalThis:this);
