'use strict';
const editor={asset:null,doc:null,jobs:[],capabilities:{},drafts:new Map(),dirty:false,box:null,selecting:false,polling:false,jobSignature:'',tab:'track'};
const editButton=document.createElement('button');editButton.id='edit-button';editButton.className='button secondary';editButton.textContent='Reframe & captions';editButton.disabled=true;
$('#export-button').before(editButton);
document.body.insertAdjacentHTML('beforeend',`<dialog id="editing-dialog" aria-labelledby="editing-title">
 <div class="dialog-heading"><div><span class="eyebrow">LOCAL FINISHING</span><h2 id="editing-title">Reframe & captions</h2></div><button class="icon-button" id="editing-close" aria-label="Close editing">×</button></div>
 <p id="editing-source" class="muted small"></p>
 <div class="editing-layout"><section class="editing-preview">
  <div id="editing-media-wrap"><video id="editing-video" controls preload="metadata"></video><img id="editing-first-frame" alt="First frame for subject selection" hidden><div id="editing-overlay"><div id="editing-crop"></div><div id="editing-box" hidden></div><div id="editing-caption"></div></div></div>
  <audio id="editing-audio" controls hidden></audio>
  <div class="editing-transport"><label>Playhead <input id="editing-time" type="number" min="0" step="0.001" value="0" aria-label="Playhead seconds"></label><label>Crop preview <select id="editing-ratio"><option>9:16</option><option>4:5</option><option>1:1</option><option>16:9</option></select></label></div>
  <p id="editing-preview-note" class="field-note">The outlined area is the crop. Preview your saved edits in Export before delivery.</p>
  <p id="editing-local" class="field-note">Analysis runs on this PC using the CPU. Your media is never uploaded.</p>
  <div id="editing-jobs" aria-live="polite"></div>
 </section><section class="editing-controls">
  <div class="inspector-tabs" role="tablist" aria-label="Editing tools"><button id="editing-track-tab" role="tab" aria-selected="true" aria-controls="editing-track-panel" class="active">Subject framing</button><button id="editing-caption-tab" role="tab" aria-selected="false" aria-controls="editing-caption-panel">Captions</button></div>
  <section id="editing-track-panel" role="tabpanel" aria-labelledby="editing-track-tab">
   <h3>Keep your subject in frame</h3><p class="field-note">Detect the largest face, or draw a box around any subject on the first frame. Tracking follows that selection; review cuts and occlusions.</p>
   <div class="editing-actions"><button id="editing-face" class="button secondary">Track largest face</button><button id="editing-select" class="button secondary">Select subject</button><button id="editing-track" class="button primary" disabled>Track selected subject</button></div>
   <p id="editing-selection-note" class="field-note"></p>
   <h3>Refine the crop path</h3><p class="field-note">Seek to a moment, adjust the center, then add or replace its keyframe. Motion interpolates between points.</p>
   <div class="form-row"><label>Subject center X<input id="editing-x" type="range" min="0" max="100" step="0.1" value="50"></label><label>Subject center Y<input id="editing-y" type="range" min="0" max="100" step="0.1" value="50"></label></div>
   <button id="editing-keyframe" class="button secondary">Set keyframe at playhead</button>
   <div id="editing-keyframes" class="editing-keyframes"></div>
  </section>
  <section id="editing-caption-panel" role="tabpanel" aria-labelledby="editing-caption-tab" hidden>
   <h3>Words, in your voice</h3><div class="editing-actions"><label>Speech language<select id="editing-language"><option value="auto">Detect language</option><option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option><option value="it">Italian</option><option value="pt">Portuguese</option><option value="ja">Japanese</option><option value="ko">Korean</option><option value="zh">Chinese</option><option value="hi">Hindi</option><option value="ar">Arabic</option><option value="ru">Russian</option><option value="nl">Dutch</option></select></label><button id="editing-transcribe" class="button primary">Transcribe locally</button></div>
   <p id="editing-model" class="field-note" role="status"></p><button id="editing-check-runtime" class="button secondary">Recheck caption engine</button><p class="field-note">Review the transcript, names and timing. Analysis results are applied only when you choose them below the preview.</p>
   <section class="caption-alignment"><h3>Resync edited text</h3><p class="field-note">Match your words to the audio on this PC. Uses existing caption ranges (up to 28 seconds each). Expand a range if speech falls outside it. Review proposed times before applying; uncertain captions keep their timing.</p><div class="editing-actions"><button id="editing-align-selected" class="button secondary">Align selected caption</button><button id="editing-align-all" class="button secondary">Align all captions</button></div><p class="field-note">Selected caption follows the timeline selector. Applying alignment supports Undo.</p></section>
   <div class="form-row"><label>Caption position<select id="editing-caption-position"><option value="bottom">Bottom</option><option value="middle">Middle</option><option value="top">Top</option></select></label><label>Text size<input id="editing-caption-size" type="number" min="2" max="9" step="0.5" value="5"></label><label>Edge inset %<input id="editing-caption-margin" type="number" min="3" max="30" step="1" value="12"></label></div>
   <div id="editing-cues"></div><button id="editing-add-cue" class="button secondary">Add caption at playhead</button>
   <div class="editing-actions"><a id="editing-srt" class="button secondary" download="captions.srt">Download SRT</a><a id="editing-vtt" class="button secondary" download="captions.vtt">Download VTT</a></div><p class="field-note">Subtitle downloads use your saved text and timing. Text style applies to video exports.</p>
  </section>
 </section></div>
 <div class="editing-footer"><span id="editing-save-state" role="status"></span><button id="editing-save" class="button secondary">Save edits</button><button id="editing-export" class="button primary">Save & open Export</button></div>
 <p id="editing-error" role="alert" class="error-text"></p>
</dialog>`);
const editingDialog=$('#editing-dialog');
function editingMedia(){return editor.asset?.kind==='audio'?$('#editing-audio'):$('#editing-video');}
function editingTime(){return Number($('#editing-time').value)||0;}
function editingChanged(){editor.dirty=true;editor.changeVersion=(editor.changeVersion||0)+1;$('#editing-save-state').textContent='Unsaved edits · kept here while you work';observeCaptionTimeline();drawEditingOverlay();updateCaptionPhraseControls();updateCaptionReadability();}
function editingPosition(t){const pts=editor.doc?.points||[];if(!pts.length)return [50,50];let a=pts[0];for(const b of pts.slice(1)){if(t<=b.t){const f=Math.max(0,Math.min(1,(t-a.t)/(b.t-a.t)));return [a.x+(b.x-a.x)*f,a.y+(b.y-a.y)*f];}a=b;}return [a.x,a.y];}
function seekEditing(t,keepInput=false){editor.selecting=false;$('#editing-first-frame').hidden=true;$('#editing-video').hidden=false;$('#editing-overlay').classList.remove('selecting');t=Math.max(0,Math.min(Math.max(0,(editor.asset.metadata.duration||0)-.03),t));editingMedia().currentTime=t;if(!keepInput)$('#editing-time').value=t.toFixed(3);syncEditingPosition();}
function syncEditingPosition(){const [x,y]=editingPosition(editingTime());$('#editing-x').value=x;$('#editing-y').value=y;drawEditingOverlay();}
function drawEditingOverlay(){
 if(!editor.doc)return;
 const wrap=$('#editing-media-wrap'),[rw,rh]=$('#editing-ratio').value.split(':').map(Number),aspect=Number(wrap.dataset.aspect)||16/9;
 let cw=Math.min(100,rw/rh/aspect*100),ch=Math.min(100,aspect/(rw/rh)*100);
 const x=Number($('#editing-x').value),y=Number($('#editing-y').value),crop=$('#editing-crop');
 Object.assign(crop.style,{left:Math.max(0,Math.min(100-cw,x-cw/2))+'%',top:Math.max(0,Math.min(100-ch,y-ch/2))+'%',width:cw+'%',height:ch+'%'});
 const cue=editor.doc.cues.find(c=>c.start<=editingTime()&&editingTime()<c.end),caption=$('#editing-caption'),style=editor.doc.style;
 drawAnimatedCaption(cue,style,caption);caption.style.fontSize=Math.max(10,Math.min(wrap.clientWidth,wrap.clientHeight)*style.size/100)+'px';
 caption.style.top=style.position==='top'?style.margin+'%':style.position==='middle'?'50%':'auto';caption.style.bottom=style.position==='bottom'?style.margin+'%':'auto';caption.style.transform=style.position==='middle'?'translateY(-50%)':'none';
 const box=$('#editing-box');box.hidden=!editor.box||!editor.selecting;
 if(editor.box)Object.assign(box.style,{left:editor.box[0]+'%',top:editor.box[1]+'%',width:editor.box[2]+'%',height:editor.box[3]+'%'});syncCaptionTimeline();
}
function renderKeyframes(){const pts=editor.doc.points;$('#editing-keyframes').innerHTML=pts.length?`<p class="field-note">${pts.length} keyframes · select a time to inspect</p>`+pts.map((p,i)=>`<span class="editing-point"><button class="button secondary" data-point="${i}">${p.t.toFixed(2)}s · ${Math.round(p.x)}, ${Math.round(p.y)}</button><button class="icon-button" data-remove-point="${i}" aria-label="Remove keyframe at ${p.t} seconds">×</button></span>`).join(''):'<p class="field-note">No crop path yet. Track a subject or add keyframes.</p>';}
function renderCues(){
 $('#editing-cues').innerHTML=editor.doc.cues.length?editor.doc.cues.map((c,i)=>`<div class="editing-cue" data-cue="${i}"><div class="editing-cue-time"><button class="icon-button" data-cue-seek="${i}" aria-label="Preview caption ${i+1}">▶</button><label>Start<input type="number" step="0.01" min="0" value="${c.start}" data-cue-field="start" aria-label="Caption ${i+1} start"></label><label>End<input type="number" step="0.01" min="0" value="${c.end}" data-cue-field="end" aria-label="Caption ${i+1} end"></label><button class="icon-button" data-remove-cue="${i}" aria-label="Remove caption ${i+1}">×</button></div><textarea maxlength="300" rows="2" data-cue-field="text" aria-label="Caption ${i+1} text">${escapeHTML(c.text)}</textarea>${wordTimingMarkup(c,i)}</div>`).join(''):'<p class="field-note">Transcribe speech or add your own captions.</p>';observeCaptionTimeline();renderCaptionTimeline();renderCaptionHealth(editor.capabilities);updateCaptionPhraseControls();updateCaptionReadability();
}
function alignmentReview(result){
 return `<p class="field-note">${result.aligned_count} aligned · ${result.unchanged_count} unchanged. Listen and review before saving.</p><details class="alignment-review"><summary>Review proposed word timings</summary>${result.entries.map(entry=>`<section><strong>Caption ${entry.index+1} · ${entry.state==='aligned'?'aligned':'unchanged'}</strong><p>${escapeHTML(result.input_cues[entry.index].text)}</p>${entry.state==='aligned'?`<p class="field-note">${entry.words.map(w=>`${escapeHTML(w.text)} ${w.start.toFixed(3)}–${w.end.toFixed(3)}s`).join(' · ')}</p>${entry.low_confidence_words.length?`<p class="field-note">Check these words: ${entry.low_confidence_words.map(escapeHTML).join(', ')}</p>`:''}`:`<p class="field-note">${escapeHTML(entry.reason)}</p>`}</section>`).join('')}</details>`;
}
function renderEditingJobs(){
 const signature=JSON.stringify(editor.jobs);if(signature===editor.jobSignature)return;editor.jobSignature=signature;
 $('#editing-jobs').innerHTML=editor.jobs.slice(0,8).map(job=>{const active=['queued','running','cancelling'].includes(job.state);return `<article class="editing-job"><strong>${job.task==='track'?'Subject tracking':job.task==='align'?'Local alignment':'Local transcription'} · ${escapeHTML(job.state)}</strong>${active?`<progress max="1" value="${job.progress}" aria-label="Analysis progress"></progress>`:''}${job.error?`<p class="error-text">${escapeHTML(job.error)}</p>`:''}${(job.result?.warnings||[]).map(w=>`<p class="field-note">${escapeHTML(w)}</p>`).join('')}${job.task==='align'&&job.result?alignmentReview(job.result):''}${job.state==='completed'&&(job.task!=='align'||job.result?.aligned_count)?`<button class="button secondary" data-apply-analysis="${job.id}">${job.task==='track'?'Use this crop path':job.task==='align'?'Apply aligned timings':'Use this transcript'}</button>`:active&&job.state!=='cancelling'?`<button class="button secondary" data-cancel-analysis="${job.id}">Cancel analysis</button>`:''}</article>`;}).join('');
}
async function openEditing(){
 const asset=selectedAsset();if(!asset||!['video','audio'].includes(asset.kind))return;
 try{
  const response=await api('/api/editing/'+asset.id);editor.asset=asset;editor.capabilities=response.capabilities;editor.jobs=response.jobs;editor.jobSignature='';editor.box=null;
  const draft=editor.drafts.get(asset.id);editor.doc=structuredClone(draft?.doc||response.document);editor.dirty=!!draft?.dirty;
  $('#editing-source').textContent=asset.name+' · '+assetInfo(asset);$('#editing-error').textContent='';
  $('#editing-video').src=asset.kind==='video'?asset.url:'';$('#editing-audio').src=asset.kind==='audio'?asset.url:'';
  $('#editing-media-wrap').hidden=asset.kind!=='video';$('#editing-audio').hidden=asset.kind!=='audio';$('#editing-track-tab').disabled=asset.kind!=='video';
  $('#editing-first-frame').hidden=true;$('#editing-video').hidden=false;$('#editing-overlay').classList.remove('selecting');editor.selecting=false;
  $('#editing-track').disabled=true;$('#editing-selection-note').textContent='';$('#editing-time').value='0';$('#editing-time').max=String(asset.metadata.duration||0);
  renderCaptionHealth(response.capabilities);
  syncCaptionStyleControls();await loadCaptionStyles();
  $('#editing-srt').href='/api/editing/'+asset.id+'/captions.srt';$('#editing-vtt').href='/api/editing/'+asset.id+'/captions.vtt';
  $('#editing-save-state').textContent=editor.dirty?'Unsaved edits restored':'Saved locally · version '+editor.doc.revision;
  $('#editing-export').hidden=asset.kind!=='video';editingDialog.showModal();switchEditingTab(asset.kind==='audio'?'caption':editor.tab);
  resetCaptionPhrasePreview();resetReadabilityFixes();resetCaptionTimeline();renderKeyframes();renderCues();renderEditingJobs();syncEditingPosition();
 }catch(error){toast(error.message,true);}
}
function switchEditingTab(tab){editor.tab=tab;editingDialog.classList.toggle('editing-caption-view',tab==='caption');$('#caption-timeline').hidden=tab!=='caption';if(tab==='caption')renderCaptionTimeline();for(const key of ['track','caption']){const active=key===tab;$('#editing-'+key+'-panel').hidden=!active;$('#editing-'+key+'-tab').classList.toggle('active',active);$('#editing-'+key+'-tab').setAttribute('aria-selected',String(active));}drawEditingOverlay();}
async function saveEditing(){
 if(editor.saving)throw Error('Saving edits. Please wait.');editor.saving=true;$('#editing-save').disabled=true;$('#editing-export').disabled=true;
 const changeVersion=editor.changeVersion;
 try{editor.doc.cues.sort((a,b)=>a.start-b.start);
 const saved=await api('/api/editing/'+editor.asset.id,{action:'save',...editor.doc});editor.doc.revision=saved.revision;
 if(changeVersion!==editor.changeVersion)throw Error('Earlier changes saved. Save once more to include your latest edit.');
 editor.doc=saved;editor.dirty=false;editor.drafts.delete(editor.asset.id);renderCues();$('#editing-save-state').textContent='Saved locally · version '+saved.revision;return saved;
 }finally{editor.saving=false;$('#editing-save').disabled=false;$('#editing-export').disabled=false;}
}
async function startAnalysis(action,box=null,indices=null){
 $('#editing-error').textContent='';
 try{await api('/api/editing/'+editor.asset.id,{action,box,language:$('#editing-language').value,request_id:crypto.randomUUID(),...(action==='align'?{cues:editor.doc.cues.map(c=>prepareCaptionCue(structuredClone(c))),indices:indices||editor.doc.cues.map((_,i)=>i)}:{})});if(action==='track')seekEditing(0);await pollEditing();toast('Local analysis queued. Your saved edits stay intact.');}
 catch(error){$('#editing-error').textContent=error.message;}
}
function renderCaptionHealth(capabilities){editor.capabilities=capabilities;$('#editing-model').textContent=capabilities.captions_ready?capabilities.model+' · verified offline':capabilities.caption_error||'Local caption engine is unavailable. Manual captions remain available.';$('#editing-transcribe').disabled=!capabilities.captions_ready;for(const id of ['editing-align-selected','editing-align-all'])$('#'+id).disabled=!capabilities.alignment_ready||!editor.doc?.cues.length;}
async function pollEditing(){if(!editingDialog.open||editor.polling)return;editor.polling=true;try{const data=await api('/api/editing/'+editor.asset.id);editor.jobs=data.jobs;renderCaptionHealth(data.capabilities);renderEditingJobs();}catch(error){$('#editing-error').textContent=error.message;}finally{editor.polling=false;}}
editButton.onclick=openEditing;
$('#editing-close').onclick=()=>editingDialog.close();
editingDialog.addEventListener('close',()=>{editingMedia().pause();if(editor.dirty)editor.drafts.set(editor.asset.id,{doc:structuredClone(editor.doc),dirty:true});});
window.addEventListener('beforeunload',event=>{if(editor.dirty||editor.drafts.size){event.preventDefault();event.returnValue='';}});
$('#editing-track-tab').onclick=()=>switchEditingTab('track');$('#editing-caption-tab').onclick=()=>switchEditingTab('caption');
$('#editing-face').onclick=()=>startAnalysis('track');$('#editing-track').onclick=()=>startAnalysis('track',editor.box);
$('#editing-transcribe').onclick=()=>startAnalysis('transcribe');
$('#editing-align-selected').onclick=()=>startAnalysis('align',null,[captionTimeline.selected]);
$('#editing-align-all').onclick=()=>startAnalysis('align');
$('#editing-check-runtime').onclick=async()=>{const button=$('#editing-check-runtime');button.disabled=true;$('#editing-model').textContent='Checking the local caption engine…';try{renderCaptionHealth(await api('/api/editing/'+editor.asset.id,{action:'check-runtime'}));}catch(error){$('#editing-error').textContent=error.message;}finally{button.disabled=false;}};
$('#editing-select').onclick=()=>{
 editingMedia().pause();seekEditing(0);editor.selecting=true;editor.box=null;$('#editing-track').disabled=true;
 $('#editing-first-frame').src='/api/editing/'+editor.asset.id+'/frame?t=0';$('#editing-first-frame').hidden=false;$('#editing-video').hidden=true;
 $('#editing-overlay').classList.add('selecting');$('#editing-selection-note').textContent='Drag a box around your subject. The selection starts on the first frame.';drawEditingOverlay();
};
let boxStart=null;
function pointerPercent(event){const r=$('#editing-overlay').getBoundingClientRect();return [Math.max(0,Math.min(100,(event.clientX-r.left)/r.width*100)),Math.max(0,Math.min(100,(event.clientY-r.top)/r.height*100))];}
$('#editing-overlay').onpointerdown=event=>{if(!editor.selecting)return;boxStart=pointerPercent(event);event.currentTarget.setPointerCapture(event.pointerId);};
$('#editing-overlay').onpointermove=event=>{if(!boxStart)return;const p=pointerPercent(event);editor.box=[Math.min(p[0],boxStart[0]),Math.min(p[1],boxStart[1]),Math.abs(p[0]-boxStart[0]),Math.abs(p[1]-boxStart[1])].map(x=>Math.round(x*100)/100);drawEditingOverlay();};
$('#editing-overlay').onpointerup=()=>{if(!boxStart)return;boxStart=null;const valid=editor.box&&editor.box[2]>=2&&editor.box[3]>=2;$('#editing-track').disabled=!valid;$('#editing-selection-note').textContent=valid?'Subject selected. Track it, or draw again to change the selection.':'Draw a larger box (at least 2% of the frame).';};
$('#editing-overlay').onpointercancel=()=>{boxStart=null;};
for(const name of ['video','audio'])$('#editing-'+name).ontimeupdate=()=>{if(document.activeElement!==$('#editing-time'))$('#editing-time').value=editingMedia().currentTime.toFixed(3);syncEditingPosition();};
$('#editing-video').onloadedmetadata=()=>{const v=$('#editing-video');$('#editing-media-wrap').style.aspectRatio=`${v.videoWidth}/${v.videoHeight}`;$('#editing-media-wrap').dataset.aspect=v.videoWidth/v.videoHeight;$('#editing-media-wrap').style.setProperty('--editing-aspect',v.videoWidth/v.videoHeight);drawEditingOverlay();};
$('#editing-first-frame').onload=()=>{const image=$('#editing-first-frame');$('#editing-media-wrap').style.aspectRatio=`${image.naturalWidth}/${image.naturalHeight}`;$('#editing-media-wrap').dataset.aspect=image.naturalWidth/image.naturalHeight;drawEditingOverlay();};
$('#editing-time').onchange=()=>{editor.selecting=false;$('#editing-first-frame').hidden=true;$('#editing-video').hidden=false;$('#editing-overlay').classList.remove('selecting');seekEditing(editingTime());};
$('#editing-time').oninput=event=>{if(event.target.value!==''&&event.target.validity.valid)seekEditing(editingTime(),true);};
$('#editing-ratio').onchange=drawEditingOverlay;
$('#editing-x').oninput=$('#editing-y').oninput=drawEditingOverlay;
$('#editing-keyframe').onclick=()=>{const t=Math.round(editingTime()*100)/100,p={t,x:Number($('#editing-x').value),y:Number($('#editing-y').value)};editor.doc.points=editor.doc.points.filter(point=>Math.abs(point.t-t)>.005);editor.doc.points.push(p);editor.doc.points.sort((a,b)=>a.t-b.t);editingChanged();renderKeyframes();};
$('#editing-add-cue').onclick=()=>{const start=editingTime(),end=Math.min(editor.asset.metadata.duration,start+2);editor.doc.cues.push({start,end,text:'New caption'});editingChanged();renderCues();};
$('#editing-cues').oninput=event=>{const field=event.target.dataset.cueField;if(!field)return;const index=Number(event.target.closest('[data-cue]').dataset.cue);const cue=editor.doc.cues[index];cue[field]=field==='text'?event.target.value:Number(event.target.value);cue.words=estimateCaptionWords(cue);cue.timing='estimated';fillWordFields(event.target.closest('[data-cue]').querySelector('details'));editingChanged();};
for(const key of ['position','size','margin'])$('#editing-caption-'+key).oninput=event=>{editor.doc.style[key]=key==='position'?event.target.value:Number(event.target.value);editingChanged();};
$('#editing-save').onclick=async()=>{try{$('#editing-error').textContent='';await saveEditing();}catch(error){$('#editing-error').textContent=error.message;}};
$('#editing-export').onclick=async()=>{try{await saveEditing();editingDialog.close();await openExport();}catch(error){$('#editing-error').textContent=error.message;}};
editingDialog.addEventListener('click',async event=>{
 const target=event.target.closest('button');if(!target)return;
 try{
  if(target.dataset.point!==undefined){seekEditing(editor.doc.points[Number(target.dataset.point)].t);}
  if(target.dataset.removePoint!==undefined){editor.doc.points.splice(Number(target.dataset.removePoint),1);editingChanged();renderKeyframes();}
  if(target.dataset.cueSeek!==undefined)seekEditing(editor.doc.cues[Number(target.dataset.cueSeek)].start);
  if(target.dataset.removeCue!==undefined){editor.doc.cues.splice(Number(target.dataset.removeCue),1);editingChanged();renderCues();}
  if(target.dataset.cancelAnalysis){await api('/api/assist-jobs/'+target.dataset.cancelAnalysis,{action:'cancel'});await pollEditing();}
  if(target.dataset.applyAnalysis){const job=editor.jobs.find(j=>j.id===target.dataset.applyAnalysis);if(job.task==='align'){editingMedia().pause();commitTimeline(CaptionAlignment.apply(editor.doc.cues,job.result),editor.doc.cues,'Aligned word timing applied. Review playback, then save.');$('#editing-error').textContent='';return;}const field=job.task==='track'?'points':'cues';editor.doc[field]=structuredClone(job.result[field]);if(field==='cues')editor.doc.cues.forEach(c=>prepareCaptionCue(c,job.result.words||[]));editingChanged();renderKeyframes();renderCues();syncEditingPosition();toast('Result applied to your draft. Review and save when ready.');}
 }catch(error){$('#editing-error').textContent=error.message;}
});
document.addEventListener('studio:workspace',()=>{const asset=selectedAsset();editButton.disabled=!asset||!['video','audio'].includes(asset.kind)||state.comparing;pollEditing();});
// Asset selection updates synchronously; keep the finishing entry point in step.
const editObserver=new MutationObserver(()=>{const asset=selectedAsset();editButton.disabled=!asset||!['video','audio'].includes(asset.kind)||state.comparing;});
editObserver.observe($('#asset-title'),{childList:true,subtree:true});
// Explicit names keep wrapped select labels consistent across assistive tools.
for(const [id,label] of Object.entries({'editing-language':'Speech language','editing-ratio':'Crop preview','editing-caption-position':'Caption position','editing-caption-size':'Text size','editing-caption-margin':'Edge inset %'}))$('#'+id).setAttribute('aria-label',label);
$('#editing-save').insertAdjacentHTML('beforebegin','<button id="editing-reload" class="button secondary">Reload saved edits</button>');
$('#editing-reload').onclick=async()=>{try{const data=await api('/api/editing/'+editor.asset.id);editor.doc=data.document;editor.dirty=false;editor.drafts.delete(editor.asset.id);resetCaptionPhrasePreview();resetReadabilityFixes();resetCaptionTimeline();syncCaptionStyleControls();await loadCaptionStyles();renderCues();renderKeyframes();syncEditingPosition();$('#editing-error').textContent='';$('#editing-save-state').textContent='Saved locally · version '+editor.doc.revision;}catch(error){$('#editing-error').textContent=error.message;}};

// Export uses explicit opt-ins and a saved revision, never an unsaved editor draft.
$('#export-fps-row').insertAdjacentHTML('afterend',`<section id="export-edit-options" hidden><h3>Saved finishing edits</h3><label class="export-check"><input type="checkbox" id="export-follow">Follow saved subject path</label><label class="export-check"><input type="checkbox" id="export-captions">Burn in saved captions</label><p id="export-edit-summary" class="field-note"></p><button class="button secondary" type="button" id="export-open-editor">Edit framing & captions</button></section>`);
$('.export-preview-column').insertAdjacentHTML('beforeend','<label id="export-time-row" hidden>Preview time <input id="export-time" type="range" min="0" max="0" step="0.1" value="0"><span id="export-time-label">0.0s</span></label>');
const originalExportOptions=exportOptions;
exportOptions=function(){const options=originalExportOptions();if(social.asset.kind==='video')Object.assign(options,{use_reframe:$('#export-follow').checked,burn_captions:$('#export-captions').checked,editing_revision:social.editDocument?.revision||0,time:Number($('#export-time').value)});return options;};
const originalOpenExport=openExport;
openExport=async function(){await originalOpenExport();if(!exportDialog.open)return;$('#export-follow').checked=false;$('#export-captions').checked=false;$('#export-time').value='0';$('#export-time-label').textContent='0.0s';$('#export-edit-options').hidden=social.asset.kind!=='video';$('#export-time-row').hidden=social.asset.kind!=='video';social.editDocument=null;if(social.asset.kind==='video'){try{const data=await api('/api/editing/'+social.asset.id);social.editDocument=data.document;$('#export-follow').disabled=!data.document.points.length;$('#export-captions').disabled=!data.document.cues.length;$('#export-time').max=String(Math.max(0,(social.asset.metadata.duration||0)-.05));$('#export-edit-summary').textContent=`Version ${data.document.revision} · ${data.document.points.length} crop keyframes · ${data.document.cues.length} captions`; }catch(error){$('#export-error').textContent=error.message;}}updateExportOptions();};
$('#export-button').onclick=openExport;
$('#export-follow').onchange=()=>{if($('#export-follow').checked)$('#export-fit').value='crop';updateExportOptions();};
$('#export-fit').addEventListener('input',()=>{if($('#export-fit').value!=='crop')$('#export-follow').checked=false;updateExportOptions();});
$('#export-captions').onchange=updateExportOptions;
$('#export-time').oninput=()=>{$('#export-time-label').textContent=Number($('#export-time').value).toFixed(1)+'s';updateExportOptions();};
$('#export-open-editor').onclick=()=>{exportDialog.close();openEditing();};
$('.export-preview-column > p').textContent='Guide is approximate and is never included in the export. Scrub Preview time to review motion and captions.';
let analysisQueueSignature='';
document.addEventListener('studio:workspace',()=>{
 let section=$('#analysis-queue-section');if(!section){section=document.createElement('section');section.id='analysis-queue-section';section.className='export-queue-section';$('#queue-drawer').append(section);}
 const jobs=(state.analysis||[]).slice(0,8),signature=JSON.stringify(jobs);if(signature===analysisQueueSignature)return;analysisQueueSignature=signature;
 section.hidden=!jobs.length;section.innerHTML='<h3>Local analysis</h3><p class="field-note">Open the source in Reframe & captions to review and apply a result.</p>'+jobs.map(j=>`<article class="editing-job"><strong>${j.task==='track'?'Subject tracking':j.task==='align'?'Caption alignment':'Transcription'} · ${escapeHTML(j.state)}</strong>${['queued','running','cancelling'].includes(j.state)?`<progress max="1" value="${j.progress}" aria-label="Analysis progress"></progress>`:''}<button class="button secondary" data-analysis-source="${j.asset_id}">Open source & edits</button></article>`).join('');
});
document.addEventListener('click',async event=>{const button=event.target.closest('[data-analysis-source]');if(!button)return;const asset=state.assets.find(a=>a.id===button.dataset.analysisSource);if(asset){if(asset.project_id!==state.project)await changeProject(asset.project_id);selectAsset(asset.id);toggleQueue(false);openEditing();}});

setupCaptionStyles();

setupCaptionTimeline();

setupCaptionPhrases();

setupCaptionReadability();

setupReadabilityFixes();
