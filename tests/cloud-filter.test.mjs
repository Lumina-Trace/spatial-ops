import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeCloud,filteredIndices,selectSurfaceHit} from '../dist/cloud-filter.js';
import {BufferGeometry,BufferAttribute,Points,PointsMaterial,Raycaster,Vector3} from 'three';

function fixture(){
  const points=[];
  for(let x=0;x<30;x++)for(let y=0;y<30;y++)points.push(x*.1,y*.1,0);
  // Floating singles and a pair; none has enough support to survive mild filtering.
  points.push(1,1,3,1.01,1,3,9,9,9,-8,7,5);
  return new Float32Array(points);
}
test('removes isolated points but keeps a plane, including its corners and exact native coordinates',()=>{
  const positions=fixture(),before=positions.slice(),noise=analyzeCloud(positions);
  const index=filteredIndices(noise.support,'mild');
  assert.equal(index.length,900);assert.deepEqual([...index],Array.from({length:900},(_,i)=>i));
  assert.deepEqual(positions,before);assert.equal(filteredIndices(noise.support,'off'),null);
  assert.ok(filteredIndices(noise.support,'strong').length<=filteredIndices(noise.support,'standard').length);
});
test('filter is independent of file units, origin and axis orientation',()=>{
  const source=fixture(),changed=source.map((v,i)=>v*1000+[30000,-70000,12000][i%3]);
  for(let i=0;i<changed.length;i+=3)[changed[i+1],changed[i+2]]=[-changed[i+2],changed[i+1]];
  assert.deepEqual(filteredIndices(analyzeCloud(source).support),filteredIndices(analyzeCloud(changed).support));
});
test('tiny and coincident clouds stay available without an unreliable density estimate',()=>{
  for(const positions of [new Float32Array([1,2,3]),new Float32Array(300)]){
    const result=analyzeCloud(positions);assert.equal(result.skipped,true);assert.equal(filteredIndices(result.support).length,positions.length/3);
  }
});
test('rendered index also excludes noise from Three.js point raycasting',()=>{
  const positions=fixture(),geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(positions,3));
  const cloud=new Points(geometry,new PointsMaterial());const ray=new Raycaster(new Vector3(9,9,15),new Vector3(0,0,-1));ray.params.Points.threshold=.03;
  assert.ok(ray.intersectObject(cloud).some(h=>h.index===902));
  geometry.setIndex(new BufferAttribute(filteredIndices(analyzeCloud(positions).support),1));
  assert.equal(ray.intersectObject(cloud).length,0);
  geometry.setIndex(null);assert.ok(ray.intersectObject(cloud).length);geometry.dispose();cloud.material.dispose();
});
test('picking chooses the front surface, not a more centered background vertex',()=>{
  const front={index:1,depth:5,pixelDistance:1.4,worldPerPixel:.01},back={index:2,depth:12,pixelDistance:.01,worldPerPixel:.02};
  assert.equal(selectSurfaceHit([back,front]).index,1);
  const adjacent={index:3,depth:5.01,pixelDistance:.5,worldPerPixel:.01};
  assert.equal(selectSurfaceHit([back,front,adjacent]).index,3);
  assert.equal(selectSurfaceHit([{...front,pixelDistance:7},{...back,depth:-1}]),null);
});
