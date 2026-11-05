import test from 'node:test';
import assert from 'node:assert/strict';
import {solveAlignment,applyTransform,invertTransform,matrixOf,errorLabel,validateProject} from '../dist/calibration-math.js';
const points=[[0,0,0],[2,0,0],[0,3,0],[0,0,4],[3,2,-1],[-4,1,3]];
const t={scale:2.5,rotation:[[0,-1,0],[0,0,-1],[1,0,0]],translation:[10,-8,3]};
const rows=(transform=t)=>points.map((p,i)=>({id:'P-'+i,name:'角点',role:i<4?'fit':'check',source:p,target:applyTransform(transform,p)}));
const close=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('recovers nontrivial rotation, translation and scale; checks stay independent',()=>{
 const r=rows();r[4].target[0]+=2;const out=solveAlignment(r,true);close(out.scale,t.scale);out.rotation.flat().forEach((x,i)=>close(x,t.rotation.flat()[i]));out.translation.forEach((x,i)=>close(x,t.translation[i]));close(out.fit.rms,0);close(out.check.max,2);close(out.check.rms,Math.sqrt(2));
});
test('rigid mode keeps scale 1, including coplanar valid points',()=>{
 const actual={...t,scale:1},r=rows(actual);const out=solveAlignment(r,false);close(out.fit.rms,0);close(out.scale,1);
 const planar=points.slice(0,3).map((p,i)=>({id:String(i),role:'fit',source:p,target:applyTransform(actual,p)}));close(solveAlignment(planar,false).fit.rms,0);
});
test('rejects incomplete, repeated, collinear and nearly collinear data',()=>{
 assert.throws(()=>solveAlignment(rows().slice(0,2)),/至少/);
 for(const p of [[[0,0,0],[0,0,0],[0,0,0]],[[0,0,0],[1,1,1],[2,2,2]],[[0,0,0],[1,0,0],[2,1e-8,0]]])assert.throws(()=>solveAlignment(p.map((x,i)=>({id:String(i),role:'fit',source:x,target:x}))),/共线/);
 const r=rows();r[0].target=null;assert.throws(()=>solveAlignment(r),/坐标/);
});
test('inverse and row-major matrices agree for arbitrary points',()=>{
 const p=[-32,21,7],q=applyTransform(t,p);applyTransform(invertTransform(t),q).forEach((v,i)=>close(v,p[i]));const m=matrixOf(t);q.forEach((v,i)=>close(v,m[i*4]*p[0]+m[i*4+1]*p[1]+m[i*4+2]*p[2]+m[i*4+3]));
});
test('small and large unit scales remain numerically valid',()=>{
 for(const scale of [1e-6,1,1000]){const r=rows({...t,scale});const o=solveAlignment(r);assert(Math.abs(o.scale-scale)<1e-7);assert(o.fit.rms<1e-8);}
 assert.equal(errorLabel(.01,'m'),'1.00 cm');assert.equal(errorLabel(10,'mm'),'1.00 cm');assert.match(errorLabel(1,'unknown'),/单位/);assert.equal(errorLabel(null,'m'),'—');
});
test('project validates records and ignores untrusted stored transform',()=>{
 const model={name:'model.ply',size:20,fingerprint:'abcd',up:'y'};
 const p={schema:'spatial-ops-calibration',version:1,models:{source:model,target:model},mode:'similarity',unit:'m',pairs:rows(),result:{matrix:['invalid']}};
 assert.equal(validateProject(p),p);assert.throws(()=>validateProject({...p,pairs:[...p.pairs,p.pairs[0]]}),/点位/);assert.throws(()=>validateProject({...p,unit:'feet'}),/单位/);
});
test('noisy correspondences produce finite diagnostics instead of claiming zero error',()=>{
 const r=rows();r[1].target[0]+=.03;r[2].target[1]-=.02;const out=solveAlignment(r);assert(out.fit.rms>0&&out.fit.rms<.03);assert(Number.isFinite(out.check.rms));assert(Math.abs(out.scale-t.scale)<.02);
});
