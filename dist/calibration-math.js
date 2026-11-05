// All coordinates are native file coordinates. Matrices are row-major.
export function eigenSymmetric(input) {
  const a = input.map(r => [...r]), n = a.length;
  const v = Array.from({length:n}, (_,i) => Array.from({length:n}, (_,j) => +(i===j)));
  for (let step=0; step<100; step++) {
    let p=0,q=1;
    for(let i=0;i<n;i++) for(let j=i+1;j<n;j++) if(Math.abs(a[i][j])>Math.abs(a[p][q])) {p=i;q=j;}
    const norm = Math.max(...a.map((r,i)=>Math.abs(r[i])), Number.MIN_VALUE);
    if(Math.abs(a[p][q]) < norm*1e-14) break;
    const angle=.5*Math.atan2(2*a[p][q],a[q][q]-a[p][p]);
    const c=Math.cos(angle),s=Math.sin(angle), ap=a[p][p],aq=a[q][q],b=a[p][q];
    for(let k=0;k<n;k++) if(k!==p&&k!==q) {
      const x=a[k][p],y=a[k][q]; a[k][p]=a[p][k]=c*x-s*y; a[k][q]=a[q][k]=s*x+c*y;
    }
    a[p][p]=c*c*ap-2*c*s*b+s*s*aq; a[q][q]=s*s*ap+2*c*s*b+c*c*aq; a[p][q]=a[q][p]=0;
    for(let k=0;k<n;k++) { const x=v[k][p],y=v[k][q];v[k][p]=c*x-s*y;v[k][q]=s*x+c*y; }
  }
  return a.map((r,i)=>({value:r[i],vector:v.map(row=>row[i])})).sort((a,b)=>b.value-a.value);
}
export const validPoint = p => Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const mean = points => [0,1,2].map(i=>points.reduce((s,p)=>s+p[i],0)/points.length);
const dot = (a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const rotate = (r,p)=>r.map(row=>dot(row,p));
function centered(points) {const c=mean(points);return {c,p:points.map(p=>p.map((v,i)=>v-c[i]))};}
function ensureSpread(points, name) {
  const cov=Array.from({length:3},(_,i)=>[0,1,2].map(j=>points.reduce((s,p)=>s+p[i]*p[j],0)));
  if(cov.flat().some(v=>!Number.isFinite(v))) throw Error('坐标数值范围过大，请检查单位和输入。');
  const e=eigenSymmetric(cov);
  if(e[0].value<=0||e[1].value/e[0].value<1e-7) throw Error(`${name}的点重复或接近共线，请选择分散的角点。`);
}
export function applyTransform(t,p) {return rotate(t.rotation,p).map((x,i)=>t.scale*x+t.translation[i]);}
export function invertTransform(t) {
  const rotation=t.rotation[0].map((_,i)=>t.rotation.map(r=>r[i]));
  const scale=1/t.scale;
  return {rotation,scale,translation:rotate(rotation,t.translation).map(v=>-v*scale)};
}
export function matrixOf(t) {return [...t.rotation.flatMap((r,i)=>[...r.map(x=>x*t.scale),t.translation[i]]),0,0,0,1];}
export function residuals(t,rows) {
  const items=rows.map(r=>({id:r.id,error:Math.hypot(...applyTransform(t,r.source).map((v,i)=>v-r.target[i]))}));
  return {items, count:items.length, rms:items.length?Math.sqrt(items.reduce((s,r)=>s+r.error*r.error,0)/items.length):null,max:items.length?Math.max(...items.map(r=>r.error)):null};
}
export function solveAlignment(rows, withScale=true) {
  const fit=rows.filter(r=>r.role==='fit');
  if(fit.length<3) throw Error('至少需要 3 组完整的标定点。');
  if(rows.some(r=>!validPoint(r.source)||!validPoint(r.target))) throw Error('有点位尚未完成左右配对，或坐标无效。');
  const a=centered(fit.map(r=>r.source)),b=centered(fit.map(r=>r.target));
  ensureSpread(a.p,'3DGS');ensureSpread(b.p,'点云');
  const h=Array.from({length:3},(_,i)=>[0,1,2].map(j=>a.p.reduce((s,p,k)=>s+p[i]*b.p[k][j],0)));
  const [[xx,xy,xz],[yx,yy,yz],[zx,zy,zz]]=h;
  const n=[[xx+yy+zz,yz-zy,zx-xz,xy-yx],[yz-zy,xx-yy-zz,xy+yx,zx+xz],[zx-xz,xy+yx,-xx+yy-zz,yz+zy],[xy-yx,zx+xz,yz+zy,-xx-yy+zz]];
  const [w,x,y,z]=eigenSymmetric(n)[0].vector;
  const rotation=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]];
  const denom=a.p.reduce((s,p)=>s+dot(p,p),0);
  const scale=withScale?a.p.reduce((s,p,i)=>s+dot(rotate(rotation,p),b.p[i]),0)/denom:1;
  if(!Number.isFinite(scale)||scale<=0) throw Error('无法求出有效比例，请检查对应点和坐标轴。');
  const translation=b.c.map((v,i)=>v-scale*rotate(rotation,a.c)[i]);
  const t={rotation,translation,scale};
  return {...t,matrix:matrixOf(t),inverseMatrix:matrixOf(invertTransform(t)),fit:residuals(t,fit),check:residuals(t,rows.filter(r=>r.role==='check'))};
}
export const unitFactor = unit => ({m:1,cm:.01,mm:.001}[unit] ?? null);
export function errorLabel(value,unit) {
  if(value==null) return '—';
  const f=unitFactor(unit);
  return f==null?`${value.toPrecision(4)} 单位`:`${(value*f*100).toFixed(2)} cm`;
}
export function validateProject(data) {
  if(data?.schema!=='spatial-ops-calibration'||data.version!==1) throw Error('不是支持的标定文件（版本 1）。');
  if(!['similarity','rigid'].includes(data.mode)||!['unknown','m','cm','mm'].includes(data.unit)) throw Error('标定模式或单位无效。');
  if(!Array.isArray(data.pairs)||data.pairs.length>500) throw Error('点位记录无效或超过 500 组。');
  const ids=new Set();
  for(const r of data.pairs) {
    if(typeof r.id!=='string'||r.id.length>32||ids.has(r.id)||typeof r.name!=='string'||r.name.length>80||!['fit','check'].includes(r.role)||![r.source,r.target].every(p=>p===null||validPoint(p))) throw Error('点位内容无效。');
    ids.add(r.id);
  }
  for(const side of ['source','target']) {
    const m=data.models?.[side];
    if(!m||typeof m.name!=='string'||!Number.isSafeInteger(m.size)||m.size<1||typeof m.fingerprint!=='string'||!m.fingerprint||!['y','z','flip'].includes(m.up)) throw Error('模型关联信息不完整。');
  }
  // Never trust an imported transform: recompute it from the reviewed pairs.
  return data;
}
