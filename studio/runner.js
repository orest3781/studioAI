const drafts = new Map();
try {
  for (const [id,d] of JSON.parse(localStorage.getItem('studio-drafts')||'[]')) {
    if(d&&typeof d==='object')drafts.set(id,{...d,busy:0,error:'',pending:null});
  }
} catch { /* A damaged saved draft should not stop the workspace. */ }
let runnerCatalog = {}, polling = false;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
fetch('/api/workflows').then(r => { if (!r.ok) throw Error(); return r.json(); }).then(data => { runnerCatalog=data; if(detailId) openDetail(detailId); }).catch(()=>{});
function draftFor(id) {
  if (!drafts.has(id)) drafts.set(id,{mode:'sample',quality:'preview',duration:0,prompt:runnerCatalog[id]?.prompt,uploads:{},point:null,busy:0,error:'',repeat:false});
  return drafts.get(id);
}
function openDetail(id) {
  detailId=id;
  const w=workflows.find(w=>w.id===id), spec=runnerCatalog[id], d=draftFor(id);
  const content=document.querySelector('#detail-content');
  if(!spec){content.innerHTML='<h2 id="detail-title">Loading workflow…</h2><p>Please wait for the controls to load.</p>';if(!dialog.open)dialog.showModal();return;}
  if(d.prompt==null)d.prompt=spec.prompt;
  if(!spec.quality[d.quality])d.quality='preview';
  if(!spec.durations?.some(option=>option.seconds===d.duration))d.duration=0;
  if(!spec.portrait||!['original','9:16'].includes(d.aspect_ratio))d.aspect_ratio='original';
  const qualityChoices=(d.aspect_ratio==='9:16'?spec.portrait[String(d.duration)]:null)||spec.durations?.find(option=>option.seconds===d.duration)?.quality||spec.quality;
  content.innerHTML=`<div class="eyebrow">${esc(w.category)} WORKFLOW</div><h2 id="detail-title">${esc(w.name)}</h2><p>${esc(w.description)}</p><p class="preview-note">${esc(spec.hint)}</p>
    <form id="render-form">
    ${spec.portrait?`<label class="duration-control">Generation canvas<select id="render-aspect" aria-label="Generation canvas"><option value="original" ${d.aspect_ratio==='original'?'selected':''}>Original recipe size</option><option value="9:16" ${d.aspect_ratio==='9:16'?'selected':''}>Portrait 9:16 · Reels, TikTok & Shorts</option></select></label><p class="field-note">Native portrait is composed at 9:16 without cropping the output.${id==='video'?' Use a 9:16 starting image for edge-to-edge video; other shapes fit with borders.':''}</p>`:''}
    ${spec.durations?.length?`<label class="duration-control">Duration<select id="clip-duration" aria-label="Duration">${spec.durations.map(option=>`<option value="${option.seconds}" ${d.duration===option.seconds?'selected':''}>${esc(option.label)}</option>`).join('')}</select></label><p class="field-note">Longer clips use settings fitted to your GPU.${spec.duration_source?` For 5 or 10 seconds, upload ${spec.duration_source} at least that long.`:''}</p>`:''}
    <fieldset class="mode-picker quality-picker"><legend>Quality</legend>${Object.entries(qualityChoices).map(([key,q])=>`<label><input type="radio" name="quality" value="${key}" ${d.quality===key?'checked':''}><span><strong>${esc(q.label)}</strong><small>${esc(q.description)}</small></span></label>`).join('')}</fieldset>
    ${spec.fields.length?`<fieldset class="mode-picker"><legend>Start with</legend><label><input type="radio" name="mode" value="sample" ${d.mode==='sample'?'checked':''}> Try the sample</label><label><input type="radio" name="mode" value="custom" ${d.mode==='custom'?'checked':''}> My files</label></fieldset>`:''}
    <div id="media-fields" ${d.mode==='sample'?'hidden':''}>${spec.fields.map(f=>`<label class="upload-field">${esc(f.label)}<input type="file" data-upload="${f.key}" accept="${f.kind==='video'?'video/*':f.kind==='audio'?'audio/*':'image/*'}"><span id="upload-${f.key}" class="field-note">${d.uploads[f.key]?'Ready · '+esc(d.uploads[f.key].label):'Choose a file · up to 100 MB'}</span></label>`).join('')}
    <div id="editor-wrap" hidden><p id="editor-help"></p><canvas id="media-editor" width="512" height="512" aria-label="Edit area" tabindex="0"></canvas><div id="brush-tools"><label>Brush size <input id="brush" type="range" min="8" max="100" value="35"></label><button type="button" id="clear-mask" class="secondary">Clear selection</button><button type="button" id="save-mask" class="secondary">Use painted area</button></div></div></div>
    ${spec.prompt!==null?`<label class="prompt-label">${id==='edit'?'What should change?':'Describe your result'}<textarea id="creative-prompt" rows="4" maxlength="4000" required>${esc(d.prompt)}</textarea></label>`:''}
    <label class="repeat-choice"><input id="repeat-variation" type="checkbox" ${d.repeat?'checked':''}> Use repeatable variation</label>
    <p id="form-error" class="form-error" role="alert"></p><button class="primary" id="run" type="submit">Create preview</button><p id="render-help"></p>
    </form><section id="job" class="job" aria-live="polite" hidden></section>
    <details class="technical"><summary>Technical details &amp; editor</summary><p>${esc(w.model)} · ${esc(smokeLabel(w))}</p><p>${esc(smokeScope(w))}</p><p>${esc(w.needs)}</p><div class="actions"><a class="secondary" href="/test-workflow/${id}.json" download>Download original test preset</a><a class="secondary" href="http://127.0.0.1:8188" target="_blank" rel="noopener">Open node editor ↗</a></div></details>`;
  if(!dialog.open)dialog.showModal();
  document.querySelector('#render-form').onsubmit=run;
  document.querySelector('#clip-duration')?.addEventListener('change',e=>{d.duration=Number(e.target.value);if(d.duration&&spec.duration_source)d.mode='custom';storeValue('studio-drafts',[...drafts]);openDetail(id);document.querySelector('#clip-duration').focus();});
  document.querySelector('#render-aspect')?.addEventListener('change',e=>{d.aspect_ratio=e.target.value;storeValue('studio-drafts',[...drafts]);openDetail(id);document.querySelector('#render-aspect').focus();});
  content.querySelectorAll('[name=quality]').forEach(el=>el.onchange=()=>{d.quality=el.value;storeValue('studio-drafts',[...drafts]);updateJobUI();});
  content.querySelectorAll('[name=mode]').forEach(el=>el.onchange=()=>{d.mode=el.value;openDetail(id);});
  document.querySelector('#creative-prompt')?.addEventListener('input',e=>{d.prompt=e.target.value;});
  document.querySelector('#repeat-variation').onchange=e=>d.repeat=e.target.checked;
  content.querySelectorAll('[data-upload]').forEach(el=>el.onchange=async()=>{
    const f=spec.fields.find(f=>f.key===el.dataset.upload), file=el.files[0];if(!file)return;
    d.busy++;d.error='';delete d.uploads[f.key];if((id==='inpaint'&&f.key==='image')||(id==='vace'&&f.key==='video'))delete d.uploads.mask;updateJobUI();
    document.querySelector('#upload-'+f.key).textContent='Preparing '+file.name+'…';
    try {const result=await uploadFile(file,f.kind);d.uploads[f.key]={...result,label:file.name};if(f.key==='video')d.point=null;
      if(detailId===id){document.querySelector('#upload-'+f.key).textContent='Ready · '+file.name;showUploads(id);setupEditor(id);}
    }catch(e){d.error=e.message;}finally{d.busy--;updateJobUI();}
  });
  showUploads(id);setupEditor(id);updateJobUI();
}
function showUploads(id){
  if(detailId!==id)return;
  const d=draftFor(id);
  for(const f of runnerCatalog[id].fields){
    const label=document.querySelector(`[data-upload="${f.key}"]`)?.parentElement;
    if(!label)continue;label.querySelector('.upload-preview')?.remove();
    const item=d.uploads[f.key];if(!item){document.querySelector('#upload-'+f.key).textContent=f.kind==='mask'?'Upload a mask or paint a selection':'Choose a file · up to 100 MB';continue;}
    const preview=document.createElement(f.kind==='audio'?'audio':'img');preview.className='upload-preview';preview.src=id==='video'&&d.aspect_ratio==='9:16'&&f.kind==='image'&&(item.source_name||item.source_preview)?'/api/media/'+item.token+'/source':item.preview;
    if(f.kind==='audio')preview.controls=true;else preview.alt=f.label+' preview';label.append(preview);
  }
}
async function uploadFile(file,kind) {
  if(file.size>100*1024*1024)throw Error('Choose a file under 100 MB.');
  const response=await fetch('/api/upload/'+kind,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
  const data=await response.json();if(!response.ok)throw Error(data.error);return data;
}
function setupEditor(id) {
  if(detailId!==id)return;
  const d=draftFor(id), pointMode=id==='animal', paintMode=['inpaint','vace'].includes(id);
  const source=d.uploads[id==='inpaint'?'image':'video'];
  if(d.mode!=='custom'||(!pointMode&&!paintMode)||!source)return;
  const canvas=document.querySelector('#media-editor'),wrap=document.querySelector('#editor-wrap');
  if(!canvas)return;wrap.hidden=false;canvas.height=id==='inpaint'?512:288;
  document.querySelector('#brush-tools').hidden=pointMode;
  document.querySelector('#editor-help').textContent=pointMode?'Click the performer to replace. The dot must sit inside their body.':'Paint the area to replace, then choose “Use painted area”. White areas will change.';
  const ctx=canvas.getContext('2d'), mask=document.createElement('canvas');mask.width=512;mask.height=canvas.height;
  const mc=mask.getContext('2d');mc.fillStyle='black';mc.fillRect(0,0,mask.width,mask.height);
  let img=new Image(), drawing=false, previous=null;
  const redraw=()=>{if(!img.complete||!img.naturalWidth)return;ctx.drawImage(img,0,0,canvas.width,canvas.height);if(pointMode&&d.point){ctx.fillStyle='#dcff83';ctx.beginPath();ctx.arc(d.point[0]*512,d.point[1]*canvas.height,7,0,Math.PI*2);ctx.fill();}else if(!pointMode){ctx.globalAlpha=.45;ctx.drawImage(mask,0,0);ctx.globalAlpha=1;}};
  img.onload=()=>{redraw();if(paintMode&&d.uploads.mask){const saved=new Image();saved.onload=()=>{mc.drawImage(saved,0,0,mask.width,mask.height);redraw();};saved.src=d.uploads.mask.preview;}};img.src=source.preview;
  const position=e=>{const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height];};
  const paint=e=>{const p=position(e);if(pointMode){d.point=p;redraw();updateJobUI();return;}
    mc.strokeStyle='white';mc.lineWidth=Number(document.querySelector('#brush').value);mc.lineCap='round';mc.beginPath();mc.moveTo(...(previous||[p[0]*512,p[1]*canvas.height]));mc.lineTo(p[0]*512+.01,p[1]*canvas.height);mc.stroke();previous=[p[0]*512,p[1]*canvas.height];delete d.uploads.mask;document.querySelector('#upload-mask').textContent='Selection changed · save the painted area';redraw();updateJobUI();};
  canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);drawing=true;previous=null;paint(e);};
  canvas.onpointermove=e=>{if(drawing&&!pointMode)paint(e);};canvas.onpointerup=()=>{drawing=false;previous=null;};
  if(pointMode){canvas.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();d.point=d.point||[.5,.5];}else if(e.key.startsWith('Arrow')){e.preventDefault();d.point=d.point||[.5,.5];const axis=['ArrowLeft','ArrowRight'].includes(e.key)?0:1;d.point[axis]=Math.max(0,Math.min(1,d.point[axis]+(['ArrowLeft','ArrowUp'].includes(e.key)?-.02:.02)));}redraw();updateJobUI();};}
  document.querySelector('#clear-mask').onclick=()=>{mc.fillStyle='black';mc.fillRect(0,0,512,mask.height);delete d.uploads.mask;document.querySelector('#upload-mask').textContent='Selection changed · save the painted area';redraw();updateJobUI();};
  document.querySelector('#save-mask').onclick=()=>{if(!mc.getImageData(0,0,mask.width,mask.height).data.some((v,i)=>i%4===0&&v>0)){d.error='Paint an area before saving the selection.';updateJobUI();return;}d.error='';mask.toBlob(async blob=>{
    d.busy++;updateJobUI();try{const result=await uploadFile(blob,'mask');d.uploads.mask={...result,label:'Painted selection'};document.querySelector('#upload-mask').textContent='Ready · painted selection';}catch(e){d.error=e.message;}finally{d.busy--;updateJobUI();}
  },'image/png');};
}
function specQualityLabel(id,quality){return runnerCatalog[id]?.quality[quality||'preview']?.label||'Preview';}
function resultURL(file){return 'http://127.0.0.1:8188/view?'+new URLSearchParams({filename:file.filename,subfolder:file.subfolder||'',type:file.type||'output'});}
function appendResult(container,job,preview=false) {
  const key=JSON.stringify(job)+preview;if(container.dataset.resultKey===key&&container.querySelector('a'))return;container.dataset.resultKey=key;container.replaceChildren();const p=document.createElement('p');p.textContent=job.message;container.append(p);
  for(const file of job.files||(job.file?[job.file]:[])){
    if(!file?.filename)continue;
    const url=resultURL(file),video=/\.(mp4|webm)$/i.test(file.filename);
    if(preview){const el=document.createElement(video?'video':'img');el.src=url;if(video){el.controls=true;el.preload='metadata';}else el.alt='Generated result';el.className='render-output';container.append(el);}
    const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.textContent=video?'Open video ↗':'Open image ↗';a.className='secondary';container.append(a);
  }
}
function updateJobUI() {
  const activity=document.querySelector('#activity');if(!activity)return;
  activity.hidden=!activeJob&&!lastJob;
  const elapsed=activeJob?.started?Math.floor((Date.now()-activeJob.started)/1000):0;
  if(activeJob)activity.textContent=`${activeJob.name||'Workflow'} · ${activeJob.state==='running'?'Creating':'Queued'}${elapsed?' · '+elapsed+'s elapsed':''}. You can keep browsing.`;
  else if(lastJob)appendResult(activity,lastJob);
  const button=document.querySelector('#run');if(!button||!detailId)return;
  const d=draftFor(detailId),spec=runnerCatalog[detailId];
  const missing=d.mode==='custom'&&spec?.fields.some(f=>!f.optional&&!d.uploads[f.key]);
  const noPoint=d.mode==='custom'&&detailId==='animal'&&!d.point;
  const sourceKind=spec?.duration_source, clip=d.uploads[sourceKind];
  const durationIssue=d.duration&&sourceKind?(d.mode!=='custom'||!clip?`Upload your own ${sourceKind} for this duration.`:clip.duration_seconds==null?`Re-upload the original ${sourceKind} to use longer clips.`:clip.duration_seconds+.001<d.duration?`Use ${sourceKind} at least ${d.duration} seconds long, or choose a shorter duration.`:''):'';
  const oldImage=d.quality==='high'&&d.mode==='custom'&&spec?.fields.some(f=>f.kind==='image'&&d.uploads[f.key]&&!d.uploads[f.key].high_name);
  button.disabled=!online||submitting||!!activeJob||!!d.busy||!!missing||!!noPoint||!!durationIssue;
  button.textContent=d.busy?'Preparing files…':submitting?'Submitting…':activeJob?'Creation in progress':d.duration?`Create ${d.duration}-second ${d.quality==='high'?'video':'preview'}`:d.quality==='high'?'Create high-quality result':'Create preview';
  document.querySelector('#form-error').textContent=d.error||'';
  document.querySelector('#render-help').textContent=!online?'Start ComfyUI to create. This page reconnects automatically.':missing?(d.duration&&sourceKind?'Add the required files for this duration.':'Add the required files or try the sample.'):noPoint?'Click the performer in the video preview.':durationIssue?durationIssue:oldImage?'This saved image has limited detail. Re-upload the original for the best result.':'Settings are tuned for your GPU. Files and results stay on this PC.';
  const box=document.querySelector('#job');box.hidden=!activeJob&&(!lastJob||((lastJob.workflow||'animal')!==detailId));
  if(activeJob){box.textContent=activity.textContent;const progress=document.createElement('progress');progress.setAttribute('aria-label','Creation in progress');box.append(progress);}
  else if(!box.hidden)appendResult(box,lastJob,true);
}
async function run(event) {
  event.preventDefault();if(submitting||activeJob||!online)return;
  const id=detailId,d=draftFor(id),w=workflows.find(w=>w.id===id);
  if(d.busy)return;
  submitting=true;d.error='';lastJob=null;updateJobUI();
  const payload={workflow:id,mode:d.mode,quality:d.quality||'preview',aspect_ratio:d.aspect_ratio||'original',duration:d.duration||0,prompt:d.prompt,point:d.point,uploads:Object.fromEntries(Object.entries(d.uploads).map(([k,v])=>[k,v.token]))};
  if(d.repeat)payload.seed=42;
  const signature=JSON.stringify(payload);if(d.pending?.signature!==signature)d.pending={signature,id:crypto.randomUUID()};payload.request_id=d.pending.id;
  try{const response=await fetch('/api/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const data=await response.json();if(!response.ok)throw Error(data.error);
    d.pending=null;activeJob={id:data.prompt_id,workflow:id,quality:d.quality,duration:d.duration||0,name:w.name+' · '+specQualityLabel(id,d.quality)+(d.aspect_ratio==='9:16'?' · Native 9:16':'')+(d.duration?' · '+d.duration+'s':''),started:Date.now(),state:'queued'};storeValue('studio-active-job',activeJob);storeValue('studio-last-job',null);storeValue('studio-drafts',[...drafts]);pollJob();
  }catch(e){d.error=e.message||'Could not submit. Check the connection and try again.';}finally{submitting=false;updateJobUI();}
}
async function pollJob() {
  if(!activeJob||polling)return;polling=true;
  try{const response=await fetch('/api/job/'+activeJob.id);const data=await response.json();if(!response.ok)throw Error(data.error);
    if(data.status||data.state==='missing'){
      const success=data.status?.status_str==='success';
      const files=Object.values(data.outputs||{}).flatMap(o=>[...(o.images||[]),...(o.videos||[]),...(o.gifs||[])]).filter(f=>f.type==='output'&&/\.(png|jpg|webp|mp4|webm)$/i.test(f.filename||''));
      lastJob={workflow:activeJob.workflow,files:success?files:[],message:success?`${activeJob.name||'Workflow'} is ready.`:data.state==='missing'?'This job is no longer in ComfyUI. You can create a new result.':'Creation failed. Your inputs are kept; retry or check Technical details.'};
      activeJob=null;storeValue('studio-active-job',null);storeValue('studio-last-job',lastJob);
    }else{activeJob.state=data.state||'queued';storeValue('studio-active-job',activeJob);}
    updateJobUI();
  }catch{document.querySelector('#activity').textContent='Connection interrupted. Your render may still be running; reconnecting…';}
  finally{polling=false;if(activeJob)setTimeout(pollJob,3000);}
}
