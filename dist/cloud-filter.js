// Radius support on the displayed original vertices. No smoothing or coordinate edits.
export function analyzeCloud(positions) {
  const count=positions.length/3, support=new Uint8Array(count);
  if(count<32){support.fill(8);return {support,radius:0,skipped:true};}
  const axes=[[],[],[]],step=Math.max(1,Math.ceil(count/12000));
  for(let i=0;i<count;i+=step)for(let a=0;a<3;a++)axes[a].push(positions[i*3+a]);
  const origin=[],extents=[];
  for(const a of axes){a.sort((x,y)=>x-y);origin.push(a[Math.floor(a.length*.02)]);extents.push(a[Math.min(a.length-1,Math.floor(a.length*.98))]-a[Math.floor(a.length*.02)]);}
  const extent=Math.max(...extents);
  if(!(extent>0)){support.fill(8);return {support,radius:0,skipped:true};}
  const key=(x,y,z)=>`${x},${y},${z}`;
  function grid(size){
    const cells=new Map(),next=new Int32Array(count);next.fill(-1);
    for(let i=0;i<count;i++){
      const k=key(Math.floor((positions[i*3]-origin[0])/size),Math.floor((positions[i*3+1]-origin[1])/size),Math.floor((positions[i*3+2]-origin[2])/size));
      next[i]=cells.get(k)??-1;cells.set(k,i);
    }
    return {cells,next,size};
  }
  function visit(g,i,callback){
    const x=Math.floor((positions[i*3]-origin[0])/g.size),y=Math.floor((positions[i*3+1]-origin[1])/g.size),z=Math.floor((positions[i*3+2]-origin[2])/g.size);
    for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      for(let j=g.cells.get(key(x+dx,y+dy,z+dz))??-1;j!==-1;j=g.next[j]){
        if(j===i)continue;
        const d=(positions[j*3]-positions[i*3])**2+(positions[j*3+1]-positions[i*3+1])**2+(positions[j*3+2]-positions[i*3+2])**2;
        if(callback(d)===false)return;
      }
    }
  }
  // Estimate spacing from a bounded sample, with robust bounds to resist remote outliers.
  let g=grid(extent/Math.sqrt(count)*2),spacing=[];
  for(let i=0;i<count;i+=Math.max(1,Math.ceil(count/2048))){
    let nearest=Infinity,seen=0;
    visit(g,i,d=>{if(d>0)nearest=Math.min(nearest,d);return ++seen<512;});
    if(Number.isFinite(nearest))spacing.push(Math.sqrt(nearest));
  }
  spacing.sort((a,b)=>a-b);
  const radius=spacing.length?spacing[Math.floor(spacing.length/2)]*3:g.size;
  g=null;g=grid(radius);
  const r2=radius*radius;
  for(let i=0;i<count;i++)visit(g,i,d=>{if(d<=r2)support[i]++;return support[i]<8;});
  return {support,radius,skipped:false};
}

export function filteredIndices(support,mode='mild'){
  const threshold={off:0,mild:2,standard:4,strong:7}[mode];
  if(threshold===undefined)throw Error('未知去噪强度');
  if(!threshold)return null;
  let n=0;for(const value of support)if(value>=threshold)n++;
  const indices=new Uint32Array(n);n=0;
  for(let i=0;i<support.length;i++)if(support[i]>=threshold)indices[n++]=i;
  return indices;
}

// Prefer the front surface inside the click aperture, then the closest screen pixel.
export function selectSurfaceHit(candidates,maxPixels=4){
  const visible=candidates.filter(h=>h.depth>0&&h.pixelDistance<=maxPixels);
  if(!visible.length)return null;
  let front=visible[0];for(const h of visible)if(h.depth<front.depth)front=h;
  const layer=Math.max(front.worldPerPixel*maxPixels*2,1e-8);
  let best=front;
  for(const h of visible)if(h.depth<=front.depth+layer&&h.pixelDistance<best.pixelDistance)best=h;
  return best;
}
