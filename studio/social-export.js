'use strict';
const social = {catalog:null, asset:null, pending:null, timer:null, controller:null, blob:null, version:0, queueKey:'', historyKey:'', busy:false};
const exportDialog = $('#export-dialog');
function exportOptions() {
  return {asset_id:social.asset.id,preset:$('#export-preset').value,ratio:$('#export-ratio').value,
    size:Number($('#export-size').value),fit:$('#export-fit').value,format:$('#export-format').value,
    background:$('#export-background').value,fps:$('#export-fps').value,x:Number($('#export-x').value),y:Number($('#export-y').value)};
}
async function openExport() {
  const asset=selectedAsset();if(!asset)return;
  try {
    if(!social.catalog)social.catalog=await api('/api/export-presets');
    social.asset=asset;social.pending=null;social.historyKey='';
    $('#export-source').textContent=asset.name+' · '+assetInfo(asset);
    $('#export-original').href=asset.url+'?download=1';
    const supported=['image','video'].includes(asset.kind);
    $('.export-layout').hidden=!supported;
    if(!supported){window.location.href=asset.url+'?download=1';return;}
    $('#export-preset').innerHTML=Object.entries(social.catalog.presets).map(([id,p])=>`<option value="${id}">${escapeHTML(p.name)}</option>`).join('');
    let saved=readLocal('studio-export-settings-v1',{});
    if(!social.catalog.presets[saved.preset])saved={preset:'reels',size:1080,fit:'contain'};
    $('#export-preset').value=saved.preset;
    $('#export-ratio').value=saved.ratio||social.catalog.presets[saved.preset].ratio;
    $('#export-size').value=String(saved.size||1080);$('#export-fit').value=saved.fit||'contain';
    $('#export-format').innerHTML=asset.kind==='video'?'<option value="mp4">MP4 · H.264 + AAC</option>':'<option value="png">PNG · lossless</option><option value="jpg">JPEG · smaller file</option>';
    $('#export-background').value=asset.kind==='image'&&asset.metadata.alpha?'transparent':'black';
    $('#export-fps').value=social.catalog.presets[saved.preset].fps;
    $('#export-x').value=50;$('#export-y').value=50;
    $('#export-fps-row').hidden=asset.kind!=='video';$('#export-error').textContent='';
    $('#export-preview').removeAttribute('src');
    exportDialog.showModal();updateExportOptions();renderExportHistory();
  }catch(error){toast(error.message,true);}
}
function updateExportOptions() {
  const image=social.asset.kind==='image', transparent=$('#export-format').value==='png'&&$('#export-fit').value!=='blur';
  $('#export-background option[value=transparent]').disabled=!transparent;
  if(!transparent&&$('#export-background').value==='transparent')$('#export-background').value='black';
  const o=exportOptions(),base=social.catalog.ratios[o.ratio],w=base[0]*o.size/1080,h=base[1]*o.size/1080,m=social.asset.metadata;
  $('#export-position').hidden=o.fit==='contain'||o.use_reframe;
  $('#export-preview-wrap').style.aspectRatio=`${w}/${h}`;
  $('#export-preview-wrap').style.setProperty('--preview-aspect',String(w/h));
  const fps=o.fps==='source'?`${Math.round((m.fps||30)*100)/100} fps source`:`${o.fps} fps`;
  $('#export-spec').textContent=`${w} × ${h} · ${o.ratio} · ${o.format.toUpperCase()}`+(image?'':` · ${fps} · ${durationText(m.duration||0)}`);
  const notes=[];
  if(m.width&&m.height){
    const scale=o.fit==='crop'?Math.max(w/m.width,h/m.height):Math.min(w/m.width,h/m.height);
    if(scale>1.01)notes.push(`Source is ${m.width} × ${m.height}. Export enlarges it; no new detail is generated.`);
    const retained=Math.min((w/h)/(m.width/m.height),(m.width/m.height)/(w/h));
    if(o.fit==='crop'&&retained<.9)notes.push(`Crop retains about ${Math.round(retained*100)}% of the source area. Adjust position or choose Fit.`);
  }
  if(!image&&o.preset==='reels'&&m.duration<3)notes.push('Under 3 seconds: shorter than the Reels publishing API minimum. Export keeps the original duration.');
  if(!image&&o.preset==='shorts'&&m.duration>180)notes.push('Over 3 minutes: outside the Shorts duration limit. Trim the source before publishing.');
  if(!image&&o.preset==='reels'&&o.fps==='source'&&(m.fps<23||m.fps>60))notes.push('Choose 30 fps for the Reels API’s 23–60 fps range.');
  if(!image&&o.fps!=='source'&&Math.abs(Number(o.fps)-(m.fps||30))>.1)notes.push('Frame-rate conversion repeats or drops frames; it does not create smoother motion.');
  if(image&&['reels','tiktok','shorts'].includes(o.preset))notes.push('Exports a still image for your edit, not a video.');
  notes.push('A separate asset is saved to this project. Your source stays unchanged.');
  if(o.use_reframe)notes.push('The saved subject path controls crop position. Make corrections in Reframe & captions.');
  $('#export-notes').textContent=notes.join(' ');
  $('#export-submit').disabled=social.busy||(!image&&!social.catalog.ffmpeg_available);
  if(!image&&!social.catalog.ffmpeg_available)$('#export-error').textContent='FFmpeg is required for video export.';
  try{localStorage.setItem('studio-export-settings-v1',JSON.stringify({preset:o.preset,ratio:o.ratio,size:o.size,fit:o.fit}));}catch{}
  clearTimeout(social.timer);social.version++;
  if(social.controller)social.controller.abort();
  $('#export-preview-state').textContent='Updating preview…';
  const version=social.version;
  social.timer=setTimeout(()=>refreshExportPreview(o,version),180);
}
async function refreshExportPreview(options,version) {
  const controller=new AbortController();social.controller=controller;
  try{
    const response=await fetch('/api/exports/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(options),signal:controller.signal});
    if(!response.ok){const error=await response.json();throw Error(error.error||'Preview unavailable');}
    const blob=await response.blob();if(version!==social.version||!exportDialog.open)return;
    if(social.blob)URL.revokeObjectURL(social.blob);social.blob=URL.createObjectURL(blob);
    $('#export-preview').src=social.blob;$('#export-preview-state').textContent='Framing preview';
  }catch(error){if(error.name!=='AbortError'&&version===social.version)$('#export-preview-state').textContent=error.message;}
}
function exportJobCard(job) {
  const labels={queued:'Waiting',running:'Exporting',cancelling:'Cancelling',completed:'Ready',failed:'Failed',cancelled:'Cancelled',interrupted:'Interrupted'};
  const o=job.options,done=job.state==='completed',active=['queued','running','cancelling'].includes(job.state);
  return `<article class="export-job"><div class="export-job-title"><strong>${escapeHTML(social.catalog?.presets[o.preset]?.name||o.preset)} · ${o.ratio}</strong><span class="job-state ${job.state}">${labels[job.state]}</span></div><span class="muted">${o.width} × ${o.height} · ${o.format.toUpperCase()} · ${o.fit==='crop'?'Crop':o.fit==='blur'?'Blurred background':'Fit'}</span>${active?`<progress max="1" value="${job.progress}" aria-label="Export progress"></progress>`:''}${job.error?`<span class="error-text">${escapeHTML(job.error)}</span>`:''}<div class="export-job-actions">${done?`<a class="button primary" href="/api/assets/${job.output_asset_id}/file?download=1" download>Download</a><button class="button secondary" data-export-view="${job.output_asset_id}">View asset</button>`:job.state==='queued'||job.state==='running'?`<button class="button secondary" data-export-action="cancel" data-export-id="${job.id}">Cancel export</button>`:!active?`<button class="button secondary" data-export-action="retry" data-export-id="${job.id}">Retry export</button>`:''}</div></article>`;
}
function renderExportHistory() {
  if(!social.asset||!exportDialog.open)return;
  const jobs=(state.exports||[]).filter(j=>j.asset_id===social.asset.id);
  const key=JSON.stringify(jobs);
  if(key!==social.historyKey){social.historyKey=key;$('#export-history').innerHTML=jobs.length?jobs.map(exportJobCard).join(''):'<p class="muted small">Your exported versions will appear here.</p>';}
}
function renderExportQueue() {
  let section=$('#export-queue-section');
  if(!section){section=document.createElement('section');section.id='export-queue-section';section.className='export-queue-section';$('#queue-drawer').append(section);}
  const all=state.exports||[],jobs=all.filter(j=>!j.options.batch_id),active=jobs.filter(j=>['queued','running','cancelling'].includes(j.state));
  const visible=[...active,...jobs.filter(j=>!active.includes(j)).slice(0,10)];
  const key=JSON.stringify(visible);
  if(key!==social.queueKey){social.queueKey=key;section.innerHTML='<h3>Social exports</h3><p class="field-note">Exports run on the CPU, independently of the GPU queue.</p>'+visible.map(exportJobCard).join('');section.hidden=!visible.length;}
  $('#queue-count').textContent=String(all.filter(j=>['queued','running','cancelling'].includes(j.state)).length+state.jobs.filter(j=>['queued','submitting','running','stopping'].includes(j.state)).length+(state.analysis||[]).filter(j=>['queued','running','cancelling'].includes(j.state)).length);
  renderExportHistory();
  const complete=all.filter(j=>j.state==='completed').map(j=>j.id).join(',');
  if(social.complete!==complete){social.complete=complete;refreshAssets().catch(()=>{});}
}
$('#export-button').onclick=openExport;
$('#export-close').onclick=()=>exportDialog.close();
exportDialog.addEventListener('close',()=>{clearTimeout(social.timer);social.version++;social.controller?.abort();});
$('#export-preset').onchange=()=>{const p=social.catalog.presets[$('#export-preset').value];$('#export-ratio').value=p.ratio;$('#export-fps').value=p.fps;updateExportOptions();};
$('#export-ratio').onchange=()=>{$('#export-preset').value='custom';updateExportOptions();};
['size','fit','format','background','fps','x','y'].forEach(id=>$('#export-'+id).oninput=updateExportOptions);
$('#export-guides').onchange=()=>$('#export-safe-guide').hidden=!$('#export-guides').checked;
$('#export-form').onsubmit=async event=>{
  event.preventDefault();if(social.busy)return;
  const options=exportOptions(),signature=JSON.stringify(options);
  if(social.pending?.signature!==signature)social.pending={signature,id:crypto.randomUUID()};
  social.busy=true;$('#export-submit').disabled=true;$('#export-error').textContent='';
  try{await api('/api/exports',{...options,request_id:social.pending.id});social.pending=null;await refreshWorkspace();toast('Export queued. You can keep creating.');}
  catch(error){$('#export-error').textContent=error.message;}
  finally{social.busy=false;$('#export-submit').disabled=false;}
};
document.addEventListener('studio:workspace',renderExportQueue);
document.addEventListener('click',async event=>{
  const action=event.target.closest('[data-export-action]'),view=event.target.closest('[data-export-view]');
  if(action){action.disabled=true;try{await api('/api/exports/'+action.dataset.exportId,{action:action.dataset.exportAction});await refreshWorkspace();}catch(error){toast(error.message,true);}finally{action.disabled=false;}}
  if(view){await refreshAssets();const asset=state.assets.find(a=>a.id===view.dataset.exportView);if(asset){exportDialog.close();toggleQueue(false);if(asset.project_id!==state.project)await changeProject(asset.project_id);selectAsset(asset.id);}}
});
