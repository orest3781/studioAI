'use strict';
const batchFormats={reels:['Instagram Reels','9:16'],tiktok:['TikTok','9:16'],shorts:['YouTube Shorts','9:16'],portrait:['Portrait feed','4:5'],square:['Square feed','1:1'],landscape:['Landscape','16:9']};
const batch={plan:null,request:null,busy:false,current:null,polling:false,version:0,blob:null,controller:null,queueKey:'',detailKey:'',selectionProject:state.project};
const savedBatchSelection=readLocal('studio-batch-selection-v1',{});
state.batchSelection=savedBatchSelection.project===state.project&&Array.isArray(savedBatchSelection.ids)?savedBatchSelection.ids.slice(0,50):[];
state.batchSelecting=state.batchSelection.length>0;
document.body.insertAdjacentHTML('beforeend',`<dialog id="batch-dialog" aria-labelledby="batch-title">
 <div class="dialog-heading"><div><span class="eyebrow">LOCAL DELIVERY SET</span><h2 id="batch-title">Batch social exports</h2></div><button id="batch-close" class="icon-button" aria-label="Close batch exports">×</button></div>
 <section id="batch-compose"><p class="field-note">One delivery set for your selected assets. Saved edits are copied into each output; your originals stay unchanged.</p>
  <div class="batch-compose-layout"><section><h3>Selected assets <span id="batch-selected-count"></span></h3><div id="batch-selected-assets" class="batch-selected-assets"></div><button id="batch-change-selection" class="button secondary">Change selection in Library</button></section>
  <section class="batch-settings"><fieldset id="batch-formats"><legend>Delivery formats</legend>${Object.entries(batchFormats).map(([id,[name,ratio]])=>`<label class="batch-format"><input type="checkbox" name="batch-format" value="${id}" ${id==='landscape'?'':'checked'}><span>${name}<small>${ratio}</small></span></label>`).join('')}</fieldset>
   <div class="form-row"><label>Resolution<select id="batch-size" aria-label="Batch resolution"><option value="1080">Full HD · 1080</option><option value="720">Smaller file · 720</option></select></label><label>Image format<select id="batch-image-format" aria-label="Batch image format"><option value="png">PNG · retain transparency</option><option value="jpg">JPEG · smaller file</option></select></label></div>
   <label class="batch-edit-check"><input type="checkbox" id="batch-framing" checked>Use saved subject tracking when available</label><label class="batch-edit-check"><input type="checkbox" id="batch-captions" checked>Burn in saved captions when available</label>
   <label>Fallback framing<select id="batch-fallback" aria-label="Fallback framing"><option value="contain">Fit · keep the full image</option><option value="blur">Fit · blurred background</option><option value="crop">Fill · centered crop</option></select></label>
   <p class="field-note">Tracking uses Fill with each asset’s saved crop path. Without a path, use the fallback above. Videos stay MP4; images stay still images. Audio and duration are preserved.</p>
  </section></div>
  <div class="batch-review-actions"><span id="batch-estimate" role="status"></span><button id="batch-review" class="button secondary">Review batch</button><button id="batch-start" class="button primary" disabled>Start exports</button></div>
  <section id="batch-review-panel" hidden><h3>Ready to deliver</h3><p id="batch-plan-summary" class="field-note"></p><div id="batch-review-assets"></div><details class="batch-preview-details"><summary>Preview a delivery format</summary><div class="form-row"><label>Asset<select id="batch-preview-asset" aria-label="Batch preview asset"></select></label><label>Format<select id="batch-preview-format" aria-label="Batch preview format"></select></label></div><label id="batch-preview-time-row">Preview time<input id="batch-preview-time" type="range" min="0" step="0.1" value="0" aria-label="Batch preview time"><span id="batch-preview-time-label">0.0s</span></label><div class="batch-preview-wrap"><img id="batch-preview-image" alt="Batch delivery preview"></div><span id="batch-preview-status" class="field-note" role="status"></span></details></section>
 </section>
 <section id="batch-status" hidden><div id="batch-status-summary" aria-live="polite"></div><div id="batch-status-actions" class="batch-status-actions"></div><div id="batch-results"></div></section>
 <p id="batch-error" class="error-text" role="alert"></p>
</dialog>`);
const batchDialog=$('#batch-dialog');
function persistBatchSelection(){try{localStorage.setItem('studio-batch-selection-v1',JSON.stringify({project:state.project,ids:state.batchSelection}));}catch{}}
function batchToolbar(){
 if(batch.selectionProject!==state.project){state.batchSelection=[];state.batchSelecting=false;batch.selectionProject=state.project;}
 if(state.assets.length)state.batchSelection=state.batchSelection.filter(id=>projectAssets().some(a=>a.id===id&&a.kind!=='audio'));
 persistBatchSelection();const tools=$('#library-board .library-tools');if(!tools)return;
 $('#library-batch-bar')?.remove();
 const visible=filteredAssets().filter(a=>a.kind!=='audio'),hidden=state.batchSelection.filter(id=>!visible.some(a=>a.id===id)).length;
 tools.insertAdjacentHTML('afterend',`<div id="library-batch-bar"><div><button class="button secondary" data-batch-select-mode aria-pressed="${state.batchSelecting}">${state.batchSelecting?'Done selecting':'Select for export'}</button>${state.batchSelecting?'<button class="button secondary" data-batch-select-visible>Select visible</button>':''}<button class="button secondary" data-batch-clear ${state.batchSelection.length?'':'disabled'}>Clear</button></div><span class="field-note">${state.batchSelection.length} selected${hidden?` · ${hidden} hidden by filters`:''}</span><button class="button primary" data-batch-open ${state.batchSelection.length?'':'disabled'}>Batch export${state.batchSelection.length?' ('+state.batchSelection.length+')':''}</button></div>`);
}
function toggleBatchAsset(id,checked){
 if(checked&&!state.batchSelection.includes(id)){if(state.batchSelection.length>=50){toast('A batch supports up to 50 assets.',true);return;}state.batchSelection.push(id);}
 if(!checked)state.batchSelection=state.batchSelection.filter(x=>x!==id);
 persistBatchSelection();renderAssets();
}
function batchSettings(){return {asset_ids:[...state.batchSelection],presets:[...document.querySelectorAll('[name=batch-format]:checked')].map(i=>i.value),size:Number($('#batch-size').value),image_format:$('#batch-image-format').value,fallback:$('#batch-fallback').value,use_saved_framing:$('#batch-framing').checked,include_captions:$('#batch-captions').checked};}
function invalidateBatch(){batch.plan=null;batch.request=null;batch.version++;batch.controller?.abort();$('#batch-review-panel').hidden=true;$('#batch-start').disabled=true;$('#batch-error').textContent='';const s=batchSettings();$('#batch-estimate').textContent=`${s.asset_ids.length} assets × ${s.presets.length} formats = ${s.asset_ids.length*s.presets.length} exports`;$('#batch-review').disabled=batch.busy||!s.presets.length;}
function openBatch(){
 if(!state.batchSelection.length)return;batch.current=null;batch.detailKey='';$('#batch-compose').hidden=false;$('#batch-status').hidden=true;
 $('#batch-selected-count').textContent='('+state.batchSelection.length+')';
 $('#batch-selected-assets').innerHTML=state.batchSelection.map(id=>state.assets.find(a=>a.id===id)).filter(Boolean).map(a=>`<div class="batch-selected"><img src="${a.thumbnail}" alt=""><div><strong>${escapeHTML(a.name)}</strong><span class="field-note">${escapeHTML(assetInfo(a))}</span></div></div>`).join('');
 const saved=readLocal('studio-batch-settings-v1',{});
 if([720,1080].includes(saved.size))$('#batch-size').value=String(saved.size);
 if(['png','jpg'].includes(saved.image_format))$('#batch-image-format').value=saved.image_format;
 if(['contain','crop','blur'].includes(saved.fallback))$('#batch-fallback').value=saved.fallback;
 if(Array.isArray(saved.presets)&&saved.presets.some(p=>batchFormats[p]))document.querySelectorAll('[name=batch-format]').forEach(i=>i.checked=saved.presets.includes(i.value));
 if(typeof saved.use_saved_framing==='boolean')$('#batch-framing').checked=saved.use_saved_framing;
 if(typeof saved.include_captions==='boolean')$('#batch-captions').checked=saved.include_captions;
 invalidateBatch();batchDialog.showModal();
}
async function reviewBatch(){
 const settings=batchSettings(),signature=JSON.stringify(settings);batch.busy=true;$('#batch-review').disabled=true;$('#batch-error').textContent='';
 try{
  const plan=await api('/api/export-batches/prepare',settings);
  if(!batchDialog.open||signature!==JSON.stringify(batchSettings()))return;
  batch.plan=plan;batch.request={id:crypto.randomUUID(),settings,review_token:plan.review_token};
  try{localStorage.setItem('studio-batch-settings-v1',JSON.stringify({...settings,asset_ids:undefined}));}catch{}
  $('#batch-start').textContent=`Start ${plan.total} exports`;$('#batch-start').disabled=false;$('#batch-review-panel').hidden=false;
  $('#batch-plan-summary').textContent=`${plan.total} outputs · Tracking: ${plan.assets.filter(a=>a.tracked).length}/${plan.assets.length} assets · Captions: ${plan.assets.filter(a=>a.captions).length}/${plan.assets.length} assets. The same saved path is adapted to each ratio. Existing files are kept.`;
  $('#batch-review-assets').innerHTML=plan.assets.map(a=>`<article class="batch-plan-asset"><strong>${escapeHTML(a.name)}</strong><span>${a.tracked?'Saved subject path':a.fit==='contain'?'Fit':a.fit==='blur'?'Blurred background':'Centered crop'} · ${a.captions?a.captions+' captions':'No captions'}${a.kind==='video'?' · saved version '+a.revision:''}</span><div class="batch-format-chips">${plan.rows.filter(r=>r.asset_id===a.id).map(r=>`<span>${batchFormats[r.preset][0]} · ${r.options.width}×${r.options.height} · ${r.options.format.toUpperCase()}</span>`).join('')}</div>${a.notes.map(n=>`<p class="field-note">${escapeHTML(n)}</p>`).join('')}</article>`).join('');
  $('#batch-preview-asset').innerHTML=plan.assets.map(a=>`<option value="${a.id}">${escapeHTML(a.name)}</option>`).join('');
  $('#batch-preview-format').innerHTML=settings.presets.map(p=>`<option value="${p}">${batchFormats[p][0]}</option>`).join('');
  $('#batch-preview-time').value='0';batchPreviewAsset();
 }catch(error){$('#batch-error').textContent=error.message;}
 finally{batch.busy=false;$('#batch-review').disabled=false;}
}
function batchPreviewAsset(){const asset=state.assets.find(a=>a.id===$('#batch-preview-asset').value);$('#batch-preview-time-row').hidden=asset?.kind!=='video';$('#batch-preview-time').max=String(Math.max(0,(asset?.metadata.duration||0)-.05));$('#batch-preview-time').value='0';scheduleBatchPreview();}
function scheduleBatchPreview(){batch.version++;batch.controller?.abort();clearTimeout(batch.timer);const version=batch.version;$('#batch-preview-time-label').textContent=Number($('#batch-preview-time').value).toFixed(1)+'s';batch.timer=setTimeout(()=>previewBatch(version),180);}
async function previewBatch(version){
 if(!batch.plan||!$('.batch-preview-details').open||!batchDialog.open)return;
 const id=$('#batch-preview-asset').value,preset=$('#batch-preview-format').value,row=batch.plan.rows.find(r=>r.asset_id===id&&r.preset===preset),asset=batch.plan.assets.find(a=>a.id===id);if(!row)return;
 const controller=new AbortController();batch.controller=controller;$('#batch-preview-status').textContent='Updating preview…';
 try{
  const response=await fetch('/api/exports/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({asset_id:id,...row.options,use_reframe:asset.tracked,burn_captions:!!asset.captions,editing_revision:asset.revision,time:Number($('#batch-preview-time').value)}),signal:controller.signal});
  if(!response.ok){const error=await response.json();throw Error(error.error||'Preview unavailable');}
  const blob=await response.blob();if(version!==batch.version||!batchDialog.open)return;
  if(batch.blob)URL.revokeObjectURL(batch.blob);batch.blob=URL.createObjectURL(blob);$('#batch-preview-image').src=batch.blob;
  $('.batch-preview-wrap').style.aspectRatio=`${row.options.width}/${row.options.height}`;
  $('.batch-preview-wrap').style.width=`min(100%, ${Math.min(320,400*row.options.width/row.options.height)}px)`;
  $('#batch-preview-status').textContent='Delivery preview · '+batchFormats[preset][0];
 }catch(error){if(error.name!=='AbortError')$('#batch-preview-status').textContent=error.message;}
}
function batchStateLabel(info){return {running:'Exporting',queued:'Waiting',completed:'Ready',needs_attention:'Needs attention',cancelled:'Cancelled'}[info.state]||info.state;}
function batchActions(info){return `${!info.active&&info.ready?`<a class="button primary" href="/api/export-batches/${info.id}/download" download>${info.ready===info.total?'Download ZIP':'Download ready files ('+info.ready+')'}</a>`:''}${info.active?`<button class="button secondary" data-batch-action="cancel" data-batch-id="${info.id}">Cancel remaining</button>`:''}${info.retryable?`<button class="button secondary" data-batch-action="retry" data-batch-id="${info.id}">Retry unfinished (${info.retryable})</button>`:''}`;}
function renderBatchDetail(info){
 const key=JSON.stringify(info);if(key===batch.detailKey)return;batch.detailKey=key;
 $('#batch-status-summary').innerHTML=`<span class="eyebrow">${escapeHTML(batchStateLabel(info))}</span><h3>${info.ready} of ${info.total} files ready</h3><progress max="1" value="${info.progress}" aria-label="Batch progress"></progress><p class="field-note">${info.settings.asset_ids.length} assets · ${info.settings.presets.map(p=>batchFormats[p][0]).join(', ')} · ${new Date(info.created*1000).toLocaleString()}<br>Saved edits are fixed for this batch. Retry only reruns unfinished outputs. ZIP includes ready media, caption sidecars when used, and a delivery manifest.</p>`;
 $('#batch-status-actions').innerHTML=batchActions(info);
 $('#batch-results').innerHTML=info.jobs.map(j=>`<article class="batch-result"><div><strong>${escapeHTML(j.name)}</strong><span>${batchFormats[j.preset][0]} · ${j.options.width}×${j.options.height} · ${j.options.format.toUpperCase()}${j.options.edit_snapshot?.points.length?' · tracked':''}${j.options.edit_snapshot?.cues.length?' · captioned':''}</span>${j.error?`<p class="error-text">${escapeHTML(j.error)}</p>`:''}</div><span class="job-state ${j.state}">${{completed:'Ready',queued:'Waiting',running:'Exporting'}[j.state]||j.state}</span>${j.state==='completed'?`<a class="button secondary" href="/api/assets/${j.output_asset_id}/file?download=1" download>Download</a>`:''}</article>`).join('');
}
async function openBatchStatus(id){batch.current=id;batch.detailKey='';$('#batch-compose').hidden=true;$('#batch-status').hidden=false;$('#batch-error').textContent='';if(!batchDialog.open)batchDialog.showModal();await pollBatch();}
async function pollBatch(){if(!batch.current||!batchDialog.open||batch.polling)return;batch.polling=true;const id=batch.current;try{const info=await api('/api/export-batches/'+id);if(batch.current===id)renderBatchDetail(info);}catch(error){$('#batch-error').textContent=error.message;}finally{batch.polling=false;}}
function renderBatchQueue(){
 let section=$('#batch-queue-section');if(!section){section=document.createElement('section');section.id='batch-queue-section';section.className='export-queue-section';$('#queue-drawer').append(section);}
 const batches=state.batches||[],visible=[...batches.filter(b=>b.active),...batches.filter(b=>!b.active).slice(0,10)],key=JSON.stringify(visible);
 if(key!==batch.queueKey){batch.queueKey=key;section.hidden=!visible.length;section.innerHTML='<h3>Batch deliveries</h3>'+visible.map(info=>`<article class="batch-queue-card"><strong>${info.settings.asset_ids.length} assets · ${info.total} exports <span class="job-state">${batchStateLabel(info)}</span></strong><span class="field-note">${info.settings.presets.map(p=>batchFormats[p][0]).join(', ')}<br>${info.ready}/${info.total} files ready</span><progress max="1" value="${info.progress}" aria-label="Batch progress"></progress><div class="batch-status-actions"><button class="button secondary" data-batch-view="${info.id}">View batch</button>${batchActions(info)}</div></article>`).join('');}
 pollBatch();
}
$('#batch-close').onclick=()=>batchDialog.close();$('#batch-change-selection').onclick=()=>{batchDialog.close();state.batchSelecting=true;setView('library');renderAssets();};
$('#batch-review').onclick=reviewBatch;
$('#batch-start').onclick=async()=>{
 if(!batch.request||batch.busy)return;batch.busy=true;$('#batch-start').disabled=true;$('#batch-error').textContent='';
 try{const result=await api('/api/export-batches',{...batch.request.settings,review_token:batch.request.review_token,request_id:batch.request.id});await openBatchStatus(result.id);await refreshWorkspace();toast('Batch queued locally. You can keep creating.');}
 catch(error){$('#batch-error').textContent=error.message;}
 finally{batch.busy=false;$('#batch-start').disabled=!batch.request;}
};
for(const id of ['batch-size','batch-image-format','batch-fallback','batch-framing','batch-captions'])$('#'+id).onchange=invalidateBatch;
$('#batch-formats').onchange=invalidateBatch;
$('#batch-preview-asset').onchange=batchPreviewAsset;$('#batch-preview-format').onchange=scheduleBatchPreview;$('#batch-preview-time').oninput=scheduleBatchPreview;
$('.batch-preview-details').ontoggle=()=>{if($('.batch-preview-details').open)scheduleBatchPreview();};
batchDialog.addEventListener('close',()=>{batch.version++;clearTimeout(batch.timer);batch.controller?.abort();});
document.addEventListener('studio:assets',batchToolbar);document.addEventListener('studio:workspace',renderBatchQueue);
document.addEventListener('change',event=>{if(event.target.dataset.batchCheck){const id=event.target.dataset.batchCheck;toggleBatchAsset(id,event.target.checked);document.querySelector(`#library-board [data-batch-check="${id}"]`)?.focus();}});
document.addEventListener('click',async event=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.dataset.batchPick){const id=button.dataset.batchPick;toggleBatchAsset(id,!state.batchSelection.includes(id));document.querySelector(`#library-board [data-batch-pick="${id}"]`)?.focus();return;}
 if(button.hasAttribute('data-batch-select-mode')){state.batchSelecting=!state.batchSelecting;renderAssets();return;}
 if(button.hasAttribute('data-batch-select-visible')){const ids=filteredAssets().filter(a=>a.kind!=='audio').map(a=>a.id),selected=[...new Set([...state.batchSelection,...ids])];if(selected.length>50){toast('Select up to 50 assets. Narrow the library filters first.',true);return;}state.batchSelection=selected;renderAssets();return;}
 if(button.hasAttribute('data-batch-clear')){state.batchSelection=[];renderAssets();return;}
 if(button.hasAttribute('data-batch-open')){openBatch();return;}
 if(button.dataset.batchView){toggleQueue(false);await openBatchStatus(button.dataset.batchView);return;}
 if(button.dataset.batchAction){button.disabled=true;try{await api('/api/export-batches/'+button.dataset.batchId,{action:button.dataset.batchAction});await refreshWorkspace();await pollBatch();}catch(error){if(batchDialog.open)$('#batch-error').textContent=error.message;else toast(error.message,true);}finally{button.disabled=false;}}
});
if(state.assets.length)renderAssets();else batchToolbar();
