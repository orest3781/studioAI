'use strict';
const captionPhrases={preview:null,asset:null};
function resetCaptionPhrasePreview(){captionPhrases.preview=null;captionPhrases.asset=null;if($('#phrase-preview')){$('#phrase-preview').hidden=true;$('#phrase-preview').replaceChildren();}updateCaptionPhraseControls();}
function updateCaptionPhraseControls(){
 if(!$('#phrase-plan'))return;
 $('#phrase-plan').disabled=!editor.doc?.cues.length;
 const button=$('#phrase-apply');if(!button)return;
 let stale=true;try{stale=captionPhrases.asset!==editor.asset?.id||CaptionPhraseModel.signature(editor.doc.cues)!==captionPhrases.preview.input_signature;}catch{}
 button.disabled=stale||!captionPhrases.preview.changed;
 $('#phrase-stale').textContent=stale?'Captions changed. Preview phrase splits again.':'';
}
function setupCaptionPhrases(){
 $('.caption-alignment').insertAdjacentHTML('beforebegin',`<section class="caption-phrases" aria-labelledby="phrase-heading"><h3 id="phrase-heading">Readable phrases</h3><p class="field-note">Split long captions at punctuation, pauses and word boundaries. Word timing stays intact; shorter phrases fit local alignment. Preview and apply with Undo.</p><div class="form-row"><label>Phrase length<select id="phrase-length" aria-label="Phrase length"><option value="short">Short · up to 4 words</option><option value="balanced" selected>Balanced · up to 6 words</option><option value="relaxed">Longer · up to 8 words</option></select></label><label>Split scope<select id="phrase-scope" aria-label="Split scope"><option value="all">All captions</option><option value="selected">Selected caption</option></select></label></div><p class="field-note" id="phrase-limits"></p><button type="button" class="button secondary" id="phrase-plan">Preview phrase splits</button><div id="phrase-preview" hidden></div></section>`);
 function settings(){resetCaptionPhrasePreview();const p=CaptionPhraseModel.presets[$('#phrase-length').value];$('#phrase-limits').textContent=`Targets: ${p.characters} characters · ${p.seconds} seconds per phrase. Whole words are never cut. All processing stays on this PC.`;}
 for(const id of ['phrase-length','phrase-scope'])$('#'+id).onchange=settings;settings();
 $('#phrase-plan').onclick=()=>{
  try{
   const indices=$('#phrase-scope').value==='selected'?[captionTimeline.selected]:editor.doc.cues.map((_,i)=>i);
   const preview=CaptionPhraseModel.plan(editor.doc.cues,timelineDuration(),{preset:$('#phrase-length').value,indices});
   captionPhrases.preview=preview;captionPhrases.asset=editor.asset.id;
   const box=$('#phrase-preview');box.hidden=false;
   box.innerHTML=`<p role="status">${preview.changed?`${preview.changed} caption${preview.changed===1?'':'s'} reshaped · ${preview.added} new phrase${preview.added===1?'':'s'} · ${preview.cues.length} captions total`:preview.entries.some(e=>e.warnings.length)?'No automatic changes available. Review the notes below.':'These captions already fit the selected phrase length.'}</p>${preview.entries.flatMap(e=>e.warnings.map(w=>`<p class="field-note">Caption ${e.index+1}: ${escapeHTML(w)}</p>`)).join('')}<details class="phrase-review" ${preview.changed?'open':'hidden'}><summary>Review phrase splits</summary><ol>${preview.entries.filter(e=>e.changed).map(e=>`<li><strong>Caption ${e.index+1} → ${e.count} phrase${e.count===1?'':'s'}</strong>${preview.cues.slice(e.offset,e.offset+e.count).map(c=>`<p><span class="muted">${c.start.toFixed(3)}–${c.end.toFixed(3)}s</span> ${escapeHTML(c.text)}</p>`).join('')}</li>`).join('')}</ol></details><p id="phrase-stale" class="field-note" role="status"></p><div class="editing-actions"><button type="button" class="button primary" id="phrase-apply">Apply phrase splits</button><button type="button" class="button secondary" id="phrase-dismiss">Dismiss preview</button></div>`;
   $('#phrase-dismiss').onclick=resetCaptionPhrasePreview;
   $('#phrase-apply').onclick=()=>{
    try{
     if(captionPhrases.asset!==editor.asset.id)throw Error('Choose this asset again and preview its captions.');
     const before=editor.doc.cues,next=CaptionPhraseModel.apply(before,preview,timelineDuration());
     const selected=Math.max(0,next.findIndex(c=>c.start<=editingTime()&&editingTime()<c.end));
     editingMedia().pause();captionTimeline.selected=selected;captionTimeline.word=0;
     commitTimeline(next,before,'Phrase splits applied. Review playback, align if needed, then save.');
     resetCaptionPhrasePreview();$('#editing-error').textContent='';
    }catch(error){$('#editing-error').textContent=error.message;updateCaptionPhraseControls();}
   };
   updateCaptionPhraseControls();$('#editing-error').textContent='';
  }catch(error){resetCaptionPhrasePreview();$('#editing-error').textContent=error.message;}
 };
}
