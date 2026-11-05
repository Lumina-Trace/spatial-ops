import { PCDLoader } from 'three/addons/loaders/PCDLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import {analyzeCloud} from '../dist/cloud-filter.js';
self.onmessage = async ({data:{file}}) => {
  try {
    self.postMessage({stage:'正在读取点云（后台）'});
    const buffer=await file.arrayBuffer();
    self.postMessage({stage:'正在解码点云（后台）'});
    let geometry, material;
    if(file.name.toLowerCase().endsWith('.pcd')) {const p=new PCDLoader().parse(buffer);geometry=p.geometry;material=p.material;}
    else geometry=new PLYLoader().parse(buffer);
    const pos=geometry.getAttribute('position'), col=geometry.getAttribute('color');
    if(!pos?.count) throw Error('点云没有 XYZ 坐标。');
    const stride=Math.max(1,Math.ceil(pos.count/1_500_000));
    const positions=new Float32Array(Math.ceil(pos.count/stride)*3);
    const colors=col?new Float32Array(positions.length):null;
    let count=0;
    for(let i=0;i<pos.count;i+=stride) {
      const p=[pos.getX(i),pos.getY(i),pos.getZ(i)];
      if(!p.every(Number.isFinite))continue;
      positions.set(p,count*3);
      if(colors)colors.set([col.getX(i),col.getY(i),col.getZ(i)],count*3);
      count++;
    }
    if(!count)throw Error('点云没有有效坐标。');
    const output=positions.slice(0,count*3), rgb=colors?.slice(0,count*3);
    const originalCount=pos.count;
    geometry.dispose();material?.dispose();
    self.postMessage({stage:'正在分析孤立噪点（后台）'});
    const noise=analyzeCloud(output);
    self.postMessage({positions:output,colors:rgb,originalCount,stride,noise},[output.buffer,noise.support.buffer,...(rgb?[rgb.buffer]:[])]);
  } catch(e) {self.postMessage({error:e.message||String(e)});}
};
