'use strict';
const captionTimeline={asset:null,selected:0,word:0,scale:0,undo:[],redo:[],expected:'',drag:null,rendering:false};
const timelineSignature=()=>JSON.stringify(editor.doc?.cues||[]);
function resetCaptionTimeline(){clearTimelineSnap();if($('#timeline-status'))timelineStatus('');Object.assign(captionTimeline,{asset:editor.asset?.id,selected:0,word:0,scale:0,undo:[],redo:[],expected:timelineSignature(),drag:null});renderCaptionTimeline();}
function observeCaptionTimeline(){
 if(!$('#caption-timeline')||!editor.doc)return;
 if(captionTimeline.asset!==editor.asset?.id){resetCaptionTimeline();return;}
 const signature=timelineSignature();if(signature!==captionTimeline.expected&&!captionTimeline.drag){captionTimeline.undo=[];captionTimeline.redo=[];captionTimeline.expected=signature;renderCaptionTimeline();}
}
function timelineStatus(message){$('#timeline-status').textContent=message;}
function timelineDuration(){return Number(editor.asset?.metadata.duration)||0;}
function timelineControls(){
 const cue=editor.doc?.cues[captionTimeline.selected],word=cue?.words[captionTimeline.word],split=CaptionTimelineModel.splitWordAt(cue,editingTime());
 $('#timeline-split-word').disabled=!word||captionTimeline.word>=cue.words.length-1;
 $('#timeline-split-playhead').disabled=split<0;$('#timeline-merge').disabled=!cue||captionTimeline.selected>=editor.doc.cues.length-1;
 $('#timeline-undo').disabled=!captionTimeline.undo.length;$('#timeline-redo').disabled=!captionTimeline.redo.length;
 $('#timeline-caption-zoom').disabled=!cue;$('#timeline-play').textContent=editingMedia().paused?'Play':'Pause';
 $('#timeline-selected').textContent=cue?`Caption ${captionTimeline.selected+1} · ${cue.start.toFixed(2)}–${cue.end.toFixed(2)}s${word?' · “'+word.text+'”':''}`:'Apply a transcript or add a caption to begin.';
 $('#timeline-split-playhead').title=split<0?'Move the playhead inside a caption with at least two words.':`Split after “${cue.words[split].text}” at the nearest word boundary.`;
 updateTimelineSnapControls();
}
function renderCaptionTimeline(){
 if(!editor.doc||!$('#caption-timeline')||captionTimeline.rendering)return;captionTimeline.rendering=true;
 try{
  const viewport=$('#timeline-scroll'),duration=timelineDuration(),width=viewport.clientWidth||360;
  captionTimeline.selected=Math.max(0,Math.min(captionTimeline.selected,editor.doc.cues.length-1));
  const selected=editor.doc.cues[captionTimeline.selected];if(selected)prepareCaptionCue(selected);
  captionTimeline.word=Math.max(0,Math.min(captionTimeline.word,(selected?.words.length||1)-1));
  const minimum=width/Math.max(.01,duration);captionTimeline.scale=Math.max(minimum,Math.min(1000,captionTimeline.scale||minimum));
  const scale=captionTimeline.scale,extent=Math.max(width,duration*scale),left=viewport.scrollLeft/scale,right=(viewport.scrollLeft+width)/scale;
  $('#timeline-tracks').style.width=extent+'px';
  const step=[.1,.25,.5,1,2,5,10,30,60,120,300].find(s=>s*scale>=58)||600;
  const ticks=[];for(let t=Math.ceil(left/step)*step;t<=Math.min(duration,right)+.001;t+=step)ticks.push(`<span style="left:${t*scale}px">${t<60?t.toFixed(step===.25?2:step<1?1:0):Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0')}s</span>`);
  $('#timeline-ruler').innerHTML=ticks.join('');
  $('#timeline-captions').innerHTML=editor.doc.cues.map((c,i)=>c.end<left||c.start>right?'':`<button type="button" class="timeline-cue ${i===captionTimeline.selected?'selected':''}" data-timeline-cue="${i}" style="left:${c.start*scale}px;width:${Math.max(2,(c.end-c.start)*scale)}px" aria-pressed="${i===captionTimeline.selected}" aria-label="Select caption ${i+1}: ${escapeHTML(c.text)}" title="${escapeHTML(c.text)}">${i+1} · ${escapeHTML(c.text)}</button>`).join('');
  $('#timeline-words').innerHTML=(selected?.words||[]).map((w,i)=>{
   if(![w.start,w.end].every(Number.isFinite)||w.end<w.start)return '';
   const limits=edge=>{try{return CaptionTimelineModel.bounds(selected,i,edge);}catch{return [w.start,w.end];}};
   return `<div class="timeline-word ${i===captionTimeline.word?'selected':''}" data-word-block="${i}" style="left:${w.start*scale}px;width:${Math.max(2,(w.end-w.start)*scale)}px"><button type="button" class="timeline-word-move" data-timeline-word="${i}" data-edge="move" aria-label="Move word ${i+1}: ${escapeHTML(w.text)}" title="${escapeHTML(w.text)} · ${w.start.toFixed(3)}–${w.end.toFixed(3)}s">${escapeHTML(w.text)}</button>${['start','end'].map(edge=>`<button type="button" role="slider" aria-orientation="horizontal" class="timeline-edge ${edge}" data-timeline-word="${i}" data-edge="${edge}" aria-label="Word ${i+1} ${edge}: ${escapeHTML(w.text)}" aria-valuemin="${limits(edge)[0]}" aria-valuemax="${limits(edge)[1]}" aria-valuenow="${w[edge]}" aria-valuetext="${w[edge].toFixed(3)} seconds" title="Drag ${edge}; arrows adjust 10 ms, Shift + arrows 100 ms"></button>`).join('')}</div>`;
  }).join('');
  $('#timeline-caption-select').innerHTML=editor.doc.cues.length?editor.doc.cues.map((c,i)=>`<option value="${i}">${i+1}. ${escapeHTML(c.text.slice(0,60))}</option>`).join(''):'<option value="0">No captions yet</option>';
  $('#timeline-caption-select').value=String(captionTimeline.selected);$('#timeline-caption-select').disabled=!selected;
  $('#timeline-scale').textContent=Math.round(scale)+' px/s';timelineControls();syncCaptionTimeline(false);loadTimelineWaveform();drawTimelineWaveform();
 }finally{captionTimeline.rendering=false;}
}
function syncCaptionTimeline(follow=true){
 if(!editor.doc||!$('#timeline-tracks'))return;
 const t=editingTime(),viewport=$('#timeline-scroll'),scale=captionTimeline.scale;
 $('#timeline-playhead').style.left=t*scale+'px';$('#timeline-clock').textContent=t.toFixed(3)+'s';
 $('#timeline-waveform').setAttribute('aria-valuenow',t);$('#timeline-waveform').setAttribute('aria-valuetext',t.toFixed(3)+' seconds');
 $('#timeline-playhead').setAttribute('aria-valuemax',timelineDuration());$('#timeline-playhead').setAttribute('aria-valuenow',t);$('#timeline-playhead').setAttribute('aria-valuetext',t.toFixed(3)+' seconds');
 const ci=editor.doc.cues.findIndex(c=>c.start<=t&&t<c.end);
 if(follow&&!captionTimeline.drag&&!editingMedia().paused&&ci>=0&&ci!==captionTimeline.selected){captionTimeline.selected=ci;captionTimeline.word=0;renderCaptionTimeline();}
 const cue=editor.doc.cues[captionTimeline.selected],active=cue?.words?.findIndex(w=>w.start<=t&&t<w.end)??-1;
 for(const element of $('#timeline-words').querySelectorAll('[data-word-block]'))element.classList.toggle('speaking',Number(element.dataset.wordBlock)===active);
 if(follow&&!captionTimeline.drag&&!editingMedia().paused&&$('#timeline-follow').checked&&(t*scale<viewport.scrollLeft||t*scale>viewport.scrollLeft+viewport.clientWidth-30))viewport.scrollLeft=Math.max(0,t*scale-viewport.clientWidth*.2);
 timelineControls();
}
function commitTimeline(cues,before=editor.doc.cues,message='Timeline edit applied. Save edits when ready.'){
 if(JSON.stringify(before)===JSON.stringify(cues)){renderCaptionTimeline();return;}
 captionTimeline.undo.push(structuredClone(before));if(captionTimeline.undo.length>40)captionTimeline.undo.shift();captionTimeline.redo=[];
 editor.doc.cues=cues;captionTimeline.expected=timelineSignature();editingChanged();renderCues();renderCaptionTimeline();timelineStatus(message);
}
function timelineHistory(redo=false){
 const from=redo?captionTimeline.redo:captionTimeline.undo,to=redo?captionTimeline.undo:captionTimeline.redo;if(!from.length)return;
 editingMedia().pause();to.push(structuredClone(editor.doc.cues));editor.doc.cues=from.pop();captionTimeline.expected=timelineSignature();editingChanged();renderCues();renderCaptionTimeline();timelineStatus(redo?'Timeline edit redone.':'Timeline edit undone.');
}
function selectTimelineCaption(index,seek=true){captionTimeline.selected=index;captionTimeline.word=0;renderCaptionTimeline();if(seek&&editor.doc.cues[index])seekEditing(editor.doc.cues[index].start);}
function zoomCaptionTimeline(factor,selected=false){
 const view=$('#timeline-scroll'),cue=editor.doc.cues[captionTimeline.selected],center=(view.scrollLeft+view.clientWidth/2)/captionTimeline.scale;
 captionTimeline.scale=selected&&cue?view.clientWidth/(cue.end-cue.start+.2):factor===0?0:captionTimeline.scale*factor;
 renderCaptionTimeline();view.scrollLeft=selected&&cue?Math.max(0,(cue.start-.1)*captionTimeline.scale):factor===0?0:Math.max(0,center*captionTimeline.scale-view.clientWidth/2);renderCaptionTimeline();
}
function setupCaptionTimeline(){
 $('.editing-transport').insertAdjacentHTML('afterend',`<section id="caption-timeline" aria-label="Visual caption timeline"><div class="timeline-heading"><h3>Caption timeline</h3><output id="timeline-clock">0.000s</output><button type="button" class="button secondary" id="timeline-play">Play</button></div>
 <div class="timeline-toolbar"><label class="timeline-cue-picker">Caption<select id="timeline-caption-select" aria-label="Selected timeline caption"></select></label><button type="button" class="button secondary" id="timeline-zoom-out" aria-label="Zoom timeline out">−</button><button type="button" class="button secondary" id="timeline-zoom-in" aria-label="Zoom timeline in">+</button><button type="button" class="button secondary" id="timeline-fit" aria-label="Fit clip" title="Fit the whole clip">Fit</button><button type="button" class="button secondary" id="timeline-caption-zoom" aria-label="Zoom to caption" title="Zoom to the selected caption">Caption</button></div>
 <div class="timeline-lane-labels"><span>Captions / words</span><span id="timeline-scale"></span></div><div id="timeline-scroll" tabindex="0" aria-label="Scrollable caption timeline"><div id="timeline-tracks"><div id="timeline-ruler" aria-label="Timeline ruler"></div><div id="timeline-captions"></div><div id="timeline-words"></div><button type="button" role="slider" aria-label="Timeline playhead" aria-orientation="horizontal" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" id="timeline-playhead"></button></div></div>
 <div class="timeline-tools"><button type="button" class="button secondary" id="timeline-split-word" aria-label="Split after word" title="Split after the selected word">Split after</button><button type="button" class="button secondary" id="timeline-split-playhead" aria-label="Split at playhead">Split here</button><button type="button" class="button secondary" id="timeline-merge" aria-label="Merge with next">Merge next</button><button type="button" class="button secondary" id="timeline-undo">Undo</button><button type="button" class="button secondary" id="timeline-redo">Redo</button></div>
 <div class="timeline-follow-row"><label><input type="checkbox" id="timeline-follow" checked>Follow playback</label><span id="timeline-selected"></span></div><p class="field-note">Drag a word or its edges. Click the ruler or waveform to seek. Arrow keys adjust focused handles by 10 ms; Shift adjusts 100 ms. Splits snap between words.</p><p id="timeline-status" class="field-note" role="status"></p></section>`);
 setupTimelineWaveform();
 $('#caption-timeline').hidden=editor.tab!=='caption';
 const safely=action=>()=>{try{action();$('#editing-error').textContent='';}catch(error){timelineStatus(error.message);}};
 $('#timeline-play').onclick=async()=>{try{if(editingMedia().paused)await editingMedia().play();else editingMedia().pause();syncCaptionTimeline();}catch(error){timelineStatus('Playback could not start: '+error.message);}};
 $('#timeline-caption-select').onchange=e=>selectTimelineCaption(Number(e.target.value));
 $('#timeline-fit').onclick=()=>zoomCaptionTimeline(0);$('#timeline-zoom-in').onclick=()=>zoomCaptionTimeline(2);$('#timeline-zoom-out').onclick=()=>zoomCaptionTimeline(.5);$('#timeline-caption-zoom').onclick=()=>zoomCaptionTimeline(1,true);
 $('#timeline-split-word').onclick=safely(()=>commitTimeline(CaptionTimelineModel.split(editor.doc.cues,captionTimeline.selected,captionTimeline.word,timelineDuration()),editor.doc.cues,'Caption split; word timing preserved.'));
 $('#timeline-split-playhead').onclick=safely(()=>commitTimeline(CaptionTimelineModel.split(editor.doc.cues,captionTimeline.selected,CaptionTimelineModel.splitWordAt(editor.doc.cues[captionTimeline.selected],editingTime()),timelineDuration()),editor.doc.cues,'Caption split at the nearest word boundary.'));
 $('#timeline-merge').onclick=safely(()=>commitTimeline(CaptionTimelineModel.merge(editor.doc.cues,captionTimeline.selected,timelineDuration()),editor.doc.cues,'Captions merged; word timing and silence gaps preserved.'));
 $('#timeline-undo').onclick=()=>timelineHistory();$('#timeline-redo').onclick=()=>timelineHistory(true);
 $('#timeline-scroll').addEventListener('scroll',()=>{if(!captionTimeline.drag)renderCaptionTimeline();});
 $('#timeline-tracks').addEventListener('click',event=>{const cue=event.target.closest('[data-timeline-cue]');if(cue)selectTimelineCaption(Number(cue.dataset.timelineCue));const word=event.target.closest('[data-timeline-word]');if(word&&event.detail===0){captionTimeline.word=Number(word.dataset.timelineWord);seekEditing(editor.doc.cues[captionTimeline.selected].words[captionTimeline.word].start);timelineControls();}});
 const tracks=$('#timeline-tracks');
 tracks.addEventListener('focusin',event=>{const target=event.target.closest('[data-timeline-word]');if(!target)return;captionTimeline.word=Number(target.dataset.timelineWord);for(const block of $('#timeline-words').querySelectorAll('[data-word-block]'))block.classList.toggle('selected',Number(block.dataset.wordBlock)===captionTimeline.word);timelineControls();});
 function finishDrag(cancel=false){
  const drag=captionTimeline.drag;if(!drag)return;captionTimeline.drag=null;clearTimelineSnap();
  if(drag.before){const result=editor.doc.cues;editor.doc.cues=drag.before;if(cancel){captionTimeline.expected=timelineSignature();renderCues();renderCaptionTimeline();seekEditing(drag.time);timelineStatus('Drag cancelled.');}else commitTimeline(result,drag.before,drag.snap!=null?`Snapped “${result[drag.caption].words[drag.word].text}” ${drag.edge==='move'?'start':drag.edge} to ${drag.snap.toFixed(3)}s. Save edits when ready.`:undefined);}
  else renderCaptionTimeline();
 }
 tracks.addEventListener('pointerdown',event=>{
  if(event.button!==0||event.target.closest('[data-timeline-cue]'))return;
  const target=event.target.closest('[data-timeline-word]');editingMedia().pause();
  try{
   if(target){CaptionTimelineModel.validate(editor.doc.cues,timelineDuration());captionTimeline.word=Number(target.dataset.timelineWord);const cue=editor.doc.cues[captionTimeline.selected],w=cue.words[captionTimeline.word];
    captionTimeline.drag={before:structuredClone(editor.doc.cues),time:editingTime(),x:event.clientX,edge:target.dataset.edge,word:captionTimeline.word,caption:captionTimeline.selected,start:w.start,end:w.end,pointer:event.pointerId};
   }else captionTimeline.drag={seek:true,pointer:event.pointerId};
   tracks.setPointerCapture(event.pointerId);event.preventDefault();move(event);
  }catch(error){timelineStatus(error.message);captionTimeline.drag=null;}
 });
 function move(event){
  const drag=captionTimeline.drag;if(!drag)return;
  drag.pointerX=event.clientX;
  if(drag.seek){const rect=tracks.getBoundingClientRect();seekEditing((event.clientX-rect.left)/captionTimeline.scale);return;}
  const value=(drag.edge==='end'?drag.end:drag.start)+(event.clientX-drag.x)/captionTimeline.scale;
  try{
   const limits=CaptionTimelineModel.bounds(drag.before[drag.caption],drag.word,drag.edge),snap=resolveWaveformSnap(value,limits,timelineSnapOptions(event,Math.abs(event.clientX-drag.x)>=2));
   drag.snap=snap.target;showTimelineSnap(snap.target);
   editor.doc.cues=CaptionTimelineModel.adjust(drag.before,drag.caption,drag.word,drag.edge,snap.value,timelineDuration());const w=editor.doc.cues[drag.caption].words[drag.word],block=$('#timeline-words').querySelector(`[data-word-block="${drag.word}"]`);
   if(block){block.style.left=w.start*captionTimeline.scale+'px';block.style.width=(w.end-w.start)*captionTimeline.scale+'px';for(const handle of block.querySelectorAll('[data-edge]')){if(handle.dataset.edge!=='move'){handle.setAttribute('aria-valuenow',w[handle.dataset.edge]);handle.setAttribute('aria-valuetext',w[handle.dataset.edge].toFixed(3)+' seconds');}}}
   seekEditing(drag.edge==='end'?w.end-.001:w.start+.001);timelineStatus(`${w.text}: ${w.start.toFixed(3)}–${w.end.toFixed(3)}s${snap.target!==null?' · Snapped to onset '+snap.target.toFixed(3)+'s':event.altKey?' · Free timing (Alt)':''}`);
  }catch(error){timelineStatus(error.message);}
 }
 tracks.addEventListener('pointermove',move);tracks.addEventListener('pointerup',()=>finishDrag());tracks.addEventListener('pointercancel',()=>finishDrag(true));tracks.addEventListener('lostpointercapture',()=>{if(captionTimeline.drag)finishDrag(true);});
 editingDialog.addEventListener('cancel',event=>{if(captionTimeline.drag){event.preventDefault();finishDrag(true);}});
 editingDialog.addEventListener('close',()=>finishDrag(true),true);
 tracks.addEventListener('keydown',event=>{
  if(event.key==='Alt'&&captionTimeline.drag){event.preventDefault();move({clientX:captionTimeline.drag.pointerX,altKey:true});return;}
  if(event.key==='Escape'&&captionTimeline.drag){event.preventDefault();finishDrag(true);return;}
  const target=event.target.closest('[data-timeline-word]'),playhead=['timeline-playhead','timeline-waveform'].includes(event.target.id);
  if(!target&&!playhead)return;
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();editingMedia().pause();
  const delta=(event.shiftKey ? .1 : .01)*(event.key==='ArrowLeft'?-1:1);
  if(playhead){seekEditing(event.key==='Home'?0:event.key==='End'?timelineDuration():editingTime()+delta);return;}
  try{const ci=captionTimeline.selected,wi=Number(target.dataset.timelineWord),edge=target.dataset.edge,w=editor.doc.cues[ci].words[wi],range=CaptionTimelineModel.bounds(editor.doc.cues[ci],wi,edge);
   captionTimeline.word=wi;const value=event.key==='Home'?range[0]:event.key==='End'?range[1]:(edge==='end'?w.end:w.start)+delta;
   commitTimeline(CaptionTimelineModel.adjust(editor.doc.cues,ci,wi,edge,value,timelineDuration()));
   $('#timeline-words').querySelector(`[data-timeline-word="${wi}"][data-edge="${edge}"]`)?.focus({preventScroll:true});seekEditing(edge==='end'?editor.doc.cues[ci].words[wi].end-.001:editor.doc.cues[ci].words[wi].start+.001);
  }catch(error){timelineStatus(error.message);}
 });
 tracks.addEventListener('keyup',event=>{if(event.key==='Alt'&&captionTimeline.drag){event.preventDefault();move({clientX:captionTimeline.drag.pointerX,altKey:false});}});
 new ResizeObserver(()=>{if(editingDialog.open&&!captionTimeline.drag)renderCaptionTimeline();}).observe($('#timeline-scroll'));
 for(const name of ['video','audio']){for(const event of ['play','pause','ended','seeked'])$('#editing-'+name).addEventListener(event,()=>syncCaptionTimeline());}
}
