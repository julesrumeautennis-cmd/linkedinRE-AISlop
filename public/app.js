import {samples} from './samples.js';
import {drawPrint} from './print.js';

const $=selector=>document.querySelector(selector);
const dbReady=new Promise((resolve,reject)=>{
  const request=indexedDB.open('offscript-feed',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('posts',{keyPath:'id'});
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
});
async function localData(method,value){
  const db=await dbReady;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('posts',method==='getAll'?'readonly':'readwrite');
    const store=tx.objectStore('posts'), req=value===undefined?store[method]():store[method](value);
    tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
  });
}
const posts=samples.map(p=>({...p}));
const expanded=new Set(), unfolded=new Set(), openVoices=new Set(), disclosures=new Set(), busy=new Set();
const blobUrls=new Map();
let filter=false, batch=false, state={state:'checking'}, timer, recordingCleanup=null;
const modal=$('#modal');
const labels={ai:'Likely AI',human:'Likely human',mixed:'Mixed authorship',uncertain:'Uncertain'};
function element(tag, cls='', content=''){
  const node=document.createElement(tag);
  if(cls)node.className=cls;
  if(content)node.textContent=content;
  return node;
}
function button(label,cls,action){
  const b=element('button',cls,label);b.type='button';b.addEventListener('click',action);return b;
}
function toast(msg){
  $('#toast').textContent=msg;clearTimeout(timer);
  timer=setTimeout(()=>$('#toast').textContent='',4400);
}
function dialog(title){
  if(modal.open)modal.close();
  const body=$('#dialog-body');body.replaceChildren();
  const heading=element('h2','',title);heading.id='dialog-title';body.append(heading);
  modal.setAttribute('aria-labelledby',heading.id);modal.showModal();return body;
}
modal.querySelector('.close').onclick=()=>modal.close();
modal.addEventListener('click',e=>{if(e.target===modal){
  const box=modal.getBoundingClientRect();
  if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)modal.close();
}});
modal.addEventListener('close',()=>{if(recordingCleanup){recordingCleanup();recordingCleanup=null;}});
function setState(next){
  state=next;const pill=$('#api-status');pill.dataset.state=next.state;
  pill.querySelector('span').textContent=({connected:'Pangram connected',credits:'API credits needed',missing:'Set up Pangram',error:'Check connection',checking:'Checking API'})[next.state]||'Check API';
}
async function checkStatus(){
  try{const r=await fetch('/api/status');if(!r.ok)throw Error();setState(await r.json());}
  catch{setState({state:'error',message:'Could not reach the local server.'});}
}
$('#api-status').onclick=()=>{
  const body=dialog('Pangram connection');
  const msg=element('p','',state.message||'Checking connection…');
  body.append(msg,button('Check again','dark-btn',async e=>{
    e.currentTarget.disabled=true;await checkStatus();msg.textContent=state.message;
    body.querySelector('button').disabled=false;
  }));
};
$('#method').onclick=()=>{
  const body=dialog('How Offscript works');
  for(const [head,copy] of [
    ['Check the writing','Add at least 50 words. Offscript sends the post text to Pangram when you scan it. Your name, impressions and audio stay in this browser.'],
    ['Filter the feed','Hide likely AI folds high-confidence AI results. Until scanned, posts whose authors disclose AI authorship can also be folded. Mixed and uncertain results stay visible. You can reopen any post.'],
    ['Hear the original','Play the original recording when a contributor has attached one. For the Apollo 13 example, the audio is NASA’s 1970 mission recording.'],
    ['Where the feed comes from','The starter feed contains three AI-written demonstrations and three historical excerpts. You can add your own posts and actual impression counts.']
  ])body.append(element('h3','',head),element('p','',copy));
};
drawPrint($('#print'));
function scanText(p){return p.own?p.body:p.title+'\n\n'+p.body;}
function longEnough(p){return scanText(p).trim().split(/\s+/).length>=50;}
function eligible(p){return p.result?p.result.kind==='ai':Boolean(p.disclosed);}
function tagFor(p){if(p.result)return [p.result.kind,labels[p.result.kind]];if(p.disclosed&&(!p.own||disclosures.has(p.id)))return ['disclosed','Disclosed AI'];if(p.archive)return ['archive','Archive'];return ['','Unscanned'];}
function avatar(p){const a=element('span','avatar '+p.theme,p.mark);a.setAttribute('aria-hidden','true');return a;}
function repaintCard(p){
  const prior=document.getElementById('post-'+p.id);
  if(prior)prior.replaceWith(card(p));else $('#cards').prepend(card(p));
}
function audioUrl(p){
  if(p.audio)return p.audio;
  if(!p.voice)return '';
  if(!blobUrls.has(p.id))blobUrls.set(p.id,URL.createObjectURL(p.voice));
  return blobUrls.get(p.id);
}
function addVoice(p,container){
  const box=element('div','voice');box.append(element('b','',p.audioTitle||'Your original recording'));
  const player=document.createElement('audio');player.controls=true;player.preload='metadata';player.src=audioUrl(p);
  player.setAttribute('aria-label',p.audioTitle||'Original voice recording');
  player.onplay=()=>document.querySelectorAll('audio').forEach(a=>{if(a!==player)a.pause();});
  box.append(player);
  if(p.url){const a=element('a','source-line',p.source);a.href=p.url;a.target='_blank';a.rel='noreferrer';box.append(a);}
  container.append(box);return player;
}
function activateVoice(p,scroll=false){
  unfolded.add(p.id);openVoices.add(p.id);repaintCard(p);
  const box=document.getElementById('post-'+p.id);if(scroll)box.scrollIntoView({block:'center',behavior:'instant'});
  box.querySelector('audio').play().catch(()=>toast('Press play to hear the original.'));
}
function detailsFor(p){
  const body=dialog(labels[p.result.kind]||'Pangram result');body.append(element('p','',p.result.prediction||p.result.headline));
  const entries=Object.entries(p.result.shares||{}), names={ai:'AI-written',ai_assisted:'AI-assisted',human:'Human-written'};
  if(entries.length){body.append(element('h3','','Share of the text'));for(const [k,v] of entries)body.append(element('p','',names[k]+' · '+v+'%'));}
  body.append(element('small','','Pangram '+p.result.version+' · Estimates of the submitted text.'));
}
function card(p){
  const item=element('article','card');item.id='post-'+p.id;
  const top=element('div','card-top'), by=element('div','byline');
  by.append(element('strong','',p.name),element('p','',p.meta));top.append(avatar(p),by);item.append(top);
  const [type,label]=tagFor(p), folded=filter&&eligible(p)&&!unfolded.has(p.id);
  if(folded){
    item.classList.add('folded');by.lastChild.textContent=(p.disclosed&&!p.result?'Author-disclosed AI':label)+' · Folded';
    top.append(button('Show post','linkish',()=>{unfolded.add(p.id);repaintCard(p);}));return item;
  }
  top.append(element('span','tag '+type,label));
  if(p.own && p.impressions){
    const metric=element('div','reach');metric.append(element('strong','',Number(p.impressions).toLocaleString('en-US')),element('span','','impressions · reported by author'));item.append(metric);
  }
  if(p.title)item.append(element('h3','',p.title));
  const text=element('p','post-body'+(expanded.has(p.id)?'':' clamp'),p.body);item.append(text);
  if(p.body.length>190)item.append(button(expanded.has(p.id)?'Read less':'Read more','linkish',()=>{
    if(expanded.has(p.id))expanded.delete(p.id);else expanded.add(p.id);repaintCard(p);
  }));
  if(p.own && p.disclosed && disclosures.has(p.id)){
    const quote=element('blockquote','disclosure','“I wrote this post with AI.”');quote.append(element('cite','','Author disclosure'));item.append(quote);
  }
  const actions=element('div','actions');
  const scan=button(p.result?'Scan details':busy.has(p.id)?'Scanning…':'Scan with Pangram','action',()=>p.result?detailsFor(p):runSingle(p));
  scan.prepend(element('span','scan-icon'));scan.disabled=busy.has(p.id)||(!p.result&&batch);actions.append(scan);
  if(p.own&&p.disclosed)actions.append(button(disclosures.has(p.id)?'Hide disclosure':'Reveal who wrote it','action',()=>{
    if(disclosures.has(p.id))disclosures.delete(p.id);else disclosures.add(p.id);repaintCard(p);
  }));
  if(p.audio||p.voice){
    const voice=button(openVoices.has(p.id)?'Close recording':'Hear the original','action audio-action',()=>{
      if(openVoices.delete(p.id))repaintCard(p);else activateVoice(p);
    });voice.prepend(element('span','play-icon'));actions.append(voice);
  }else if(p.url){
    const a=element('a','action','Read original');a.href=p.url;a.target='_blank';a.rel='noreferrer';actions.append(a);
  }
  if(p.own&&!busy.has(p.id)&&!batch)actions.append(button('Remove','action',()=>{
    const body=dialog('Remove this post?');body.append(element('p','','This removes the post and its recording from this browser.'),
      button('Remove post','dark-btn',async()=>{try{await localData('delete',p.id);posts.splice(posts.indexOf(p),1);if(blobUrls.has(p.id)){URL.revokeObjectURL(blobUrls.get(p.id));blobUrls.delete(p.id);}modal.close();render();}catch{toast('Could not remove this local post.');}}));
  }));
  item.append(actions);
  if(openVoices.has(p.id))addVoice(p,item);
  return item;
}
function render(){
  $('#cards').replaceChildren(...posts.map(card));stats();
}
function stats(){
  const done=posts.filter(p=>p.result).length;
  $('#count').textContent=posts.length;$('#scanned').textContent=done;$('#scan-total').textContent='/ '+posts.length;
  const totals={ai:0,human:0,mixed:0,unscanned:0};
  for(const p of posts){const kind=p.result?.kind||'unscanned';totals[kind==='uncertain'?'mixed':kind]++;}
  const meter=$('#meter'),legend=$('#legend');meter.replaceChildren();legend.replaceChildren();
  for(const [key,name] of [['ai','Likely AI'],['human','Likely human'],['mixed','Mixed / uncertain'],['unscanned','Unscanned']]){
    if(totals[key]){const part=element('i',key+'-color');part.style.flexGrow=totals[key];meter.append(part);}
    const row=element('div');row.append(element('i',key+'-color'),document.createTextNode(name),element('b','',String(totals[key])));legend.append(row);
  }
  const scanAll=$('#scan-all');
  const ready=posts.some(p=>!p.result&&longEnough(p));
  scanAll.textContent=batch?'Scanning…':done===posts.length?'Feed scanned':ready?'Scan the feed':'No eligible posts';
  scanAll.disabled=batch||busy.size>0||!ready;
  const note=$('#filter-note');note.hidden=!filter;
  note.textContent='Folding likely AI results and posts with disclosed AI authorship. Every post can be reopened.';
}
$('#filter').onchange=e=>{filter=e.target.checked;unfolded.clear();render();};
$('#hear-tape').onclick=()=>activateVoice(posts.find(p=>p.id==='apollo'),true);
async function save(p){
  const stored=p.own?p:{id:p.id,scannedText:scanText(p),result:p.result};
  await localData('put',stored);
}
async function scanPost(p){
  busy.add(p.id);repaintCard(p);stats();
  try{
    const r=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:scanText(p)})});
    const data=await r.json();
    if(!r.ok){if(r.status===402)setState({state:'credits',message:data.error});throw Object.assign(new Error(data.error||'Scan failed. Try again.'),{status:r.status});}
    p.result=data;
    try{await save(p);}catch{toast('Scan complete. This browser could not save the result.');}
  }finally{busy.delete(p.id);repaintCard(p);stats();}
}
function showFailure(message){
  const note=$('#scan-progress');note.textContent=message;toast(message);
}
async function runSingle(p){
  if(busy.has(p.id)||batch)return;
  try{await scanPost(p);$('#scan-progress').textContent='';detailsFor(p);}catch(e){showFailure(e.message);}
}
$('#scan-all').onclick=async()=>{
  if(batch||busy.size)return;
  batch=true;render();
  const todo=posts.filter(p=>!p.result&&longEnough(p));
  let skipped=posts.filter(p=>!p.result&&!longEnough(p)).length;
  try{
    for(const [i,p] of todo.entries()){
      $('#scan-progress').textContent='Analyzing '+(i+1)+' of '+todo.length+'…';
      try{await scanPost(p);}catch(e){if(e.status===422)skipped++;else throw e;}
    }
    $('#scan-progress').textContent=skipped?'Scan complete. Unclassified posts remaining: '+skipped+'.':'Feed scan complete.';
  }catch(e){showFailure(e.message);}
  finally{batch=false;render();}
};

function composer(){
  const body=dialog('Add your post');
  body.insertAdjacentHTML('beforeend',`
    <p>Paste the post exactly as you published it.</p>
    <form id="compose">
      <label class="field"><span>Post text</span><textarea name="text" maxlength="24000" placeholder="Paste your LinkedIn post here…" required></textarea></label>
      <label class="checkline"><input type="checkbox" name="disclosed"> I wrote this post with AI <small>(optional disclosure)</small></label>
      <details><summary>Add a name, impressions or original voice</summary>
        <label class="field"><span>Display name</span><input name="author" maxlength="60" placeholder="Your post"></label>
        <label class="field"><span>Impressions</span><input name="impressions" type="number" min="0" max="9999999999" step="1" placeholder="Actual post impressions"></label>
        <label class="field"><span>Original recording</span><input type="file" name="audio" accept="audio/*,.m4a,.webm,.mp3,.wav,.ogg"></label>
        <button type="button" id="record" class="secondary">Record a voice note</button>
        <small id="record-state" role="status"></small>
      </details>
      <div class="formfoot"><span id="word-count">0 words · 50 to scan</span><button class="dark-btn" type="submit">Add to feed</button></div>
      <small id="form-feedback" aria-live="polite"></small>
    </form>`);
  const form=$('#compose'), input=form.elements.text, file=form.elements.audio,recordBtn=$('#record');
  let recorder=null,stream=null,voice=null,active=true,captureTimer=null,capturing=false;
  function stopTracks(){if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;}
  recordingCleanup=()=>{active=false;clearTimeout(captureTimer);if(recorder?.state==='recording')recorder.stop();stopTracks();};
  input.addEventListener('input',()=>{
    const n=input.value.trim().split(/\s+/).filter(Boolean).length;
    $('#word-count').textContent=n+' word'+(n===1?'':'s')+(n<50?' · 50 to scan':'');
  });
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)recordBtn.hidden=true;
  recordBtn.onclick=async()=>{
    if(recorder?.state==='recording'){recorder.stop();return;}
    try{
      recordBtn.disabled=true;capturing=true;
      stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(!active){stopTracks();return;}
      recorder=new MediaRecorder(stream);const chunks=[];
      recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      recorder.onstop=()=>{
        clearTimeout(captureTimer);stopTracks();capturing=false;if(!active)return;
        voice=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});
        file.value='';$('#record-state').textContent='Recording attached.';
        recordBtn.disabled=false;recordBtn.textContent='Record again';
      };
      recorder.start();recordBtn.textContent='Stop recording';recordBtn.disabled=false;
      $('#record-state').textContent='Recording… up to 60 seconds.';
      captureTimer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},60000);
    }catch{stopTracks();capturing=false;if(active){recordBtn.disabled=false;$('#record-state').textContent='Microphone unavailable. You can attach an audio file.';}}
  };
  file.onchange=()=>{voice=null;$('#record-state').textContent=file.files[0]?'Audio file attached.':'';};
  form.onsubmit=async e=>{
    e.preventDefault();const message=$('#form-feedback'),text=input.value.trim();
    if(!text){message.textContent='Paste your post first.';return;}
    if(capturing){message.textContent='Finish recording before adding your post.';return;}
    const audio=file.files[0]||voice||null;
    if(audio&&audio.size>12*1024*1024){message.textContent='Choose an audio clip under 12 MB.';return;}
    if(audio?.type&&!audio.type.startsWith('audio/')&&!['video/webm','video/mp4','application/ogg'].includes(audio.type)){
      message.textContent='Choose an audio recording.';return;
    }
    const name=form.elements.author.value.trim()||'Your post';
    const p={id:crypto.randomUUID(),own:true,name,meta:'Added by you',mark:name.slice(0,1).toUpperCase(),theme:'own',title:'',body:text,
      impressions:form.elements.impressions.value,disclosed:form.elements.disclosed.checked,voice:audio,created:Date.now()};
    const submit=form.querySelector('[type=submit]');submit.disabled=true;
    try{
      await save(p);posts.unshift(p);modal.close();render();$('#feed').scrollIntoView({block:'start'});
      toast('Post saved to this feed.');
    }catch{message.textContent='Could not save this post locally. Try a shorter recording or free up browser storage.';}
    finally{submit.disabled=false;}
  };
  input.focus();
}
$('#add').onclick=composer;
async function init(){
  try{
    const stored=await localData('getAll');
    for(const p of posts){const row=stored.find(x=>x.id===p.id);if(row?.scannedText===scanText(p)&&row?.result)p.result=row.result;}
    posts.unshift(...stored.filter(p=>p.own).sort((a,b)=>b.created-a.created));
  }catch{toast('Browser storage is unavailable. Local posts need storage enabled.');}
  render();await checkStatus();
}
init();
