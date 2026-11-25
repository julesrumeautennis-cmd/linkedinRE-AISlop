// An original raster illustration. Nested ink ridges break into screened pixels.
export function drawPrint(canvas) {
  const w = 820, h = 350;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w,h);
  let seed=103;
  function random(){ seed=(1664525*seed+1013904223)>>>0; return seed/4294967296; }
  const cx=466, cy=172, tilt=.29, co=Math.cos(tilt), si=Math.sin(tilt);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const dx=x-cx, dy=y-cy, u=(dx*co+dy*si)/153, v=(-dx*si+dy*co)/211;
    const outer=Math.hypot(u*(1-.10*v),v);
    const gridX=Math.floor(x/5)*5, gridY=Math.floor(y/5)*5;
    const digital=Math.max(0,Math.min(1,(u+.04)*1.7));
    const a=u + (gridX-x)*digital/153, b=v + (gridY-y)*digital/211;
    const bend=.09*Math.sin(3.9*b+.75)+.035*Math.sin(7*b+2*a);
    const r=Math.hypot((a-bend)*(1-.14*b), (b-.15)*.88);
    const ang=Math.atan2(b-.15,a-bend);
    const phase=66*r+2.65*Math.sin(ang*2+.9)*Math.min(r*2,1)+.65*Math.sin(13*a+4*b);
    let ink=Math.max(0,Math.min(1,(Math.sin(phase)+.34)*2.3))*Math.min(1,Math.max(0,(1.04-outer)*24));
    if(digital>.34 && (x%5<1 || y%5<1)) ink*=1-digital*.89;
    if(outer>1 || random()<.035) ink*=.16;
    const grain=random();
    let alpha=ink*(.58+.39*grain)*Math.min(1,Math.max(0,(x-30)/185));
    // Faint registration grid surrounds the impression.
    if(x>155 && (x%32===0 || y%32===0))alpha=Math.max(alpha,.042);
    if(grain>.986)alpha=Math.max(alpha,.08);
    const p=(y*w+x)*4;
    img.data[p]=213; img.data[p+1]=241; img.data[p+2]=148; img.data[p+3]=alpha*255;
  }
  ctx.putImageData(img,0,0);
  ctx.strokeStyle='rgba(218,246,164,.52)';ctx.lineWidth=1.2;
  for(const [x,y,sx,sy] of [[240,28,1,1],[675,28,-1,1],[240,325,1,-1],[675,325,-1,-1]]){
    ctx.beginPath();ctx.moveTo(x+sx*13,y);ctx.lineTo(x,y);ctx.lineTo(x,y+sy*13);ctx.stroke();
  }
}
