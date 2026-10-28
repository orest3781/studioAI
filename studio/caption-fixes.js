'use strict';
const readabilityFixes={asset:null,proposals:[],selected:0};
function readabilityLimits(){return CaptionReadability.settings(Object.fromEntries(Object.keys(CaptionReadability.defaults).map(k=>[k,Number($('#readability-'+k).value)])));}
function resetReadabilityFixes(){readabilityFixes.asset=null;readabilityFixes.proposals=[];if($('#readability-fix-preview')){$('#readability-fix-preview').hidden=true;$('#readability-fix-preview').replaceChildren();}}
function updateReadabilityFixPreview(){
 const button=$('#readability-fix-apply');if(!button)return;
 const proposal=readabilityFixes.proposals[readabilityFixes.selected];
 try{
  if(readabilityFixes.asset!==editor.asset?.id)throw Error('The selected asset changed.');
  CaptionFixModel.apply(editor.doc.cues,proposal,timelineDuration(),editor.doc.style.animation,readabilityLimits());
  button.disabled=false;$('#readability-fix-stale').textContent='';
 }catch{button.disabled=true;$('#readability-fix-stale').textContent='Captions, animation or reading targets changed. Generate fresh suggestions before applying.';}
}
function renderReadabilityFix(){
 const p=readabilityFixes.proposals[readabilityFixes.selected],body=$('#readability-fix-body');
 const metrics=r=>`${r.characters} characters · ${r.seconds.toFixed(3)}s · ${r.cps.toFixed(1)} characters/s across the phrase`;
 const range=c=>`${c.start.toFixed(3)}–${c.end.toFixed(3)}s`;
 const changes=p.type==='word-hold'?p.after[0].words.flatMap((w,i)=>w.end!==p.before.words[i].end?`<li>${escapeHTML(w.text)}: ${range(p.before.words[i])} → ${range(w)}</li>`:[]):[];
 body.innerHTML=`<p>${escapeHTML(p.explanation)}</p><h4>Before</h4><p>${range(p.before)} · ${escapeHTML(p.before.text)}</p><p class="field-note">${metrics(p.before_checks)}</p><h4>Proposed</h4>${p.after.map((c,i)=>`<p>${range(c)} · ${escapeHTML(c.text)}</p><p class="field-note">${metrics(p.after_checks[i])}</p>`).join('')}${changes.length?`<h4>Word timing changes</h4><ul>${changes.join('')}</ul>`:''}<h4>Remaining checks</h4>${p.after_checks.some(r=>r.issues.length)?p.after_checks.map((r,i)=>r.issues.length?`<p>Proposed phrase ${i+1}</p><ul>${r.issues.map(w=>`<li>${escapeHTML(w.message)}</li>`).join('')}</ul>`:'').join(''):'<p>Within the current reading targets. Review playback before saving.</p>'}`;
 updateReadabilityFixPreview();
}
function suggestReadabilityFixes(index){
 const box=$('#readability-fix-preview');resetReadabilityFixes();
 try{
  const result=CaptionFixModel.suggest(editor.doc.cues,index,timelineDuration(),editor.doc.style.animation,readabilityLimits());
  readabilityFixes.asset=editor.asset.id;readabilityFixes.proposals=result.proposals;readabilityFixes.selected=0;box.hidden=false;
  box.innerHTML=`<h4>Suggested fixes · caption ${index+1}</h4>${result.notes.map(n=>`<p class="field-note">${escapeHTML(n)}</p>`).join('')}${result.proposals.length?`<label>Suggested change<select id="readability-fix-select" aria-label="Suggested change">${result.proposals.map((p,i)=>`<option value="${i}">${escapeHTML(p.title)}</option>`).join('')}</select></label><div id="readability-fix-body" class="readability-fix-body"></div><p id="readability-fix-stale" role="status" class="field-note"></p><button type="button" class="button primary" id="readability-fix-apply">Apply suggested fix</button>`:''}<button type="button" class="button secondary" id="readability-fix-dismiss">Dismiss suggestions</button>`;
  $('#readability-fix-dismiss').onclick=resetReadabilityFixes;
  if(result.proposals.length){
   $('#readability-fix-select').onchange=event=>{readabilityFixes.selected=Number(event.target.value);renderReadabilityFix();};
   $('#readability-fix-apply').onclick=()=>{
    try{
     const p=readabilityFixes.proposals[readabilityFixes.selected];if(readabilityFixes.asset!==editor.asset.id)throw Error('The selected asset changed. Generate fresh suggestions.');
     const next=CaptionFixModel.apply(editor.doc.cues,p,timelineDuration(),editor.doc.style.animation,readabilityLimits());
     editingMedia().pause();captionTimeline.selected=p.index;captionTimeline.word=0;
     commitTimeline(next,editor.doc.cues,'Suggested fix applied. Undo is available. Review playback, then save.');
     selectTimelineCaption(p.index);resetReadabilityFixes();$('#editing-error').textContent='';
    }catch(error){$('#editing-error').textContent=error.message;updateReadabilityFixPreview();}
   };
   renderReadabilityFix();
  }
  box.scrollIntoView({block:'nearest'});
 }catch(error){box.hidden=false;box.textContent=error.message;}
}
function setupReadabilityFixes(){$('#readability-results').insertAdjacentHTML('afterend','<section id="readability-fix-preview" aria-label="Suggested caption fix preview" hidden></section>');}
