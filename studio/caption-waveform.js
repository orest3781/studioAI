'use strict';
// Aggregate every intersecting source bin, so narrow transients remain visible
// when zoomed out. The canvas itself is only as wide as the visible viewport.
function waveformColumns(data, left, scale, width){
 const columns=new Float32Array(width),step=data.bin_seconds;
 for(let x=0;x<width;x++){
  const first=Math.max(0,Math.floor((left+x)/scale/step)),last=Math.min(data.peaks.length,Math.ceil((left+x+1)/scale/step));
  for(let i=first;i<last;i++)columns[x]=Math.max(columns[x],data.peaks[i]);
 }
 return columns;
}
// Onset candidates are sustained rises in source audio energy, not recognized
// words. Display gain and zoom never enter this calculation. Look ahead 15 ms
// to reject single-bin clicks, compare with 40 ms of preceding energy, and
// keep the earliest rise in each 60 ms neighborhood.
function waveformOnsets(data){
 if(data?.state!=='ready'||!Array.isArray(data.peaks)||data.peaks.length>120000||!Number.isFinite(data.bin_seconds)||data.bin_seconds<=0||data.bin_seconds>.02)return [];
 const peaks=data.peaks;if(peaks.some(v=>!Number.isFinite(v)||v<0))return [];
 const step=data.bin_seconds,before=Math.max(1,Math.round(.04/step)),after=Math.max(2,Math.round(.015/step)),sustain=Math.max(2,Math.round(.01/step));
 const prefix=new Float64Array(peaks.length+1);for(let i=0;i<peaks.length;i++)prefix[i+1]=prefix[i]+peaks[i];
 const onsets=[];
 for(let i=0;i<peaks.length;i++){
  const end=Math.min(peaks.length,i+after);if(end-i<sustain)break;
  const baseline=(prefix[i]-prefix[Math.max(0,i-before)])/before,upcoming=(prefix[end]-prefix[i])/(end-i);
  if(upcoming<Math.max(64,baseline*2.4)||peaks[i]<Math.max(64,upcoming*.3))continue;
  const threshold=Math.max(64,baseline*1.8);let count=0;for(let j=i;j<end;j++)if(peaks[j]>=threshold)count++;
  const t=Math.round(i*step*1000)/1000;
  if(count>=sustain&&(!onsets.length||t-onsets[onsets.length-1]>=.06-1e-7))onsets.push(t);
 }
 return onsets;
}
function nearestWaveformOnset(onsets,value,limits,radius){
 if(!Number.isFinite(value)||!Number.isFinite(radius)||radius<=0||radius>.1||!limits?.every(Number.isFinite)||limits.length!==2||limits[0]>limits[1])return null;
 const low=Math.max(limits[0],value-radius),high=Math.min(limits[1],value+radius);
 let a=0,b=onsets.length;while(a<b){const mid=(a+b)>>1;if(onsets[mid]<low-1e-7)a=mid+1;else b=mid;}
 let best=null,distance=Infinity;for(let i=a;i<onsets.length&&onsets[i]<=high+1e-7;i++){
  const delta=Math.abs(onsets[i]-value);if(delta<distance-1e-7){best=onsets[i];distance=delta;}
 }
 return best;
}
function resolveWaveformSnap(value,limits,{onsets=[],radius=.05,enabled=false,bypass=false,moved=true}={}){
 const target=enabled&&!bypass&&moved?nearestWaveformOnset(onsets,value,limits,radius):null;
 return {value:target===null?value:target,target};
}
const timelineWaveform={asset:null,data:null,onsets:[],error:'',controller:null,token:0};
function resetTimelineWaveform(){timelineWaveform.controller?.abort();Object.assign(timelineWaveform,{asset:null,data:null,onsets:[],error:'',controller:null,token:timelineWaveform.token+1});clearTimelineSnap();}
async function loadTimelineWaveform(retry=false){
 if(!editingDialog.open||editor.tab!=='caption'||!$('#timeline-show-waveform').checked)return;
 const ident=editor.asset?.id;if(!ident)return;
 if(timelineWaveform.asset===ident&&!retry)return;
 resetTimelineWaveform();timelineWaveform.asset=ident;
 const token=timelineWaveform.token,controller=new AbortController();timelineWaveform.controller=controller;
 drawTimelineWaveform();
 try{
  const response=await fetch('/api/editing/'+encodeURIComponent(ident)+'/waveform',{signal:controller.signal});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Waveform unavailable.');
  if(token!==timelineWaveform.token)return;
  timelineWaveform.data=data;timelineWaveform.onsets=waveformOnsets(data);
 }catch(error){if(token!==timelineWaveform.token||error.name==='AbortError')return;timelineWaveform.error=error.message;}
 finally{if(token===timelineWaveform.token){timelineWaveform.controller=null;drawTimelineWaveform();}}
}
function drawTimelineWaveform(){
 const canvas=$('#timeline-waveform-canvas');if(!canvas)return;
 const view=$('#timeline-scroll'),shown=$('#timeline-show-waveform').checked;
 $('#timeline-tracks').classList.toggle('has-waveform',shown);$('#timeline-waveform').hidden=!shown;
 const data=timelineWaveform.asset===editor.asset?.id?timelineWaveform.data:null;
 const status=$('#timeline-waveform-status');
 status.textContent=!shown?'Waveform hidden':timelineWaveform.error||(!data?'Reading audio locally…':data.state==='no_audio'?'No audio track':data.state==='silent'?'Silent audio':'Local audio · 5 ms detail');
 $('#timeline-waveform-retry').hidden=!timelineWaveform.error||!shown;
 $('#timeline-waveform-gain').disabled=!shown||data?.state!=='ready';
 updateTimelineSnapControls();
 $('#timeline-waveform').setAttribute('aria-valuemax',timelineDuration());
 const width=Math.max(1,Math.ceil(view.clientWidth)),height=48,dpr=Math.min(2,window.devicePixelRatio||1);
 canvas.style.left=view.scrollLeft+'px';canvas.style.width=width+'px';canvas.style.height=height+'px';
 canvas.width=Math.ceil(width*dpr);canvas.height=height*dpr;
 const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.strokeStyle='#334b54';ctx.beginPath();ctx.moveTo(0,height/2);ctx.lineTo(width,height/2);ctx.stroke();
 if(!shown||!data?.peaks.length||!captionTimeline.scale)return;
 const gain=$('#timeline-waveform-gain').value,denominator=gain==='auto'?Math.max(1,data.peak):32767/Number(gain);
 const values=waveformColumns(data,view.scrollLeft,captionTimeline.scale,width);
 ctx.fillStyle='#76c8d3';for(let x=0;x<width;x++){const amplitude=Math.min(1,values[x]/denominator)*(height/2-3);if(amplitude>0)ctx.fillRect(x,height/2-amplitude,1,Math.max(1,amplitude*2));}
 if(timelineSnapEnabled()){
  ctx.strokeStyle='#f4c77a';ctx.setLineDash([2,3]);let previous=-8;
  for(const t of timelineWaveform.onsets){const x=t*captionTimeline.scale-view.scrollLeft;if(x<0||x>width||x-previous<6)continue;previous=x;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}
 }
}
function timelineSnapEnabled(){return !!($('#timeline-snap-enabled')?.checked&&$('#timeline-show-waveform').checked&&timelineWaveform.asset===editor.asset?.id&&timelineWaveform.data?.state==='ready');}
function timelineSnapOptions(event={},moved=true){return {onsets:timelineWaveform.onsets,radius:Number($('#timeline-snap-radius').value),enabled:timelineSnapEnabled(),bypass:!!event.altKey,moved};}
function clearTimelineSnap(){const marker=$('#timeline-snap-marker');if(marker)marker.hidden=true;}
function showTimelineSnap(target){const marker=$('#timeline-snap-marker');marker.hidden=target===null;if(target!==null)marker.style.left=target*captionTimeline.scale+'px';}
function updateTimelineSnapControls(){
 if(!$('#timeline-snap-enabled'))return;
 const checked=$('#timeline-snap-enabled').checked,active=timelineSnapEnabled(),word=editor.doc?.cues[captionTimeline.selected]?.words?.[captionTimeline.word];
 $('#timeline-snap-radius').disabled=!checked;$('#timeline-snap-start').disabled=!active||!word||!timelineWaveform.onsets.length;
 $('#timeline-snap-help').hidden=!checked;
 $('#timeline-snap-help').textContent=!$('#timeline-show-waveform').checked?'Show the waveform to snap.':timelineWaveform.error||timelineWaveform.data?.state==='no_audio'?'No audio onsets · free timing.':timelineWaveform.data?.state==='silent'?'Silent audio · free timing.':!active?'Waiting for local waveform…':!timelineWaveform.onsets.length?'No clear onsets · free timing.':`${timelineWaveform.onsets.length} audio-energy onsets · Alt bypasses · arrows stay precise.`;
}
function setupTimelineWaveform(){
 $('#timeline-words').insertAdjacentHTML('afterend',`<div id="timeline-waveform" role="slider" tabindex="0" aria-label="Audio waveform" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-describedby="timeline-waveform-status"><canvas id="timeline-waveform-canvas" aria-hidden="true"></canvas></div>`);
 $('#timeline-scroll').insertAdjacentHTML('afterend',`<div class="timeline-waveform-controls"><label title="Show local audio peaks"><input id="timeline-show-waveform" type="checkbox" checked>Waveform</label><span id="timeline-waveform-status" role="status"></span><label class="waveform-gain-label" title="Changes waveform height only, not audio volume">Gain<select id="timeline-waveform-gain" aria-label="Waveform display gain"><option value="auto">Auto</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option></select></label><button type="button" class="button secondary" id="timeline-waveform-retry" hidden>Retry waveform</button></div>`);
 $('.timeline-waveform-controls').insertAdjacentHTML('afterend',`<div class="timeline-snap-controls"><label><input id="timeline-snap-enabled" type="checkbox">Snap to onsets</label><select id="timeline-snap-radius" aria-label="Waveform snap range" disabled><option value="0.025">Within 25 ms</option><option value="0.05" selected>Within 50 ms</option><option value="0.1">Within 100 ms</option></select><button type="button" id="timeline-snap-start" class="button secondary" disabled>Snap start</button><span id="timeline-snap-help" hidden></span></div>`);
 $('#timeline-tracks').insertAdjacentHTML('beforeend','<div id="timeline-snap-marker" aria-hidden="true" hidden></div>');
 $('#timeline-snap-enabled').onchange=()=>{if($('#timeline-snap-enabled').checked)$('#timeline-show-waveform').checked=true;clearTimelineSnap();loadTimelineWaveform();drawTimelineWaveform();};
 $('#timeline-snap-radius').onchange=()=>{clearTimelineSnap();updateTimelineSnapControls();};
 $('#timeline-snap-start').onclick=()=>{
  try{
   const ci=captionTimeline.selected,wi=captionTimeline.word,cue=editor.doc.cues[ci],word=cue.words[wi];
   const snap=resolveWaveformSnap(word.start,CaptionTimelineModel.bounds(cue,wi,'start'),timelineSnapOptions());
   if(snap.target===null){timelineStatus(`No onset within ${Number($('#timeline-snap-radius').value)*1000} ms of this word start.`);return;}
   editingMedia().pause();commitTimeline(CaptionTimelineModel.adjust(editor.doc.cues,ci,wi,'start',snap.value,timelineDuration()));
   timelineStatus(`Snapped “${word.text}” start to ${snap.value.toFixed(3)}s. Save edits when ready.`);seekEditing(snap.value+.001);
  }catch(error){timelineStatus(error.message);}
 };
 $('#timeline-show-waveform').onchange=()=>{drawTimelineWaveform();loadTimelineWaveform();};
 $('#timeline-waveform-gain').onchange=drawTimelineWaveform;
 $('#timeline-waveform-retry').onclick=()=>loadTimelineWaveform(true);
 editingDialog.addEventListener('close',resetTimelineWaveform);
}
if(typeof module!=='undefined'&&module.exports)module.exports={waveformColumns,waveformOnsets,nearestWaveformOnset,resolveWaveformSnap};
