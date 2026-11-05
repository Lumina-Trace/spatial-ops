import test from 'node:test';
import assert from 'node:assert/strict';
const messages=[];
globalThis.self={postMessage:m=>messages.push(m)};
await import('../scripts/cloud-worker.mjs');
const points=[[1,2,3],[-4,5,6],[7,8,-9]];
const header=`VERSION .7\nFIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nCOUNT 1 1 1\nWIDTH 3\nHEIGHT 1\nPOINTS 3\n`;
async function parse(file){messages.length=0;await self.onmessage({data:{file}});return messages.at(-1);}
test('PCD ASCII, binary and binary_compressed agree on native coordinates',async()=>{
 const binary=new Float32Array(points.flat());
 const raw=new Uint8Array(new Float32Array([0,1,2].flatMap(i=>points.map(p=>p[i]))).buffer);
 const lzf=Uint8Array.from([31,...raw.slice(0,32),3,...raw.slice(32)]);
 const size=new Uint32Array([lzf.length,raw.length]);
 for(const [mode,parts] of [['ascii',[points.map(p=>p.join(' ')).join('\n')+'\n']],['binary',[binary]],['binary_compressed',[size,lzf]]]){
  const out=await parse(new File([header+`DATA ${mode}\n`,...parts],'map.pcd'));
  assert.equal(out.error,undefined,mode+': '+out.error);assert.deepEqual([...out.positions],points.flat());assert.equal(out.originalCount,3);
 }
});
test('point-cloud PLY works, and malformed files return an error',async()=>{
 const ply='ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n'+points.map(p=>p.join(' ')).join('\n')+'\n';
 const out=await parse(new File([ply],'map.ply'));assert.deepEqual([...out.positions],points.flat());
 assert.ok((await parse(new File(['not a point cloud'],'bad.pcd'))).error);
});
