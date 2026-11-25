const share=document.querySelector('#share'), recipient=document.querySelector('#recipient'), status=document.querySelector('#status');
const origin=new URLSearchParams(location.search).get('site');
let valid=false;
try{valid=new URL(origin).origin===origin && new URL(origin).protocol==='https:';}catch{}
if(location.hostname==='127.0.0.1' && valid && window.opener){
  recipient.textContent='Share up to 10 recent posts with your browser tab at '+origin+' using your local LinkedIn MCP.';
  share.disabled=false;
  share.onclick=async()=>{
    share.disabled=true;status.textContent='Reading your feed…';
    try{
      const r=await fetch('/api/linkedin',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      const data=await r.json();if(!r.ok)throw new Error(data.error);
      window.opener.postMessage({type:'offscript-mcp',posts:data.posts},origin);
      status.textContent='Posts shared. You can return to the feed.';window.close();
    }catch(e){status.textContent=e.message;share.disabled=false;}
  };
}else{recipient.textContent='Open Sync my LinkedIn from the Offscript feed.';}
