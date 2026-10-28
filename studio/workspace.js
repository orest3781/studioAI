'use strict';
const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function readLocal(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
const restored = readLocal('studio-workspace-v1', {});
const savedDrafts = readLocal('studio-workspace-drafts-v1', {});
const state = {project: restored.project || 'default', selected: restored.selected || null,
  compare: Array.isArray(restored.compare) ? restored.compare.slice(0,2) : [], comparing: false, wipe: false,
  view: ['workspace','library','recipes'].includes(restored.view) ? restored.view : 'workspace',
  workflow: restored.workflow || 'image', assets: [], projects: [], catalog: {}, jobs: [],
  paused: false, online: false, drafts: savedDrafts && typeof savedDrafts === 'object' ? savedDrafts : {},
  favorites: false, filter: 'all', search: '', busy: false, loading: true, polling: false};
let toastTimer, queueSignature = '', assetsSignature = '', compareCleanup = null;
const workflowName = id => workflows.find(w => w.id === id)?.name || id || 'Render';
const workflowById = id => workflows.find(w => w.id === id);
const selectedAsset = () => state.assets.find(a => a.id === state.selected);
const projectAssets = () => state.assets.filter(a => a.project_id === state.project);
function draft(id = state.workflow) {
  const key = state.project + ':' + id;
  const spec = state.catalog[id];
  if (!state.drafts[key]) state.drafts[key] = {mode:'custom', quality:'preview', duration:0,
    prompt:spec?.prompt, uploads:{}, variations:1, repeat:false, seed:42, point:null};
  const value = state.drafts[key];
  if (!value.uploads || typeof value.uploads !== 'object') value.uploads = {};
  return value;
}
function saveLocal() {
  try {
    localStorage.setItem('studio-workspace-v1', JSON.stringify({project:state.project, selected:state.selected,
      compare:state.compare, view:state.view, workflow:state.workflow}));
    localStorage.setItem('studio-workspace-drafts-v1', JSON.stringify(state.drafts));
    $('#save-state').textContent = 'Saved on this browser';
  } catch { $('#save-state').textContent = 'Browser draft storage unavailable'; }
}
async function api(path, data, options = {}) {
  const response = await fetch(path, data === undefined ? options : {...options, method:'POST',
    headers:{'Content-Type':'application/json', ...(options.headers || {})}, body:JSON.stringify(data)});
  let result;
  try { result = await response.json(); } catch { throw Error('The Studio returned an unreadable response. Please retry.'); }
  if (!response.ok) throw Error(result.error || 'The request could not be completed.');
  return result;
}
function toast(message, error = false) {
  clearTimeout(toastTimer); const element = $('#toast');
  element.textContent = message; element.classList.toggle('error', error); element.hidden = false;
  toastTimer = setTimeout(() => element.hidden = true, error ? 7000 : 4500);
}
const durationText = seconds => {
  if (!Number.isFinite(seconds)) return '';
  const rounded = Math.max(0, Math.round(seconds));
  return rounded < 60 ? `${rounded}s` : `${Math.floor(rounded / 60)}m ${rounded % 60}s`;
};
function assetInfo(asset) {
  const m = asset.metadata;
  return [m.width && m.height ? `${m.width} × ${m.height}` : '', asset.kind !== 'image' && m.duration ? durationText(m.duration) : '',
    asset.kind === 'video' && m.fps ? `${Math.round(m.fps * 100)/100} fps` : '', m.alpha ? 'Transparent' : ''].filter(Boolean).join(' · ');
}
function filteredAssets() {
  const query = state.search.toLowerCase();
  return projectAssets().filter(a => (state.filter === 'all' || a.kind === state.filter) && (!state.favorites || a.favorite) &&
    `${a.name} ${a.metadata.prompt || ''} ${workflowName(a.metadata.workflow)}`.toLowerCase().includes(query));
}
function assetCard(asset, compact = false) {
  const bulk=state.batchSelecting&&asset.kind!=='audio',picked=(state.batchSelection||[]).includes(asset.id);
  return `<article class="asset-card ${bulk&&picked?'batch-picked':''}"><button class="asset-open ${asset.id === state.selected ? 'selected' : ''}" ${bulk?'data-batch-pick':'data-asset'}="${asset.id}" aria-label="${bulk?'Select for export':'Open'} ${escapeHTML(asset.name)}" title="${escapeHTML(asset.name)}">
    <div class="asset-thumb"><img src="${asset.thumbnail}" alt="" loading="lazy"><span class="asset-kind-badge">${asset.kind === 'video' ? '▶ ' + durationText(asset.metadata.duration || 0) : asset.kind === 'audio' ? '♫ Audio' : asset.metadata.alpha ? 'PNG · α' : 'Image'}</span></div>
    <div class="asset-caption">${escapeHTML(asset.name)}</div></button>
    ${asset.chosen ? '<span class="asset-chosen" title="Chosen version">✓</span>' : ''}
    ${bulk?`<label class="asset-check batch-check" title="Select for batch export"><input type="checkbox" data-batch-check="${asset.id}" ${picked?'checked':''} aria-label="Export ${escapeHTML(asset.name)}"></label>`:asset.kind !== 'audio' ? `<label class="asset-check" title="Select for comparison"><input type="checkbox" data-compare="${asset.id}" ${state.compare.includes(asset.id) ? 'checked' : ''} aria-label="Compare ${escapeHTML(asset.name)}"></label>` : ''}</article>`;
}
function renderAssets() {
  const assets = filteredAssets();
  $('#asset-count').textContent = String(projectAssets().length);
  const empty = `<p class="muted small" style="grid-column:1/-1;padding:15px 0">${projectAssets().length ? 'No assets match these filters.' : 'Import media or create your first asset.'}</p>`;
  $('#asset-grid').innerHTML = assets.length ? assets.map(a => assetCard(a, true)).join('') : empty;
  $('#library-board').innerHTML = `<div class="library-tools"><label class="search-field"><input id="library-search" type="search" placeholder="Search assets" aria-label="Search library" value="${escapeHTML(state.search)}"></label><select id="library-kind" aria-label="Library media type">${['all','image','video','audio'].map(kind => `<option value="${kind}" ${state.filter === kind ? 'selected' : ''}>${kind === 'all' ? 'All media' : kind[0].toUpperCase()+kind.slice(1)}</option>`).join('')}</select></div>` + (assets.length ? assets.map(a => assetCard(a)).join('') : empty);
  $('#library-board').querySelector('.library-tools').insertAdjacentHTML('beforeend', `<button id="library-favorites" data-library-favorites class="icon-button" aria-label="Show library favorites" aria-pressed="${state.favorites}">${state.favorites ? '★' : '☆'}</button>`);
  const selected = state.comparing ? state.assets.find(a => a.id === state.compare[0]) : selectedAsset();
  const variations = selected?.group_id ? projectAssets().filter(a => a.group_id === selected.group_id) : projectAssets().slice(0,12);
  $('#variations-title').textContent = selected?.group_id ? `Variations · ${variations.length}` : 'Recent assets';
  $('#variation-strip').innerHTML = variations.length ? variations.map(a => assetCard(a, true)).join('') : '<p class="muted small">Your results will appear here.</p>';
  updateComparisonButton();
  document.dispatchEvent(new CustomEvent('studio:assets'));
}
function updateComparisonButton() {
  $('#compare-count').textContent = `${state.compare.length}/2`;
  $('#compare-toggle').disabled = state.compare.length !== 2;
  $('#compare-toggle').classList.toggle('primary', state.comparing);
  $('#compare-toggle').setAttribute('aria-pressed', String(state.comparing));
}
function renderRecipes() {
  $('#recipes-board').innerHTML = workflows.map(w => {
    const image = state.assets.find(a => a.metadata.workflow === w.id || a.name.startsWith(w.id + '_') || a.name.startsWith(w.id + '-'));
    return `<button class="recipe-card" data-recipe="${w.id}">${image ? `<img class="recipe-art" src="${image.thumbnail}" alt="" loading="lazy">` : `<div class="recipe-art" aria-hidden="true">${escapeHTML(w.glyph)}</div>`}<div class="recipe-copy"><span>${escapeHTML(w.category)}</span><h3>${escapeHTML(w.name)}</h3><p>${escapeHTML(w.description)}</p><span>Open recipe →</span></div></button>`;
  }).join('');
}
function setView(view) {
  state.view = view;
  if (view !== 'workspace') state.comparing = false;
  document.querySelectorAll('[data-view]').forEach(button => { button.classList.toggle('active', button.dataset.view === view); button.setAttribute('aria-pressed', String(button.dataset.view === view)); });
  $('#stage').hidden = view !== 'workspace';
  $('#library-board').hidden = view !== 'library';
  $('#recipes-board').hidden = view !== 'recipes';
  $('#variation-section').hidden = view !== 'workspace';
  if (view === 'recipes') renderRecipes();
  renderViewer(); saveLocal();
}
function selectAsset(ident) {
  const asset = state.assets.find(a => a.id === ident);
  if (!asset) return;
  state.selected = ident; state.comparing = false; state.wipe = false;
  setView('workspace'); renderAssets(); renderDetails(); saveLocal();
}
function mediaElement(asset, className = 'main-media') {
  if (asset.kind === 'image') return `<img class="${className}" src="${asset.url}" alt="${escapeHTML(asset.name)}">`;
  if (asset.kind === 'video') return `<video class="${className}" src="${asset.url}" controls playsinline preload="metadata" aria-label="${escapeHTML(asset.name)}"></video>`;
  return `<audio src="${asset.url}" controls preload="metadata" aria-label="${escapeHTML(asset.name)}"></audio>`;
}
function renderViewer() {
  if (compareCleanup) { compareCleanup(); compareCleanup = null; }
  const asset = selectedAsset(), stage = $('#stage');
  const isWorkspace = state.view === 'workspace';
  $('#asset-title').textContent = state.view === 'library' ? 'Your asset library' : state.view === 'recipes' ? 'Choose a starting point' : state.comparing ? 'Compare variations' : asset?.name || 'Your next idea starts here';
  $('#view-eyebrow').textContent = state.view === 'library' ? `${projectAssets().length} ASSETS · SAVED LOCALLY` : state.view === 'recipes' ? '18 WORKING GENERATION RECIPES' : state.comparing ? 'REVIEW & CHOOSE' : asset ? `${asset.kind.toUpperCase()} · ${asset.source === 'imported' ? 'ORIGINAL' : 'STUDIO OUTPUT'}` : 'WORKSPACE';
  $('#favorite-asset').disabled = !asset;
  $('#favorite-asset').textContent = asset?.favorite ? '★' : '☆';
  $('#favorite-asset').setAttribute('aria-pressed', String(!!asset?.favorite));
  $('#choose-asset').disabled = !asset;
  $('#choose-asset').textContent = asset?.chosen ? '✓ Chosen version' : 'Choose version';
  $('#favorite-asset').hidden = state.comparing;
  $('#choose-asset').hidden = state.comparing;
  $('#export-button').classList.toggle('disabled', !asset || state.comparing);
  $('#export-button').setAttribute('aria-disabled', String(!asset || state.comparing));
  $('#export-button').disabled = !asset || state.comparing;
  stage.classList.toggle('single-transparent', !!asset?.metadata.alpha && !state.comparing);
  stage.classList.toggle('compare-stage', state.comparing);
  $('#media-actions').hidden = !asset || !isWorkspace || state.comparing;
  if (!isWorkspace) return;
  if (state.comparing && state.compare.length === 2) { renderComparison(); return; }
  if (!asset) {
    stage.innerHTML = '<div class="empty-state"><span class="empty-symbol">◈</span><h2>A place for your ideas.</h2><p>Import an image, explore a recipe, or create something new.</p><button class="button primary" data-import>Import media</button></div>';
    return;
  }
  stage.innerHTML = mediaElement(asset) + `<span class="media-info">${escapeHTML(assetInfo(asset))}</span>`;
  const actions = asset.kind === 'image' ? [['video','Animate'],['edit','Edit image'],['inpaint','Erase & replace'],['background','Remove background'],['upscale','Upscale']] : asset.kind === 'video' ? [['interpolate','Smooth video'],['vace','Edit objects'],['animal','Animal swap']] : [['talk','Talking character']];
  $('#media-actions').innerHTML = actions.map(([id,label]) => `<button class="button secondary" data-use-workflow="${id}">${label}</button>`).join('');
}
function toggleComparison(ident, checked) {
  const asset = state.assets.find(a => a.id === ident);
  if (checked && asset) {
    if (state.compare.length === 2) state.compare.shift();
    const first = state.assets.find(a => a.id === state.compare[0]);
    if (first && first.kind !== asset.kind) { toast('Compare two images or two videos of the same type.', true); renderAssets(); return; }
    if (!state.compare.includes(ident)) state.compare.push(ident);
  } else state.compare = state.compare.filter(id => id !== ident);
  if (state.compare.length !== 2) state.comparing = false;
  renderAssets(); if (state.comparing || !checked) renderViewer(); saveLocal();
}
function renderComparison() {
  const assets = state.compare.map(id => state.assets.find(a => a.id === id));
  if (assets.some(a => !a)) { state.comparing = false; renderViewer(); return; }
  const video = assets[0].kind === 'video';
  const canWipe = !video && assets[0].metadata.width === assets[1].metadata.width && assets[0].metadata.height === assets[1].metadata.height;
  const labels = assets.map((a,i) => `<div class="compare-label"><span>${i === 0 ? 'A' : 'B'} · ${escapeHTML(a.name)}</span><button class="button secondary" data-choose="${a.id}">${a.chosen ? '✓ Chosen' : 'Choose '+(i === 0 ? 'A' : 'B')}</button></div>`);
  $('#stage').innerHTML = (state.wipe && canWipe ? `<div class="compare-wipe"><img src="${assets[1].url}" alt="B: ${escapeHTML(assets[1].name)}"><img class="wipe-after" src="${assets[0].url}" alt="A: ${escapeHTML(assets[0].name)}"></div><div class="compare-layout">${labels.map(s=>'<div class="compare-cell">'+s+'</div>').join('')}</div>` : `<div class="compare-layout">${assets.map((a,i)=>`<div class="compare-cell">${mediaElement(a,'compare-media')}${labels[i]}</div>`).join('')}</div>`) +
    `<div class="compare-tools"><div class="compare-controls">${video ? '<button id="compare-play" class="button secondary">Play both</button><label class="sr-only" for="compare-seek">Comparison time</label><input id="compare-seek" type="range" min="0" max="1" step="0.01" value="0"><span id="compare-time" class="small muted">0s</span>' : canWipe ? `<button id="wipe-toggle" class="button secondary">${state.wipe ? 'Side by side' : 'Before / after slider'}</button>${state.wipe ? '<label class="sr-only" for="wipe-position">Reveal image A</label><input id="wipe-position" type="range" min="0" max="100" value="50">' : ''}` : '<span class="muted small">Side by side · different image dimensions</span>'}<button id="close-compare" class="button secondary">Done</button></div></div>`;
  $('#close-compare').onclick = () => { state.comparing = false; renderViewer(); updateComparisonButton(); };
  if ($('#wipe-toggle')) $('#wipe-toggle').onclick = () => { state.wipe = !state.wipe; renderViewer(); };
  if ($('#wipe-position')) $('#wipe-position').oninput = e => $('.wipe-after').style.clipPath = `inset(0 ${100-Number(e.target.value)}% 0 0)`;
  if (video) {
    const videos = [...$('#stage').querySelectorAll('video')];
    let synchronizing = false;
    const finiteDuration = () => Math.min(...videos.map(v => Number.isFinite(v.duration) ? v.duration : Infinity));
    const seek = time => { if (synchronizing) return; synchronizing = true; videos.forEach(v => { if (Number.isFinite(v.duration) && Math.abs(v.currentTime-time) > .08) v.currentTime = Math.min(time,v.duration); }); synchronizing = false; };
    videos.forEach(v => {
      v.onloadedmetadata = () => { const duration = finiteDuration(); if (Number.isFinite(duration)) $('#compare-seek').max = duration; };
      v.onseeking = () => seek(v.currentTime);
      v.onplay = () => { seek(v.currentTime); videos.filter(o=>o!==v).forEach(o=>o.play().catch(()=>{})); $('#compare-play').textContent='Pause both'; };
      v.onpause = () => { videos.filter(o=>o!==v).forEach(o=>o.pause()); if ($('#compare-play')) $('#compare-play').textContent='Play both'; };
      v.onended = () => videos.forEach(o=>o.pause());
    });
    videos[1].muted = true;
    $('#compare-play').onclick = () => { if (videos.some(v=>!v.paused)) videos.forEach(v=>v.pause()); else videos.forEach(v=>v.play().catch(()=>toast('Use the player controls to start playback.'))); };
    $('#compare-seek').oninput = e => seek(Number(e.target.value));
    const timer = setInterval(() => {
      if (!videos[0].paused && Math.abs(videos[1].currentTime-videos[0].currentTime)>.2) seek(videos[0].currentTime);
      if ($('#compare-seek')) $('#compare-seek').value = videos[0].currentTime;
      if ($('#compare-time')) $('#compare-time').textContent = videos[0].currentTime.toFixed(1)+'s';
      if (videos[0].currentTime >= finiteDuration()) videos.forEach(v=>v.pause());
    },200);
    compareCleanup = () => { clearInterval(timer); videos.forEach(v=>{v.onpause=null;v.onplay=null;v.onseeking=null;v.pause();}); };
  }
}

function setInspector(tab) {
  for (const name of ['create','details']) {
    const active = name === tab;
    $('#'+name+'-tab').classList.toggle('active',active);
    $('#'+name+'-tab').setAttribute('aria-selected',String(active));
    $('#'+name+'-panel').hidden = !active;
  }
  if (tab === 'details') renderDetails();
}
function renderDetails() {
  const asset = selectedAsset(), panel = $('#details-panel');
  if (!asset) { panel.innerHTML = '<p class="muted">Select an asset to inspect its details.</p>'; return; }
  const m = asset.metadata;
  const rows = [['Type',asset.kind],['Dimensions',m.width ? `${m.width} × ${m.height}` : '—'],
    ['Duration',asset.kind !== 'image' && m.duration ? durationText(m.duration) : '—'],['Size',`${((m.bytes || 0)/1048576).toFixed(2)} MB`],
    ['Source',asset.source],['Created',new Date(asset.created*1000).toLocaleString()],
    ['Workflow',m.workflow ? workflowName(m.workflow) : 'Not recorded'],['Seed',m.seed ?? 'Not recorded'],
    ['Generation canvas',m.aspect_ratio === '9:16' ? 'Native portrait · 9:16' : m.workflow ? 'Original recipe size' : 'Not recorded'],['Quality',m.quality === 'high' ? 'High quality' : m.quality === 'preview' ? 'Preview' : 'Not recorded']];
  if(m.export){
    rows.splice(6,4);
    const presetNames={reels:'Instagram Reels',tiktok:'TikTok',shorts:'YouTube Shorts',portrait:'Portrait feed',square:'Square post',landscape:'Landscape video',custom:'Custom format'};
    rows.push(['Export preset',presetNames[m.export.preset]||m.export.preset],['Aspect ratio',m.export.ratio],['Framing',{crop:'Fill / crop',contain:'Fit',blur:'Blurred background'}[m.export.fit]],['Export format',m.export.format.toUpperCase()]);
  }
  panel.innerHTML = `<form id="asset-details-form" class="details-form"><div><label for="asset-rename">Asset name</label><input id="asset-rename" value="${escapeHTML(asset.name)}" maxlength="180" required></div><div><label for="asset-project">Project</label><select id="asset-project">${state.projects.map(p=>`<option value="${p.id}" ${p.id===asset.project_id?'selected':''}>${escapeHTML(p.name)}</option>`).join('')}</select></div><button class="button secondary" type="submit">Save details</button></form><dl class="metadata-list">${rows.map(([key,value])=>`<dt>${key}</dt><dd>${escapeHTML(value)}</dd>`).join('')}</dl>${m.prompt ? `<h2>Generation prompt</h2><p class="details-prompt">${escapeHTML(m.prompt)}</p>` : ''}${asset.job_id ? '<button id="restore-settings" class="button secondary">Reuse generation settings</button>' : ''}<p class="field-note">Original files are retained. Workflow inputs use the existing tested preparation presets.</p>`;
  $('#asset-details-form').onsubmit = async event => {
    event.preventDefault();
    try {
      await api('/api/assets/'+asset.id,{name:$('#asset-rename').value,project_id:$('#asset-project').value});
      await refreshAssets(); renderDetails(); renderViewer(); toast('Asset details saved.');
    } catch(error) { toast(error.message,true); }
  };
  if(m.parent_id&&state.assets.some(a=>a.id===m.parent_id)){
    const parentButton=document.createElement('button');parentButton.className='button secondary';parentButton.textContent='Open source asset';
    parentButton.onclick=async()=>{const parent=state.assets.find(a=>a.id===m.parent_id);if(parent.project_id!==state.project)await changeProject(parent.project_id);selectAsset(parent.id);};
    panel.append(parentButton);
  }
  if ($('#restore-settings')) $('#restore-settings').onclick = () => {
    const job = state.jobs.find(j=>j.id===asset.job_id);
    if (!job) { toast('The original job settings are unavailable.',true); return; }
    const payload = job.payload;
    state.workflow = payload.workflow;
    const d = draft();
    Object.assign(d,{prompt:payload.prompt,quality:payload.quality||'preview',duration:payload.duration||0,aspect_ratio:payload.aspect_ratio||'original',
      mode:payload.mode||'sample',seed:payload.seed,repeat:true,point:payload.point||null,variations:1});
    // Prepared upload descriptors are resolved through their retained asset where possible.
    d.uploads = Object.fromEntries(Object.entries(payload.uploads||{}).map(([key,token])=>[key,{token,preview:'/api/media/'+token+(state.catalog[payload.workflow]?.fields.find(f=>f.key===key)?.kind==='video'?'/preview':''),label:'Saved source',source_preview:payload.workflow==='video'&&payload.aspect_ratio==='9:16'&&key==='image'?'/api/media/'+token+'/source':null,duration_seconds:payload.source_durations?.[key]}]));
    $('#workflow-select').value=state.workflow; renderForm(); setInspector('create'); saveLocal();
    toast('Generation settings restored.');
  };
}
function renderForm() {
  const id=state.workflow, spec=state.catalog[id], d=draft();
  if (!spec) return;
  if (d.prompt == null) d.prompt=spec.prompt;
  if (!spec.quality[d.quality]) d.quality='preview';
  if (!spec.durations?.some(option=>option.seconds===d.duration)) d.duration=0;
  if (!spec.portrait || !['original','9:16'].includes(d.aspect_ratio)) d.aspect_ratio='original';
  const quality=(d.aspect_ratio==='9:16' ? spec.portrait[String(d.duration)] : null) || spec.durations?.find(option=>option.seconds===d.duration)?.quality || spec.quality;
  const w=workflowById(id);
  $('#creation-form').innerHTML = `<form id="render-form" class="form-stack">
    ${spec.prompt !== null ? `<div><label for="creative-prompt">${id==='edit'?'What should change?':'Describe your result'}</label><textarea id="creative-prompt" maxlength="4000" required placeholder="Describe the subject, scene, lighting, and movement…">${escapeHTML(d.prompt)}</textarea></div>` : ''}
    ${spec.fields.length ? `<fieldset class="choice-group"><legend>Start with</legend><label><input type="radio" name="source-mode" value="custom" ${d.mode==='custom'?'checked':''}>My assets</label><label><input type="radio" name="source-mode" value="sample" ${d.mode==='sample'?'checked':''}>Try sample</label></fieldset>` : ''}
    <div id="source-fields" ${d.mode==='sample'?'hidden':''}>${spec.fields.map(f=>{
      const saved=d.uploads[f.key];
      const item=saved && {...saved,preview:id==='video'&&d.aspect_ratio==='9:16'&&f.kind==='image'&&(saved.source_name||saved.source_preview)?'/api/media/'+saved.token+'/source':saved.preview};
      return `<div class="upload-box" style="margin-bottom:10px"><div class="upload-heading"><label for="source-${f.key}">${escapeHTML(f.label)}</label>${item?`<button type="button" class="icon-button" data-clear-field="${f.key}" aria-label="Remove ${escapeHTML(f.label)}">×</button>`:''}</div>${item?.preview?f.kind==='audio'?`<audio class="source-preview" src="${escapeHTML(item.preview)}" controls></audio>`:`<img class="source-preview" src="${escapeHTML(item.preview)}" alt="Prepared ${escapeHTML(f.label)}">`:''}<input id="source-${f.key}" type="file" data-field="${f.key}" accept="${f.kind==='video'?'video/*':f.kind==='audio'?'audio/*':'image/*'}"><div class="source-row"><button type="button" class="button secondary" data-pick-field="${f.key}">Choose from library</button></div><span class="source-name">${escapeHTML(item?.label || 'Up to 100 MB · original retained')}</span></div>`;
    }).join('')}<div id="editor-wrap" hidden><p id="editor-help" class="field-note"></p><canvas id="media-editor" class="mask-editor" width="512" height="512" tabindex="0" aria-label="Select an area in the source image"></canvas><div id="brush-tools" class="brush-actions"><label for="brush-size">Brush <input id="brush-size" type="range" min="8" max="100" value="35"></label><button type="button" id="clear-mask" class="button secondary">Clear mask</button><button type="button" id="save-mask" class="button secondary">Use painted area</button></div></div></div>
    ${spec.portrait ? `<div><label for="render-aspect">Generation canvas</label><select id="render-aspect" aria-describedby="aspect-note"><option value="original" ${d.aspect_ratio==='original'?'selected':''}>Original recipe size</option><option value="9:16" ${d.aspect_ratio==='9:16'?'selected':''}>Portrait 9:16 · Reels, TikTok & Shorts</option></select><p id="aspect-note" class="field-note">${d.aspect_ratio==='9:16'?'Composed in portrait from the start. No output cropping.'+(id==='video'?' Use a 9:16 starting image for edge-to-edge video. Other shapes fit inside the canvas with borders.':'')+(d.duration?' Longer clips use a smaller canvas to fit local GPU memory.':''):'Keep the recipe’s existing canvas, or create a native portrait.'}</p></div>` : '<p class="field-note">This recipe uses its existing canvas. Use social export for a portrait delivery.</p>'}
    ${id==='video'&&d.aspect_ratio==='9:16'&&d.mode==='custom'&&d.uploads.image&&!d.uploads.image.source_name&&!d.uploads.image.source_preview?'<p class="field-note">This saved input predates full-frame preparation. Reselect it from the library or re-upload the original for native portrait.</p>':''}
    <div class="form-row">${spec.durations?.length ? `<div><label for="render-duration">Duration</label><select id="render-duration">${spec.durations.map(o=>`<option value="${o.seconds}" ${d.duration===o.seconds?'selected':''}>${escapeHTML(o.label)}</option>`).join('')}</select></div>`:''}<div><label for="render-variations">Variations</label><select id="render-variations" ${spec.prompt===null?'disabled':''}>${(spec.prompt===null?[1]:[1,2,4]).map(n=>`<option value="${n}" ${Number(d.variations)===n?'selected':''}>${n===1?'1 result':n+' variations'}</option>`).join('')}</select></div></div>
    <div><fieldset class="choice-group"><legend>Quality</legend>${Object.entries(quality).map(([key,q])=>`<label><input type="radio" name="render-quality" value="${key}" ${d.quality===key?'checked':''}>${escapeHTML(q.label)}</label>`).join('')}</fieldset><p id="quality-description" class="field-note">${escapeHTML(quality[d.quality]?.description)}</p></div>
    <p id="form-error" class="error-text" role="alert"></p><div><button id="submit-render" class="button primary render-submit" type="submit">Add to render queue</button><p id="render-help" class="field-note"></p></div>
    </form><details class="technical-details"><summary>Recipe details & repeatability</summary><p>${escapeHTML(spec.hint)}</p><p>${escapeHTML(w?.model)}</p><label class="repeat-label"><input id="repeat-seed" type="checkbox" ${d.repeat?'checked':''}>Use a fixed starting seed</label><label for="render-seed">Starting seed</label><input id="render-seed" type="number" min="0" max="9007199254740991" value="${Number.isSafeInteger(d.seed)?d.seed:42}"><p>Each variation gets a separate seed. Quality and duration use the existing tested workflows.</p><a href="/test-workflow/${id}.json" download>Download original workflow</a> · <a href="http://127.0.0.1:8188" target="_blank" rel="noopener">Open engine ↗</a></details>`;
  $('#render-form').onsubmit=submitRender;
  if ($('#creative-prompt')) $('#creative-prompt').oninput=e=>{d.prompt=e.target.value;saveLocal();};
  document.querySelectorAll('[name=source-mode]').forEach(el=>el.onchange=()=>{d.mode=el.value;renderForm();saveLocal();});
  document.querySelectorAll('[name=render-quality]').forEach(el=>el.onchange=()=>{d.quality=el.value;$('#quality-description').textContent=quality[d.quality]?.description||'';updateSubmit();saveLocal();});
  if ($('#render-aspect')) $('#render-aspect').onchange=e=>{d.aspect_ratio=e.target.value;renderForm();$('#render-aspect').focus();saveLocal();};
  if ($('#render-duration')) $('#render-duration').onchange=e=>{d.duration=Number(e.target.value);if(d.duration&&spec.duration_source)d.mode='custom';renderForm();$('#render-duration').focus();saveLocal();};
  $('#render-variations').onchange=e=>{d.variations=Number(e.target.value);saveLocal();};
  $('#repeat-seed').onchange=e=>{d.repeat=e.target.checked;saveLocal();};
  $('#render-seed').oninput=e=>{d.seed=Number(e.target.value);saveLocal();};
  document.querySelectorAll('[data-field]').forEach(input=>input.onchange=async()=>{
    const file=input.files[0];if(!file)return;
    const field=spec.fields.find(f=>f.key===input.dataset.field), project=state.project;
    state.busy=true;updateSubmit();
    try {const prepared=await uploadFile(file,field.kind,project);applyPrepared(d,field,prepared,file.name);await refreshAssets();}
    catch(error){d.error=error.message;}
    finally{state.busy=false;if(state.workflow===id&&state.project===project)renderForm();saveLocal();}
  });
  setupEditor();updateSubmit();
}
function applyPrepared(d,field,item,label) {
  d.uploads[field.key]={...item,label};d.mode='custom';d.error='';
  if (field.key==='video') d.point=null;
  if (field.key==='image'||field.key==='video') delete d.uploads.mask;
  if (item.asset_id) d.parent_id=item.asset_id;
}
async function uploadFile(file,kind,project=state.project) {
  if(file.size>100*1024*1024)throw Error('Choose a file under 100 MB.');
  const response=await fetch('/api/upload/'+kind+'?project='+encodeURIComponent(project),{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(file.name||'Painted mask.png')},body:file});
  const data=await response.json();if(!response.ok)throw Error(data.error);return data;
}
async function importFiles(files) {
  const project=state.project;let last=null, count=0;
  for(const file of [...files]) {
    let kind=file.type.split('/')[0];
    if(!['image','video','audio'].includes(kind)){toast('Choose an image, video, or audio file.',true);continue;}
    try{toast('Importing '+file.name+'…');const item=await uploadFile(file,kind,project);last=item.asset_id;count++;}
    catch(error){toast(file.name+': '+error.message,true);}
  }
  await refreshAssets();
  if(last&&project===state.project)selectAsset(last);
  if(count)toast(`${count} ${count===1?'asset':'assets'} imported. Original files retained.`);
}
function openAssetPicker(fieldKey) {
  const id=state.workflow, project=state.project, d=draft(), field=state.catalog[id].fields.find(f=>f.key===fieldKey);
  const kind=field.kind==='mask'?'image':field.kind;
  const assets=projectAssets().filter(a=>a.kind===kind);
  $('#picker-assets').innerHTML=assets.length?assets.map(a=>`<button data-pick-asset="${a.id}"><img src="${a.thumbnail}" alt="" loading="lazy"><span>${escapeHTML(a.name)}</span></button>`).join(''):'<p class="muted">Import a matching asset into this project first.</p>';
  $('#asset-picker').showModal();
  $('#picker-assets').onclick=async event=>{
    const button=event.target.closest('[data-pick-asset]');if(!button)return;
    button.disabled=true;const asset=state.assets.find(a=>a.id===button.dataset.pickAsset);
    try{const prepared=await api('/api/assets/'+asset.id+'/prepare',{kind:field.kind});applyPrepared(d,field,prepared,asset.name);$('#asset-picker').close();if(state.workflow===id&&state.project===project)renderForm();saveLocal();}
    catch(error){toast(error.message,true);button.disabled=false;}
  };
}
async function useAssetWorkflow(id) {
  const asset=selectedAsset();if(!asset)return;
  const field=state.catalog[id]?.fields.find(f=>f.kind===asset.kind);
  if(!field)return;
  state.workflow=id;$('#workflow-select').value=id;setInspector('create');
  const d=draft();
  if (asset.metadata.aspect_ratio==='9:16' && state.catalog[id]?.portrait) d.aspect_ratio='9:16';
  state.busy=true;renderForm();
  try{const prepared=await api('/api/assets/'+asset.id+'/prepare',{kind:field.kind});applyPrepared(d,field,prepared,asset.name);toast('Asset added to '+workflowName(id)+'.');}
  catch(error){d.error=error.message;}
  finally{state.busy=false;renderForm();saveLocal();}
}
function setupEditor() {
  const id=state.workflow,d=draft(),pointMode=id==='animal',paintMode=['inpaint','vace'].includes(id);
  const source=d.uploads[id==='inpaint'?'image':'video'];
  if(d.mode!=='custom'||(!pointMode&&!paintMode)||!source)return;
  const canvas=$('#media-editor'),wrap=$('#editor-wrap');wrap.hidden=false;canvas.height=id==='inpaint'?512:288;
  $('#brush-tools').hidden=pointMode;
  $('#editor-help').textContent=pointMode?'Click inside the performer. Keyboard: Enter selects the center; arrows move the point.':'Paint the area to replace and save your selection.'+(id==='vace'?' This mask stays fixed across the clip.':'');
  const context=canvas.getContext('2d'),mask=document.createElement('canvas');mask.width=512;mask.height=canvas.height;
  const mc=mask.getContext('2d');mc.fillStyle='black';mc.fillRect(0,0,mask.width,mask.height);
  const image=new Image();let drawing=false,previous=null;
  const redraw=()=>{if(!image.complete||!image.naturalWidth)return;context.drawImage(image,0,0,canvas.width,canvas.height);if(pointMode&&d.point){context.fillStyle='#d6f587';context.beginPath();context.arc(d.point[0]*512,d.point[1]*canvas.height,7,0,Math.PI*2);context.fill();}else if(!pointMode){context.globalAlpha=.42;context.drawImage(mask,0,0);context.globalAlpha=1;}};
  image.onload=()=>{redraw();if(paintMode&&d.uploads.mask){const saved=new Image();saved.onload=()=>{mc.drawImage(saved,0,0,mask.width,mask.height);redraw();};saved.src=d.uploads.mask.preview;}};image.src=source.preview;
  const paint=event=>{const rect=canvas.getBoundingClientRect(),p=[Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))];if(pointMode){d.point=p;redraw();updateSubmit();saveLocal();return;}
    mc.strokeStyle='white';mc.lineWidth=Number($('#brush-size').value);mc.lineCap='round';mc.beginPath();mc.moveTo(...(previous||[p[0]*512,p[1]*canvas.height]));mc.lineTo(p[0]*512+.01,p[1]*canvas.height);mc.stroke();previous=[p[0]*512,p[1]*canvas.height];delete d.uploads.mask;redraw();updateSubmit();};
  canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);drawing=true;previous=null;paint(e);};
  canvas.onpointermove=e=>{if(drawing&&!pointMode)paint(e);};canvas.onpointerup=()=>drawing=false;canvas.onpointercancel=()=>drawing=false;
  if(pointMode)canvas.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();d.point=d.point||[.5,.5];}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();d.point=d.point||[.5,.5];const axis=['ArrowLeft','ArrowRight'].includes(e.key)?0:1;d.point[axis]=Math.max(0,Math.min(1,d.point[axis]+(['ArrowLeft','ArrowUp'].includes(e.key)?-.02:.02)));}redraw();updateSubmit();saveLocal();};
  $('#clear-mask').onclick=()=>{mc.fillStyle='black';mc.fillRect(0,0,512,mask.height);delete d.uploads.mask;redraw();updateSubmit();saveLocal();};
  $('#save-mask').onclick=()=>{if(!mc.getImageData(0,0,mask.width,mask.height).data.some((v,i)=>i%4===0&&v>0)){d.error='Paint an area first, or upload a mask.';updateSubmit();return;}mask.toBlob(async blob=>{state.busy=true;updateSubmit();try{const result=await uploadFile(blob,'mask');d.uploads.mask={...result,label:'Painted selection'};d.error='';saveLocal();toast('Mask saved.');}catch(error){d.error=error.message;}finally{state.busy=false;updateSubmit();}},'image/png');};
}
function updateSubmit() {
  const button=$('#submit-render');if(!button)return;
  const d=draft(),spec=state.catalog[state.workflow];
  let issue='';
  if(d.mode==='custom'){
    const missing=spec.fields.find(f=>!f.optional&&!d.uploads[f.key]);
    if(missing)issue='Add '+missing.label.toLowerCase()+', or try the sample.';
    if(!issue&&state.workflow==='animal'&&!d.point)issue='Click the performer in the preview.';
  }
  const source=d.uploads[spec.duration_source];
  if(d.duration&&spec.duration_source&&(d.mode!=='custom'||!source||!Number.isFinite(source.duration_seconds)||source.duration_seconds+.001<d.duration))issue=`Choose ${spec.duration_source} at least ${d.duration} seconds long.`;
  button.disabled=state.busy||!!issue;
  const count=spec.prompt===null?1:Number(d.variations||1);
  button.textContent=state.busy?'Preparing…':count>1?`Queue ${count} variations`:'Add to render queue';
  $('#form-error').textContent=d.error||'';
  $('#render-help').textContent=issue||(!state.online?'Engine offline. Jobs are saved and will run when it reconnects.':state.paused?'Queue paused. New jobs will wait until you resume.':'Your settings are saved with every result.');
}
async function submitRender(event) {
  event.preventDefault();if(state.busy)return;
  const id=state.workflow,d=draft(),project=state.project,spec=state.catalog[id];
  const payload={workflow:id,project_id:project,mode:d.mode,quality:d.quality,duration:d.duration||0,aspect_ratio:d.aspect_ratio||'original',
    prompt:d.prompt,point:d.point,variations:spec.prompt===null?1:Number(d.variations||1),
    uploads:Object.fromEntries(Object.entries(d.uploads).map(([key,value])=>[key,value.token])),
    source_durations:Object.fromEntries(Object.entries(d.uploads).filter(([,v])=>Number.isFinite(v.duration_seconds)).map(([k,v])=>[k,v.duration_seconds])),parent_id:d.parent_id};
  if(d.repeat)payload.seed=d.seed;
  const signature=JSON.stringify(payload);
  if(d.pending?.signature!==signature)d.pending={signature,id:crypto.randomUUID()};
  payload.request_id=d.pending.id;
  state.busy=true;d.error='';saveLocal();updateSubmit();
  try{const result=await api('/api/jobs',payload);d.pending=null;toast(`${result.job_ids.length} ${result.job_ids.length===1?'job':'variations'} added to the queue.`);await refreshWorkspace();toggleQueue(true);}
  catch(error){d.error=error.message;}
  finally{state.busy=false;saveLocal();updateSubmit();}
}

function toggleQueue(open = $('#queue-drawer').hidden) {
  $('#queue-drawer').hidden=!open;
  $('#queue-toggle').setAttribute('aria-expanded',String(open));
  if(open){renderQueue();$('#queue-close').focus();}else $('#queue-toggle').focus();
}
function renderQueue() {
  const active=state.jobs.filter(j=>['queued','submitting','running','stopping'].includes(j.state));
  const finished=state.jobs.filter(j=>!active.includes(j)).sort((a,b)=>(b.finished||b.created)-(a.finished||a.created));
  const ordered=[...active.filter(j=>j.state!=='queued'),...active.filter(j=>j.state==='queued'),...finished.slice(0,30)];
  $('#queue-count').textContent=String(active.length+(state.exports||[]).filter(j=>['queued','running','cancelling'].includes(j.state)).length+(state.analysis||[]).filter(j=>['queued','running','cancelling'].includes(j.state)).length);
  $('#pause-queue').textContent=state.paused?'Resume queue':'Pause after current';
  $('#pause-queue').setAttribute('aria-pressed',String(state.paused));
  $('#queue-summary').textContent=state.paused?'Paused':`${active.length} active · ${finished.length} finished`;
  const labels={queued:state.paused?'Paused':'Waiting',submitting:'Submitting',running:'Rendering',stopping:'Stopping',completed:'Ready',failed:'Failed',cancelled:'Cancelled',interrupted:'Interrupted'};
  const signature=JSON.stringify([state.paused,ordered.map(j=>[j.id,j.state,j.error,j.position])]);
  if(signature!==queueSignature){
    queueSignature=signature;
    $('#queue-list').innerHTML=ordered.length?ordered.map(job=>{
      const p=job.payload,project=state.projects.find(v=>v.id===job.project_id)?.name||'Project';
      const actions=job.state==='queued'?[['earlier','↑ Earlier'],['later','↓ Later'],['cancel','Cancel']]:['running','submitting'].includes(job.state)?[['cancel','Stop render']]:['failed','cancelled','interrupted'].includes(job.state)?[['retry','Retry saved job']]:[];
      return `<article class="queue-job"><div class="queue-job-title"><strong>${escapeHTML(workflowName(p.workflow))}</strong><span class="job-state ${job.state}">${labels[job.state]}</span></div><p>${escapeHTML(project)} · ${p.quality==='high'?'High quality':'Preview'}${p.duration?' · '+p.duration+'s':''}${p.aspect_ratio==='9:16'?' · Native 9:16':''} · Seed ${p.seed??'original'}</p>${p.prompt?`<p>${escapeHTML(p.prompt.slice(0,160))}</p>`:''}${['running','submitting','stopping'].includes(job.state)?'<progress aria-label="Render in progress"></progress>':''}<span class="muted small" data-job-elapsed="${job.id}"></span>${job.error?`<details><summary>What happened</summary><pre>${escapeHTML(job.error)}</pre></details>`:''}<div class="job-buttons">${actions.map(([action,label])=>`<button class="button secondary" data-job-action="${action}" data-job-id="${job.id}">${label}</button>`).join('')}${job.state==='completed'?`<button class="button secondary" data-job-result="${job.id}">View result</button>`:''}</div></article>`;
    }).join(''):'<div class="empty-state"><span class="empty-symbol">◷</span><h2>Room for your next idea.</h2><p>Add a render from the Create panel. Your queue survives closing the browser.</p></div>';
  }
  document.querySelectorAll('[data-job-elapsed]').forEach(el=>{const job=state.jobs.find(j=>j.id===el.dataset.jobElapsed);el.textContent=job.started?`${durationText((job.finished||Date.now()/1000)-job.started)} ${job.finished?'total':'elapsed'}`:'Saved '+new Date(job.created*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});});
}
async function refreshAssets() {
  const data=await api('/api/assets');
  const signature=JSON.stringify(data.assets);
  if(signature===assetsSignature)return;
  assetsSignature=signature;state.assets=data.assets;
  const oldSelected=state.selected;
  if(!projectAssets().some(a=>a.id===state.selected))state.selected=projectAssets()[0]?.id||null;
  state.compare=state.compare.filter(id=>projectAssets().some(a=>a.id===id));
  if(state.compare.length!==2)state.comparing=false;
  renderAssets();
  if(state.view==='recipes')renderRecipes();
  if(oldSelected!==state.selected||!state.selected||state.view!=='workspace')renderViewer();
  if(!$('#details-panel').contains(document.activeElement))renderDetails();
}
async function refreshWorkspace() {
  if(state.polling)return;state.polling=true;
  try{
    const data=await api('/api/workspace');
    const priorFinished=state.jobs.filter(j=>j.state==='completed').map(j=>j.id).join(',');
    state.jobs=data.jobs;state.projects=data.projects;state.online=data.online;state.paused=data.paused;
    state.exports=data.exports||[];
    state.analysis=data.analysis||[];
    state.batches=data.batches||[];
    const projectSelect=$('#project-select'),options=data.projects.map(p=>`<option value="${p.id}">${escapeHTML(p.name)}</option>`).join('');
    if(projectSelect.innerHTML!==options)projectSelect.innerHTML=options;
    if(!data.projects.some(p=>p.id===state.project))state.project='default';
    projectSelect.value=state.project;
    $('#engine-state').textContent=data.online?'Engine connected':'Engine offline';
    $('#engine-state').classList.toggle('online',data.online);
    $('#connection-banner').hidden=data.online;
    $('#connection-banner').textContent='Generation engine is offline. Your assets are available and queued jobs are saved. Start ComfyUI to render.';
    renderQueue();updateSubmit();
    document.dispatchEvent(new CustomEvent('studio:workspace'));
    const finished=state.jobs.filter(j=>j.state==='completed').map(j=>j.id).join(',');
    if(finished!==priorFinished)await refreshAssets();
  }catch(error){$('#connection-banner').hidden=false;$('#connection-banner').textContent='Studio connection interrupted. Reconnecting; your saved queue remains on disk.';}
  finally{state.polling=false;}
}
async function chooseAsset(ident) {
  try{await api('/api/assets/'+ident,{chosen:true});await refreshAssets();renderViewer();toast('Chosen version saved.');}
  catch(error){toast(error.message,true);}
}
async function changeProject(ident) {
  state.batchSelection=[];state.batchSelecting=false;
  state.project=ident;state.selected=null;state.compare=[];state.comparing=false;
  state.search='';state.filter='all';state.favorites=false;
  $('#asset-search').value='';$('#asset-kind').value='all';
  $('#favorites-filter').setAttribute('aria-pressed','false');$('#favorites-filter').textContent='☆';
  state.selected=projectAssets()[0]?.id||null;
  renderAssets();renderViewer();renderForm();renderDetails();saveLocal();
}
document.addEventListener('click',async event=>{
  const target=event.target.closest('button');if(!target)return;
  if(target.hasAttribute('data-import')){$('#import-files').click();return;}
  if(target.hasAttribute('data-library-favorites')){$('#favorites-filter').click();$('#library-favorites').focus();return;}
  if(target.dataset.view){setView(target.dataset.view);return;}
  if(target.dataset.asset){selectAsset(target.dataset.asset);return;}
  if(target.dataset.recipe){state.workflow=target.dataset.recipe;$('#workflow-select').value=state.workflow;renderForm();setInspector('create');setView('workspace');return;}
  if(target.dataset.useWorkflow){await useAssetWorkflow(target.dataset.useWorkflow);return;}
  if(target.dataset.pickField){openAssetPicker(target.dataset.pickField);return;}
  if(target.dataset.clearField){delete draft().uploads[target.dataset.clearField];if(['video','image'].includes(target.dataset.clearField))delete draft().uploads.mask;renderForm();saveLocal();return;}
  if(target.dataset.choose){await chooseAsset(target.dataset.choose);return;}
  if(target.dataset.jobAction){
    target.disabled=true;$('#queue-error').textContent='';
    try{await api('/api/jobs/'+target.dataset.jobId,{action:target.dataset.jobAction});await refreshWorkspace();}
    catch(error){$('#queue-error').textContent=error.message;}
    finally{target.disabled=false;}
    return;
  }
  if(target.dataset.jobResult){
    await refreshAssets();const asset=state.assets.find(a=>a.job_id===target.dataset.jobResult);
    if(asset){if(asset.project_id!==state.project)await changeProject(asset.project_id);selectAsset(asset.id);toggleQueue(false);}else toast('No viewable media was recorded for this job.',true);
  }
});
document.addEventListener('change',event=>{if(event.target.dataset.compare)toggleComparison(event.target.dataset.compare,event.target.checked);});
$('#workflow-select').onchange=event=>{state.workflow=event.target.value;renderForm();saveLocal();};
$('#create-tab').onclick=()=>setInspector('create');$('#details-tab').onclick=()=>setInspector('details');
$('#asset-search').oninput=event=>{state.search=event.target.value;renderAssets();};
$('#asset-kind').onchange=event=>{state.filter=event.target.value;renderAssets();};
$('#library-board').addEventListener('input',event=>{
  if(event.target.id!=='library-search')return;
  const start=event.target.selectionStart;state.search=event.target.value;$('#asset-search').value=state.search;renderAssets();
  $('#library-search').focus();$('#library-search').setSelectionRange(start,start);
});
$('#library-board').addEventListener('change',event=>{if(event.target.id==='library-kind'){state.filter=event.target.value;$('#asset-kind').value=state.filter;renderAssets();}});
$('#favorites-filter').onclick=()=>{state.favorites=!state.favorites;$('#favorites-filter').setAttribute('aria-pressed',String(state.favorites));$('#favorites-filter').textContent=state.favorites?'★':'☆';renderAssets();};
$('#favorite-asset').onclick=async()=>{const asset=selectedAsset();if(!asset)return;try{await api('/api/assets/'+asset.id,{favorite:!asset.favorite});await refreshAssets();renderViewer();}catch(error){toast(error.message,true);}};
$('#choose-asset').onclick=()=>{if(state.selected)chooseAsset(state.selected);};
$('#compare-toggle').onclick=()=>{if(state.compare.length!==2)return;state.comparing=!state.comparing;state.view='workspace';$('#stage').hidden=false;$('#library-board').hidden=true;$('#recipes-board').hidden=true;$('#variation-section').hidden=false;document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view==='workspace');b.setAttribute('aria-pressed',String(b.dataset.view==='workspace'));});renderViewer();renderAssets();saveLocal();};
$('#import-button').onclick=()=>$('#import-files').click();
$('#import-files').onchange=event=>{importFiles(event.target.files).catch(error=>toast(error.message,true));event.target.value='';};
$('#stage').ondragover=event=>{event.preventDefault();$('#stage').classList.add('drag-over');};
$('#stage').ondragleave=()=>$('#stage').classList.remove('drag-over');
$('#stage').ondrop=event=>{event.preventDefault();$('#stage').classList.remove('drag-over');importFiles(event.dataTransfer.files).catch(error=>toast(error.message,true));};
$('#queue-toggle').onclick=()=>toggleQueue();$('#queue-close').onclick=()=>toggleQueue(false);
$('#pause-queue').onclick=async()=>{const button=$('#pause-queue');button.disabled=true;try{await api('/api/queue',{paused:!state.paused});await refreshWorkspace();}catch(error){$('#queue-error').textContent=error.message;}finally{button.disabled=false;}};
$('#project-select').onchange=event=>changeProject(event.target.value);
$('#new-project').onclick=()=>{$('#project-error').textContent='';$('#project-dialog').showModal();$('#project-name').focus();};
$('#close-project').onclick=()=>$('#project-dialog').close();
$('#project-form').onsubmit=async event=>{event.preventDefault();try{const project=await api('/api/projects',{name:$('#project-name').value});await refreshWorkspace();await changeProject(project.id);$('#project-select').value=project.id;$('#project-dialog').close();$('#project-name').value='';setView('workspace');toast('Project created.');}catch(error){$('#project-error').textContent=error.message;}};
$('#picker-close').onclick=()=>$('#asset-picker').close();
$('#rescan-assets').onclick=async()=>{const button=$('#rescan-assets');button.disabled=true;try{await api('/api/assets/rescan',{});await refreshAssets();toast('Existing Studio outputs indexed.');}catch(error){toast(error.message,true);}finally{button.disabled=false;}};
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!$('#queue-drawer').hidden)toggleQueue(false);
  if((event.ctrlKey||event.metaKey)&&event.key==='Enter'&&!document.querySelector('dialog[open]')&&!$('#create-panel').hidden&&!$('#submit-render')?.disabled){event.preventDefault();$('#render-form')?.requestSubmit();}
});
async function initialize() {
  try {
    state.catalog=await api('/api/workflows');
    if(!state.catalog[state.workflow])state.workflow='image';
    $('#workflow-select').innerHTML=['Image','Video','Edit','Finish'].map(category=>`<optgroup label="${category}">${workflows.filter(w=>w.category===category).map(w=>`<option value="${w.id}">${escapeHTML(w.name)}</option>`).join('')}</optgroup>`).join('');
    $('#workflow-select').value=state.workflow;
    await refreshWorkspace();await refreshAssets();renderForm();setView(state.view);renderDetails();
    state.loading=false;
    // Availability only enriches technical information; it never replaces the tested graph catalog.
    api('/api/library').then(data=>{for(const w of workflows)if(data.workflows[w.id])Object.assign(w,data.workflows[w.id]);}).catch(()=>{});
  }catch(error){$('#creation-form').innerHTML=`<p class="error-text">${escapeHTML(error.message)}</p><button class="button secondary" id="retry-initialize">Reconnect</button>`;$('#retry-initialize').onclick=initialize;}
}
initialize();
setInterval(refreshWorkspace,2500);
setInterval(()=>refreshAssets().catch(()=>{}),15000);
