let category = 'All', view = 'all', online = false, submitting = false, detailId = null;
const cards = document.querySelector('#cards'), dialog = document.querySelector('#detail');
const labels = {tested: 'Tested here', installed: 'Models installed', available: 'Models + nodes ready', partial: 'Setup incomplete', setup: 'Setup required'};
const viewNames = {all: 'Workflow library', ready: 'Models ready', saved: 'Saved workflows'};
function readStored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function storeValue(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing may restrict storage. */ }
}
const storedFavorites = readStored('studio-saved', []);
const saved = new Set(Array.isArray(storedFavorites) ? storedFavorites : []);
let activeJob = readStored('studio-active-job', null), lastJob = readStored('studio-last-job', null);
if (activeJob && (typeof activeJob.id !== 'string' || !/^[a-f0-9-]{36}$/.test(activeJob.id))) activeJob = null;
function resetFilters() {
  category = 'All';
  document.querySelector('#search').value = '';
  render();
}
function smokeLabel(w) {
  const q=w.qualityTests;
  if(q?.preview?.status==='passed'&&q?.high?.status==='passed')return 'Preview + High quality tested';
  if(q?.high?.status==='passed')return 'High quality tested';
  const t = w.renderTest;
  if (!t) return '';
  if (t.status === 'passed') return `GPU smoke test passed · ${Number(t.seconds).toFixed(1)}s`;
  return {running: 'GPU smoke test running…', failed: 'GPU smoke test failed', blocked: 'Render test waiting for setup'}[t.status] || '';
}
function smokeScope(w) {
  if(w.qualityTests?.high?.status==='passed') {
    const result=w.qualityTests.high, o=result.outputs[0];
    return `High quality sample: ${o.width} × ${o.height} · ${o.frames>1?o.frames+' frames':'one image'} · ${Math.round(result.seconds)}s in this test. Timing and appearance vary with inputs.`;
  }
  const output = w.renderTest?.outputs?.[0];
  if (!output) return '';
  const frames = Number(output.frames);
  return `Tested sample: ${Number(output.width)} × ${Number(output.height)}${frames > 1 ? ` · ${frames} frames` : ' · one image'}. Larger renders need separate testing.`;
}
function render() {
  const query = document.querySelector('#search').value.trim().toLowerCase();
  const filtered = workflows.filter(w => (category === 'All' || w.category === category) && (view !== 'ready' || ['tested', 'installed', 'available'].includes(w.status)) && (view !== 'saved' || saved.has(w.id)) && `${w.name} ${w.model} ${w.description}`.toLowerCase().includes(query));
  document.querySelector('#count').textContent = `${filtered.length} of ${workflows.length}`;
  document.querySelector('#view-name').textContent = viewNames[view];
  document.querySelector('#library-title').textContent = view === 'all' ? 'Explore workflows' : viewNames[view];
  document.querySelector('.feature').hidden = view !== 'all';
  document.querySelectorAll('[data-view]').forEach(b => { b.classList.toggle('active', b.dataset.view === view); b.setAttribute('aria-pressed', String(b.dataset.view === view)); });
  document.querySelectorAll('[data-category]').forEach(b => { b.classList.toggle('selected', b.dataset.category === category); b.setAttribute('aria-pressed', String(b.dataset.category === category)); });
  document.querySelector('#empty').hidden = filtered.length > 0;
  const noSaved = view === 'saved' && saved.size === 0;
  document.querySelector('#empty-title').textContent = noSaved ? 'Your shortlist starts here' : 'No workflows match';
  document.querySelector('#empty-copy').textContent = noSaved ? 'Use the heart on a workflow to save it here.' : 'Try a different search or reset the category filters.';
  document.querySelector('#reset-filters').textContent = noSaved ? 'Browse workflows' : 'Reset filters';
  cards.innerHTML = filtered.map(w => `<article class="card"><div class="card-top" style="--accent:${w.color}"><span class="glyph" aria-hidden="true">${w.glyph}</span><span class="category-label">${w.category.toUpperCase()}</span><button class="favorite ${saved.has(w.id) ? 'saved' : ''}" data-save="${w.id}" aria-label="${saved.has(w.id) ? 'Unsave' : 'Save'} ${w.name}" aria-pressed="${saved.has(w.id)}">${saved.has(w.id) ? '♥' : '♡'}</button></div><div class="card-body"><h3>${w.name}</h3><p>${w.description}</p><div class="smoke-result">${smokeLabel(w)}</div><div class="card-bottom"><span class="status-${w.status}"><i class="dot ${w.status === 'tested' ? 'green' : ['installed', 'available'].includes(w.status) ? 'blue' : 'amber'}"></i>${labels[w.status]}</span><button class="open-card" data-open="${w.id}" aria-label="Open workflow: ${w.name}">Open workflow →</button></div></div></article>`).join('');
}
async function status() {
  try {
    const data = await (await fetch('/api/status')).json(); online = data.online;
    document.querySelector('#connection').textContent = online ? `● Connected · ${data.running} running · ${data.pending} queued` : '○ ComfyUI offline';
  } catch { online = false; document.querySelector('#connection').textContent = '○ Studio connection lost'; }
  updateJobUI();
}
cards.addEventListener('click', event => {
  const open = event.target.closest('[data-open]'); if (open) openDetail(open.dataset.open);
  const save = event.target.closest('[data-save]');
  if (save) {
    const id = save.dataset.save;
    saved.has(id) ? saved.delete(id) : saved.add(id);
    storeValue('studio-saved', [...saved]); render();
    const replacement = cards.querySelector(`[data-save="${id}"]`);
    (replacement || document.querySelector('[data-view="saved"]')).focus();
  }
});
document.querySelectorAll('[data-category]').forEach(b => b.onclick = () => { category = b.dataset.category; render(); });
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { view = b.dataset.view; resetFilters(); });
document.querySelector('#reset-filters').onclick = () => { if (view === 'saved' && saved.size === 0) view = 'all'; resetFilters(); document.querySelector('#search').focus(); };
document.querySelector('#search').addEventListener('input', render);
document.querySelector('#hero-open').onclick = () => openDetail('animal');
document.querySelector('.close').onclick = () => dialog.close();
dialog.addEventListener('close', () => { detailId = null; });
dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
render(); status(); setInterval(status, 10000); if (activeJob) pollJob();

async function refreshLibrary() {
  const summary = document.querySelector('#library-status');
  try {
    const response = await fetch('/api/library');
    if (!response.ok) throw Error('Library check unavailable');
    const data = await response.json();
    for (const w of workflows) if (data.workflows[w.id]) Object.assign(w, data.workflows[w.id]);
    summary.textContent = `${workflows.filter(w => w.status === 'available').length} additional model sets ready · Shared library connected`;
    document.querySelector('#library-path').textContent = data.library + ' · Files read in place. No copies.';
    document.querySelector('#library-warnings').replaceChildren(...data.warnings.map(warning => { const item = document.createElement('li'); item.textContent = warning; return item; }));
    render();
  } catch {
    summary.textContent = 'Shared library check unavailable · Start ComfyUI to refresh availability';
    for (const w of workflows) if (['available', 'partial'].includes(w.status)) w.status = 'setup';
    render();
  }
}
refreshLibrary(); setInterval(refreshLibrary, 30000);

async function refreshRenderTests() {
  try {
    const response = await fetch('/api/render-tests');
    if (!response.ok) return;
    const report = await response.json();
    for (const w of workflows) {w.renderTest = report.workflows[w.id];w.qualityTests={preview:report.quality?.[w.id+':preview'],high:report.quality?.[w.id+':high']};}
    const high=workflows.filter(w=>w.qualityTests.high?.status==='passed').length, preview=workflows.filter(w=>w.qualityTests.preview?.status==='passed').length;
    document.querySelector('#test-summary').textContent = high||preview?`GPU render checks: ${preview}/18 Preview · ${high}/18 High quality. Results vary with your prompt and source material.`:`${workflows.filter(w => w.renderTest?.status === 'passed').length} of ${workflows.length} GPU smoke tests passed. Larger presets have separate render checks.`;
    render();
  } catch { /* Historical results remain useful during engine restarts. */ }
}
refreshRenderTests(); setInterval(refreshRenderTests, 15000);
