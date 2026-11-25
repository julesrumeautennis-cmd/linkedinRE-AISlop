
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
const posts=[];
const expanded=new Set(), unfolded=new Set(), openVoices=new Set(), disclosures=new Set(), busy=new Set();
const blobUrls=new Map();
let stickers=true, filter=false, batch=false, state={state:'checking'}, timer, recordingCleanup=null;
const modal=$('#modal');
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
  catch{setState({state:'error',message:'Could not reach Offscript.'});}
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
    ['Check the writing','Pangram analyzes the full original caption when you click Scan. Posts under 50 words remain unclassified.'],
    ['Filter the feed','Offscript labels a post AI when Pangram estimates that more than 30% of its text was AI-generated. Other scored posts get the HUMAN sticker. Hide AI folds the flagged posts. Turn off Verdict stickers for the original view.'],
    ['Read the source','Each public post links to its original on LinkedIn. Reactions and comments are a snapshot of the public counts at import.'],
    ['Add a post','Save your own post, photo, original audio, and impression count to this browser. A scan sends the text to Pangram.']
  ])body.append(element('h3','',head),element('p','',copy));
};

function longEnough(p){return (p.linkedin?p.wordCount:p.body.trim().split(/\s+/).length)>=50;}
function kind(p){
  const fraction=p.result?.fraction_ai;
  if(typeof fraction==='number' && fraction>=0 && fraction<=1)return fraction>0.30?'ai':'human';
  return null;
}
function eligible(p){return kind(p)==='ai';}
function verdict(p){return ({ai:'AI',human:'Human'})[kind(p)]||'Unscored';}
function createSticker(p){
  const ai=eligible(p), percentage=new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:2}).format(p.result.fraction_ai);
  const stamp=button('','verdict-sticker '+kind(p),()=>detailsFor(p));
  stamp.append(element('strong','',ai?'AI SLOP':'HUMAN'),element('small','',percentage+' AI-written'));
  stamp.setAttribute('aria-label',verdict(p)+' verdict, '+percentage+' estimated AI-written. View scan details.');
  return stamp;
}
function avatar(p){
  const a=element('span','avatar '+p.theme,p.mark);a.setAttribute('aria-hidden','true');
  if(p.avatar){const img=element('img');img.alt='';img.src=p.avatar;img.referrerPolicy='no-referrer';img.onerror=()=>img.remove();a.append(img);}
  return a;
}
function sourceLink(p,label){
  const link=element('a','action',label);link.href=p.url;link.target='_blank';link.rel='noreferrer';return link;
}
function openGallery(p,index,photos){
  const pane=dialog(p.photoAlt||'Post photo');const full=element('img','lightbox-image');
  full.alt=p.photoAlt||'Attached photo';full.referrerPolicy='no-referrer';
  const controls=element('div','gallery-controls'),position=element('span');
  const previous=button('Previous','secondary',()=>show(index-1));
  const next=button('Next','secondary',()=>show(index+1));
  function show(i){index=i;full.src=photos[i];position.textContent=(i+1)+' / '+photos.length;previous.disabled=i===0;next.disabled=i===photos.length-1;}
  controls.append(previous,position,next);pane.append(full);if(photos.length>1)pane.append(controls);if(p.linkedin)pane.append(sourceLink(p,'View on LinkedIn'));show(index);
}
function gallery(p){
  let photos=p.photos||[];
  if(p.photoFile){
    const key='photo-'+p.id;
    if(!blobUrls.has(key))blobUrls.set(key,URL.createObjectURL(p.photoFile));
    photos=[blobUrls.get(key)];
  }
  const group=element('div','photo-grid photos-'+Math.min(photos.length,4));
  photos.slice(0,4).forEach((url,i)=>{
    const b=button('','photo-tile',()=>openGallery(p,i,photos));
    b.setAttribute('aria-label','Open photo '+(i+1)+' of '+photos.length+' · '+(p.photoAlt||p.name));
    const img=element('img');img.alt=(p.photoAlt||'Photo in the post')+(photos.length>1?' ('+(i+1)+')':'');
    img.loading=p.featured?'eager':'lazy';img.referrerPolicy='no-referrer';img.src=url;
    img.onerror=()=>{b.classList.add('photo-failed');if(p.linkedin)b.replaceWith(sourceLink(p,'View this photo on LinkedIn'));};
    b.append(img);group.append(b);
  });return group;
}
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
  const body=dialog(verdict(p)||'Pangram result');body.append(element('p','',p.result.prediction||p.result.headline));
  const entries=Object.entries(p.result.shares||{}), names={ai:'AI-written',ai_assisted:'AI-assisted',human:'Human-written'};
  if(entries.length){body.append(element('h3','','Share of the text'));for(const [k,v] of entries)body.append(element('p','',names[k]+' · '+v+'%'));}
  if(p.result.range)body.append(element('p','','Pangram’s estimated range is '+p.result.range.join('–')+'% AI-written text.'));
  body.append(element('p','','Offscript applies the AI sticker above 30% AI-written text. The percentage estimates the share of the caption.'));
  body.append(element('small','','Pangram API · Model '+p.result.version+(p.result.verdict?' · '+p.result.verdict:'')));
}
function card(p){
  const item=element('article','card');item.id='post-'+p.id;
  const top=element('div','card-top'), by=element('div','byline');
  by.append(element('strong','',p.name),element('p','',p.meta));top.append(avatar(p),by);item.append(top);
  const folded=filter&&eligible(p)&&!unfolded.has(p.id);
  if(folded){
    item.classList.add('folded');by.lastChild.textContent='Hidden by your AI filter';
    top.append(button('Show post','linkish',()=>{unfolded.add(p.id);repaintCard(p);}));return item;
  }
  if(stickers&&kind(p))top.append(createSticker(p));
  if(p.own && p.impressions){
    const metric=element('div','reach');metric.append(element('strong','',Number(p.impressions).toLocaleString('en-US')),element('span','','impressions · reported by author'));item.append(metric);
  }
  if(p.title)item.append(element('h3','',p.title));
  const text=element('p','post-body'+(p.shortPreview||expanded.has(p.id)?'':' clamp'),p.body);item.append(text);
  if(p.shortPreview)item.append(sourceLink(p,'…more on LinkedIn'));
  else if(p.body.length>190)item.append(button(expanded.has(p.id)?'Read less':'Read more','linkish',()=>{
    if(expanded.has(p.id))expanded.delete(p.id);else expanded.add(p.id);repaintCard(p);
  }));
  if(p.own && p.disclosed && disclosures.has(p.id)){
    const quote=element('blockquote','disclosure','“I wrote this post with AI.”');quote.append(element('cite','','Author disclosure'));item.append(quote);
  }
  if(p.photos?.length||p.photoFile)item.append(gallery(p));
  if(p.linkedin && Number.isFinite(p.reactions) && Number.isFinite(p.comments)){
    const social=element('div','social');
    const symbols=element('span','reaction-icons');symbols.setAttribute('aria-hidden','true');
    symbols.append(element('i','','👍'),element('i','','♥'),element('i','','👏'));
    social.append(symbols,element('span','',p.reactions.toLocaleString('en-US')+' reactions'),sourceLink(p,p.comments.toLocaleString('en-US')+' comments'));item.append(social);
  }
  const actions=element('div','actions');
  const scan=button(p.result?'Scan details':busy.has(p.id)?'Scanning…':'Scan with Pangram','action',()=>p.result?detailsFor(p):runSingle(p));
  scan.prepend(element('span','scan-icon'));scan.disabled=busy.has(p.id)||(!p.result&&batch);
  if(p.linkedin&&!longEnough(p)){actions.append(element('small','short-post',p.excerptOnly?'Preview only · unscored':'Under 50 words · unscored'));}else actions.append(scan);
  if(p.own&&p.disclosed)actions.append(button(disclosures.has(p.id)?'Hide disclosure':'Reveal who wrote it','action',()=>{
    if(disclosures.has(p.id))disclosures.delete(p.id);else disclosures.add(p.id);repaintCard(p);
  }));
  if(p.audio||p.voice){
    const voice=button(openVoices.has(p.id)?'Close recording':'Hear the original','action audio-action',()=>{
      if(openVoices.delete(p.id))repaintCard(p);else activateVoice(p);
    });voice.prepend(element('span','play-icon'));actions.append(voice);
  }
  if(p.linkedin){actions.append(sourceLink(p,'View on LinkedIn'));}
  if(p.own&&!busy.has(p.id)&&!batch)actions.append(button('Remove','action',()=>{
    const body=dialog('Remove this post?');body.append(element('p','','This removes the post and its recording from this browser.'),
      button('Remove post','dark-btn',async()=>{try{await localData('delete',p.id);posts.splice(posts.indexOf(p),1);for(const key of [p.id,'photo-'+p.id]){if(blobUrls.has(key)){URL.revokeObjectURL(blobUrls.get(key));blobUrls.delete(key);}}modal.close();render();}catch{toast('Could not remove this local post.');}}));
  }));
  item.append(actions);
  if(openVoices.has(p.id))addVoice(p,item);
  return item;
}
function render(){
  $('#stream-label').textContent=posts.some(p=>p.mcp)?'Your feed':'Viral posts';
  $('#cards').replaceChildren(...posts.map(card));stats();
}
function stats(){
  const done=posts.filter(p=>kind(p)).length;
  $('#count').textContent=posts.length;$('#scanned').textContent=done;$('#scan-total').textContent='/ '+posts.length;
  const totals={ai:0,human:0,unscanned:0};
  for(const p of posts)totals[kind(p)||'unscanned']++;
  const meter=$('#meter'),legend=$('#legend');meter.replaceChildren();legend.replaceChildren();
  for(const [key,name] of [['ai','AI'],['human','Human'],['unscanned','Unscored']]){
    if(totals[key]){const part=element('i',key+'-color');part.style.flexGrow=totals[key];meter.append(part);}
    const row=element('div');row.append(element('i',key+'-color'),document.createTextNode(name),element('b','',String(totals[key])));legend.append(row);
  }
  const scanAll=$('#scan-all');
  const ready=posts.some(p=>!p.result&&longEnough(p));
  scanAll.textContent=batch?'Scanning…':ready?'Scan the feed':'Review results';
  scanAll.disabled=batch||busy.size>0||(!ready&&!done);
  const note=$('#filter-note');note.hidden=!filter;
  note.textContent='Posts above 30% AI-written are folded.';
}
$('#stickers').onchange=e=>{stickers=e.target.checked;render();};
$('#filter').onchange=e=>{filter=e.target.checked;unfolded.clear();render();};

async function save(p){
  if(p.own||p.mcp)await localData('put',p);
}
async function scanPost(p){
  busy.add(p.id);repaintCard(p);stats();
  try{
    const r=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p.linkedin&&!p.mcp?{post_id:p.id}:{text:p.body})});
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
  try{await scanPost(p);$('#scan-progress').textContent='';detailsFor(p);}catch(e){
    if(e.status===402&&!p.linkedin){
      const pane=dialog('Use your Pangram dashboard');
      pane.append(element('p','','Your API balance is empty. Copy this post, open your Pangram dashboard, paste the text and choose Check for AI.'));
      pane.append(button('Copy post text','secondary',async()=>{try{await navigator.clipboard.writeText(p.body);toast('Post copied.');}catch{toast('Select and copy the original post text.');}}));
      const link=element('a','launch-dashboard','Open Pangram');link.href='https://www.pangram.com/dashboard';link.target='_blank';link.rel='noreferrer';pane.append(link);
    }else showFailure(e.message);
  }
}
$('#scan-all').onclick=async()=>{
  if(batch||busy.size)return;
  const todo=posts.filter(p=>!p.result&&longEnough(p));
  if(!todo.length){
    const pane=dialog('Feed results');
    for(const p of posts){
      if(p.result)pane.append(button(p.name+' · '+verdict(p),'report-row',()=>detailsFor(p)));
      else pane.append(element('p','report-short',p.name+' · '+(longEnough(p)?'Unscanned':'Under 50 words')));
    }return;
  }
  batch=true;render();
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
      <label class="field"><span>Post photo <small>(optional)</small></span><input type="file" name="photo" accept="image/jpeg,image/png,image/webp"></label>
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
    const photoFile=form.elements.photo.files[0]||null;
    if(photoFile && (!['image/jpeg','image/png','image/webp'].includes(photoFile.type)||photoFile.size>10*1024*1024)){
      message.textContent='Choose a JPG, PNG or WebP image under 10 MB.';return;
    }
    const audio=file.files[0]||voice||null;
    if(audio&&audio.size>12*1024*1024){message.textContent='Choose an audio clip under 12 MB.';return;}
    if(audio?.type&&!audio.type.startsWith('audio/')&&!['video/webm','video/mp4','application/ogg'].includes(audio.type)){
      message.textContent='Choose an audio recording.';return;
    }
    const name=form.elements.author.value.trim()||'Your post';
    const p={id:crypto.randomUUID(),own:true,name,meta:'Added by you',mark:name.slice(0,1).toUpperCase(),theme:'own',title:'',body:text,
      impressions:form.elements.impressions.value,disclosed:form.elements.disclosed.checked,voice:audio,photoFile,created:Date.now()};
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
    const response=await fetch('/api/feed');
    if(!response.ok)throw Error();
    posts.push(...await response.json());
    const featured=posts.find(p=>p.featured);
    if(featured?.avatar){const profile=$('#profile-image');profile.referrerPolicy='no-referrer';profile.src=featured.avatar;profile.hidden=false;}
    if(featured)$('#profile-source').href='#post-'+featured.id;
  }catch{$('#cards').textContent='Could not load the feed. Refresh to try again.';return;}
  try{
    const stored=await localData('getAll');
    for(const p of stored){if(p.result&&!kind(p))delete p.result;}
    posts.unshift(...stored.filter(p=>p.own||p.mcp).sort((a,b)=>b.created-a.created));
  }catch{toast('Browser storage is unavailable. Local posts need storage enabled.');}
  render();await checkStatus();
}
init();

const localBridge='http://127.0.0.1:8787';
let syncWindow=null;
async function importFeed(items){
  if(!Array.isArray(items)||!items.length)throw Error('LinkedIn returned no posts.');
  const latest=[];
  for(const card of items.slice(0,10)){
    if(!card.mcp || !/^mcp-[a-z0-9]+$/.test(card.id) || !/^https:\/\/www\.linkedin\.com\/(posts|feed\/update)\//.test(card.url))continue;
    const old=posts.find(p=>p.id===card.id);
    if(old?.body===card.body&&old.result)card.result=old.result;
    card.created=Date.now()-latest.length;
    await save(card);latest.push(card);
  }
  const ids=new Set(latest.map(p=>p.id));
  for(let i=posts.length-1;i>=0;i--)if(ids.has(posts[i].id))posts.splice(i,1);
  posts.unshift(...latest);render();
  toast(latest.length+' recent LinkedIn posts synced.');
}
window.addEventListener('message',async e=>{
  if(e.origin!==localBridge||e.source!==syncWindow||e.data?.type!=='offscript-mcp')return;
  syncWindow=null;
  try{await importFeed(e.data.posts);}catch(e){showFailure(e.message);}
});
$('#sync').onclick=async e=>{
  if(location.hostname!=='127.0.0.1' && location.hostname!=='localhost'){
    const pane=dialog('Sync from your Mac');
    pane.append(element('p','','Start the local Offscript server on your Mac, then open the connector to read up to 10 recent posts from your LinkedIn session.'));
    pane.append(button('Open local connector','dark-btn',()=>{
      syncWindow=window.open(localBridge+'/api/bridge?site='+encodeURIComponent(location.origin),'offscript-linkedin','popup,width=520,height=520');
      if(syncWindow)modal.close();else toast('Allow pop-ups to open the local connector.');
    }));return;
  }
  const control=e.currentTarget;control.disabled=true;control.textContent='Reading your feed…';
  try{
    const r=await fetch('/api/linkedin',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const data=await r.json();if(!r.ok)throw Error(data.error);
    await importFeed(data.posts);
  }catch(e){showFailure(e.message);}
  finally{control.disabled=false;control.textContent='Sync my LinkedIn';}
};
