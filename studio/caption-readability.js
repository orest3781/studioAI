'use strict';
let readabilitySignature='';
function updateCaptionReadability(){
 if(!$('#readability-results')||!editor.doc)return;
 updateReadabilityFixPreview();
 try{
  const limits=CaptionReadability.settings(Object.fromEntries(Object.keys(CaptionReadability.defaults).map(k=>[k,Number($('#readability-'+k).value)])));
  const signature=JSON.stringify([editor.asset?.id,editor.doc.cues,editor.doc.style.animation,limits]);if(signature===readabilitySignature)return;readabilitySignature=signature;
  const rows=CaptionReadability.analyze(editor.doc.cues,timelineDuration(),editor.doc.style.animation,limits),flagged=rows.filter(r=>r.issues.length);
  $('#readability-summary').textContent=!rows.length?'Add captions to check readability.':`${flagged.length} of ${rows.length} captions need review${flagged.length?'':' · within your targets'}.`;
  $('#readability-results').innerHTML=flagged.map(r=>`<article class="readability-item"><button type="button" class="button secondary" data-readability-cue="${r.index}">Review caption ${r.index+1}</button><button type="button" class="button secondary" data-readability-fix="${r.index}">Suggest fixes for caption ${r.index+1}</button><p>${escapeHTML(r.text||'(empty caption)')}</p><p class="field-note">${r.characters} characters${r.seconds!==null?` · ${r.seconds.toFixed(2)}s · ${r.cps.toFixed(1)} characters/s across the full phrase`:''}</p><ul>${r.issues.map(i=>`<li>${escapeHTML(i.message)}</li>`).join('')}</ul></article>`).join('');
  $('#readability-error').textContent='';
 }catch(error){readabilitySignature='';$('#readability-summary').textContent='Readability checks paused';$('#readability-results').replaceChildren();$('#readability-error').textContent=error.message;}
}
function setupCaptionReadability(){
 $('.caption-phrases').insertAdjacentHTML('beforebegin',`<section class="caption-readability" aria-labelledby="readability-heading"><h3 id="readability-heading">Readability checks</h3><p class="field-note">Live checks for your draft. Targets are editable guidance, not a guarantee of readability or platform approval. Characters include spaces and punctuation. Word-pop checks use individual word timings; phrase length also applies to SRT/VTT.</p><details><summary>Reading targets</summary><div class="form-row">${[['characters','Characters per phrase',10,300,1],['cps','Characters per second',5,60,1],['minimum','Minimum display seconds',.1,3,.1],['maximum','Maximum display seconds',1,28,.5]].map(([key,label,min,max,step])=>`<label>${label}<input id="readability-${key}" aria-label="${label}" type="number" min="${min}" max="${max}" step="${step}" value="${CaptionReadability.defaults[key]}"></label>`).join('')}</div><button type="button" class="button secondary" id="readability-reset">Reset reading targets</button><p class="field-note">Targets stay in this browser. Word-pop also flags words shorter than 0.12s. Export remains available. Suggested fixes change captions only after you preview and apply them with Undo.</p></details><p id="readability-summary" role="status"></p><p id="readability-error" class="error-text" role="alert"></p><div id="readability-results" aria-label="Caption readability warnings"></div></section>`);
 try{const saved=localStorage.getItem('studio-readability-targets');if(saved){const limits=CaptionReadability.settings(JSON.parse(saved));for(const key of Object.keys(CaptionReadability.defaults))$('#readability-'+key).value=limits[key];}}catch{}
 const changed=()=>{readabilitySignature='';updateCaptionReadability();try{const limits=CaptionReadability.settings(Object.fromEntries(Object.keys(CaptionReadability.defaults).map(k=>[k,Number($('#readability-'+k).value)])));localStorage.setItem('studio-readability-targets',JSON.stringify(limits));}catch{}};
 for(const key of Object.keys(CaptionReadability.defaults))$('#readability-'+key).oninput=changed;
 $('#readability-reset').onclick=()=>{for(const key of Object.keys(CaptionReadability.defaults))$('#readability-'+key).value=CaptionReadability.defaults[key];changed();};
 $('#readability-results').onclick=event=>{const fix=event.target.closest('[data-readability-fix]');if(fix){suggestReadabilityFixes(Number(fix.dataset.readabilityFix));return;}const button=event.target.closest('[data-readability-cue]');if(!button)return;editingMedia().pause();const index=Number(button.dataset.readabilityCue);selectTimelineCaption(index,Number.isFinite(editor.doc.cues[index]?.start));$('#timeline-caption-select').focus();};
 updateCaptionReadability();
}
