'use strict';
const captionStyleKeys=['position','size','margin','font','bold','color','active_color','outline_color','outline','animation'];
function estimateCaptionWords(cue){
 let tokens=cue.text.match(/\S+/gu)||[];if(cue.end-cue.start<tokens.length*.001)tokens=[cue.text];
 return tokens.map((text,i)=>({text,start:Math.round((cue.start+(cue.end-cue.start)*i/tokens.length)*1000)/1000,end:Math.round((cue.start+(cue.end-cue.start)*(i+1)/tokens.length)*1000)/1000}));
}
function prepareCaptionCue(cue,words=[]){
 if(!cue.words){const matched=words.filter(w=>w.start>=cue.start&&w.end<=cue.end);cue.words=matched.length?structuredClone(matched):estimateCaptionWords(cue);cue.timing=matched.length?'speech':'estimated';}
 return cue;
}
function captionTimingLabel(cue){return ({speech:'Speech timing',manual:'Adjusted timing',aligned:'Aligned timing · review words',estimated:'Estimated timing · review words'})[cue.timing]||'Estimated timing · review words';}
function wordTimingMarkup(cue,index){prepareCaptionCue(cue);return `<details class="caption-word-details" data-word-details="${index}"><summary>${captionTimingLabel(cue)}</summary><div data-word-fields></div></details>`;}
function fillWordFields(detail){
 const i=Number(detail.dataset.wordDetails),cue=editor.doc.cues[i];if(!cue)return;
 detail.querySelector('summary').textContent=captionTimingLabel(cue);
 if(!detail.open)return;
 detail.querySelector('[data-word-fields]').innerHTML=`<p class="field-note">Times are seconds in the source. Keep words inside this caption, without overlaps. Text or caption-time edits reset word timing to estimates.</p>`+cue.words.map((w,n)=>`<div class="caption-word-row"><span>${escapeHTML(w.text)}</span><label>Start<input type="number" step="0.01" min="${cue.start}" max="${cue.end}" value="${w.start}" data-word-index="${n}" data-word-field="start" aria-label="Caption ${i+1} word ${n+1} start"></label><label>End<input type="number" step="0.01" min="${cue.start}" max="${cue.end}" value="${w.end}" data-word-index="${n}" data-word-field="end" aria-label="Caption ${i+1} word ${n+1} end"></label></div>`).join('')+`<button type="button" class="button secondary" data-estimate-words="${i}">Reset to estimated timing</button>`;
}
function drawAnimatedCaption(cue,style,caption){
 caption.replaceChildren();caption.style.fontFamily=style.font;caption.style.fontWeight=style.bold?'700':'400';caption.style.color=style.color;
 const outline=Math.max(0,Number(style.outline)||0)*.65;
 caption.style.webkitTextStroke=outline+'px '+style.outline_color;caption.style.paintOrder='stroke fill';caption.style.textShadow='0 1px 1px '+style.outline_color;
 if(!cue)return;prepareCaptionCue(cue);const t=editingTime(),active=cue.words.findIndex(w=>w.start<=t&&t<w.end);
 if(style.animation==='word'){
  if(active<0)return;const word=cue.words[active],span=document.createElement('span');span.textContent=word.text;span.className='caption-active-word';span.style.color=style.active_color;span.style.display='inline-block';
  const ramp=Math.min(.12,(word.end-word.start)/2),scale=1+.1*Math.max(0,1-(t-word.start)/ramp);span.style.transform=`scale(${scale})`;caption.append(span);return;
 }
 if(style.animation!=='highlight'||active<0){caption.textContent=cue.text;return;}
 let cursor=0;for(let i=0;i<cue.words.length;i++){
  const word=cue.words[i],a=cue.text.indexOf(word.text,cursor);if(a<0){caption.textContent=cue.text;return;}
  caption.append(document.createTextNode(cue.text.slice(cursor,a)));const span=document.createElement('span');span.textContent=word.text;
  if(i===active){span.style.color=style.active_color;span.className='caption-active-word';}caption.append(span);cursor=a+word.text.length;
 }caption.append(document.createTextNode(cue.text.slice(cursor)));
}
function syncCaptionStyleControls(){
 for(const key of captionStyleKeys){const input=$('#editing-caption-'+key);if(input.type==='checkbox')input.checked=!!editor.doc.style[key];else input.value=editor.doc.style[key];}
}
async function loadCaptionStyles(){
 try{const data=await api('/api/caption-styles');editor.styles=data.styles;
  $('#caption-style-preset').innerHTML='<option value="">Custom settings</option>'+data.styles.map(p=>`<option value="${p.id}">${escapeHTML(p.name)}${p.builtin?' · built-in':''}</option>`).join('');
  editor.stylePreset=data.styles.find(p=>captionStyleKeys.every(k=>p.style[k]===editor.doc.style[k]))?.id||'';
  $('#caption-style-preset').value=editor.stylePreset;updateStyleSelection();$('#caption-style-status').textContent='Styles are saved on this PC and reusable across projects.';
 }catch(error){$('#caption-style-status').textContent=error.message;}
}
function updateStyleSelection(){const preset=editor.styles?.find(p=>p.id===editor.stylePreset);$('#caption-style-update').disabled=!preset||preset.builtin;$('#caption-style-name').value=preset?(preset.builtin?'My '+preset.name:preset.name):'';}
async function saveCaptionStyle(update){
 const button=$('#caption-style-'+(update?'update':'save'));button.disabled=true;
 try{const preset=editor.styles?.find(p=>p.id===editor.stylePreset);const payload={name:$('#caption-style-name').value,style:structuredClone(editor.doc.style)};
  if(update){if(!preset||preset.builtin)throw Error('Select one of your saved styles to update.');payload.id=preset.id;payload.revision=preset.revision;}
  const saved=await api('/api/caption-styles',payload);await loadCaptionStyles();editor.stylePreset=saved.id;$('#caption-style-preset').value=saved.id;updateStyleSelection();$('#caption-style-status').textContent=`“${saved.name}” saved locally. Existing captions and queued exports keep their own settings.`;
 }catch(error){$('#caption-style-status').textContent=error.message;}finally{button.disabled=false;updateStyleSelection();}
}
function setupCaptionStyles(){
 $('#editing-caption-panel .form-row').insertAdjacentHTML('beforebegin',`<section class="caption-style-panel" aria-label="Caption styles">
 <h3>Caption style</h3><label>Reusable style<select id="caption-style-preset" aria-label="Reusable style"><option value="">Custom settings</option></select></label>
 <div class="form-row"><label>Animation<select id="editing-caption-animation" aria-label="Caption animation"><option value="static">Full caption · static</option><option value="highlight">Highlight current word</option><option value="word">One word at a time · pop</option></select></label><label>Font<select id="editing-caption-font" aria-label="Caption font"><option>Arial</option><option>Segoe UI</option><option>Verdana</option><option>Georgia</option></select></label></div>
 <div class="caption-color-row"><label>Text<input id="editing-caption-color" type="color" aria-label="Caption text color"></label><label>Active word<input id="editing-caption-active_color" type="color" aria-label="Active word color"></label><label>Outline<input id="editing-caption-outline_color" type="color" aria-label="Caption outline color"></label></div>
 <div class="form-row"><label class="caption-bold-check"><input id="editing-caption-bold" type="checkbox" aria-label="Bold captions">Bold</label><label>Outline weight<input id="editing-caption-outline" type="number" min="0" max="6" step="0.5" aria-label="Caption outline weight"></label></div>
 <details><summary>Save a reusable style</summary><label>Style name<input id="caption-style-name" maxlength="60" placeholder="My social captions" aria-label="Caption style name"></label><div class="editing-actions"><button id="caption-style-save" type="button" class="button secondary">Save new style</button><button id="caption-style-update" type="button" class="button secondary" disabled>Update selected style</button></div></details>
 <p id="caption-style-status" class="field-note" role="status"></p><p class="field-note">Animation is burned into video exports. SRT/VTT keep the complete caption text and timing. Fonts are local; no downloads are needed.</p></section>`);
 for(const key of captionStyleKeys){const input=$('#editing-caption-'+key);input.oninput=()=>{editor.doc.style[key]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;editingChanged();$('#caption-style-status').textContent='Style changed in this draft. Save edits to use it in exports.';};}
 $('#caption-style-preset').onchange=event=>{editor.stylePreset=event.target.value;const preset=editor.styles.find(p=>p.id===editor.stylePreset);if(preset){editor.doc.style=structuredClone(preset.style);syncCaptionStyleControls();editingChanged();}updateStyleSelection();};
 $('#caption-style-save').onclick=()=>saveCaptionStyle(false);$('#caption-style-update').onclick=()=>saveCaptionStyle(true);
 $('#editing-cues').addEventListener('toggle',event=>{if(event.target.matches('[data-word-details]'))fillWordFields(event.target);},true);
 $('#editing-cues').addEventListener('input',event=>{const field=event.target.dataset.wordField;if(!field)return;const cue=editor.doc.cues[Number(event.target.closest('[data-cue]').dataset.cue)];cue.words[Number(event.target.dataset.wordIndex)][field]=Number(event.target.value);cue.timing='manual';event.target.closest('details').querySelector('summary').textContent=captionTimingLabel(cue);editingChanged();});
 $('#editing-cues').addEventListener('click',event=>{const button=event.target.closest('[data-estimate-words]');if(!button)return;const cue=editor.doc.cues[Number(button.dataset.estimateWords)];cue.words=estimateCaptionWords(cue);cue.timing='estimated';fillWordFields(button.closest('details'));editingChanged();});
 let frame=0;
 function tick(){if(!editingDialog.open||editingMedia().paused)return;$('#editing-time').value=editingMedia().currentTime.toFixed(3);syncEditingPosition();frame=requestAnimationFrame(tick);}
 for(const name of ['video','audio']){const media=$('#editing-'+name);media.addEventListener('play',()=>{cancelAnimationFrame(frame);tick();});media.addEventListener('pause',()=>cancelAnimationFrame(frame));}
 editingDialog.addEventListener('close',()=>cancelAnimationFrame(frame));
}
