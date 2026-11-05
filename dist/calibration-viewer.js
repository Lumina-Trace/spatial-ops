import {THREE,OrbitControls,SparkRenderer,SplatMesh} from './vendor/engine.js';
import {createModelStream,inspectModelFile} from './model-input.js';
import {applyTransform,invertTransform} from './calibration-math.js';
import {FlightNavigation} from './calibration-flight.js';
import {filteredIndices,selectSurfaceHit} from './cloud-filter.js';

export class CalibrationViewer {
  constructor(root,side,onPick,onError) {
    this.root=root;this.side=side;this.onPick=onPick;this.onError=onError;this.up='y';
    this.scene=new THREE.Scene();this.camera=new THREE.PerspectiveCamera(50,1,.001,100000);
    this.camera.position.set(8,6,10);
    this.renderer=new THREE.WebGLRenderer({antialias:false,alpha:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    this.renderer.setClearColor(0,0);root.append(this.renderer.domElement);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;
    this.controls.screenSpacePanning=true;
    this.controls.zoomToCursor=true;
    this.flight=new FlightNavigation(this);
    this.setNavigationMode(side==='source'?'fly':'rotate');
    this.noiseMode='mild';
    this.group=new THREE.Group();this.scene.add(this.group);
    this.markers=new THREE.Group();this.group.add(this.markers);
    this.labels=document.createElement('div');this.labels.className='map-labels';root.append(this.labels);
    this.tagObjects=[];
    if(side==='source'){this.spark=new SparkRenderer({renderer:this.renderer});this.scene.add(this.spark);}
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(root);this.resize();
    let last=performance.now();
    this.renderer.setAnimationLoop(()=>{try {const now=performance.now();this.flight.update((now-last)/1000);last=now;if(this.controls.enabled)this.controls.update();this.renderer.render(this.scene,this.camera);this.updateLabels();}catch(e){this.renderer.setAnimationLoop(null);onError(e.message);}});
    this.renderer.domElement.addEventListener('dblclick',e=>this.pick(e));
    this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();onError('显卡资源不足，请关闭其他三维页面后刷新。');});
  }
  setNavigationMode(mode){
    this.flight.stop();
    if(this.controls.enabled){const damping=this.controls.enableDamping;this.controls.enableDamping=false;this.controls.update();this.controls.enableDamping=damping;}
    this.navigationMode=['pan','fly'].includes(mode)?mode:'rotate';
    this.flight.setActive(this.navigationMode==='fly');this.controls.enabled=this.navigationMode!=='fly';
    const pan=this.navigationMode==='pan';
    this.controls.mouseButtons.LEFT=pan?THREE.MOUSE.PAN:THREE.MOUSE.ROTATE;
    this.controls.mouseButtons.RIGHT=pan?THREE.MOUSE.ROTATE:THREE.MOUSE.PAN;
    this.controls.touches.ONE=pan?THREE.TOUCH.PAN:THREE.TOUCH.ROTATE;
    this.controls.touches.TWO=THREE.TOUCH.DOLLY_PAN;
    this.root.dataset.navigation=this.navigationMode;
    this.renderer.domElement.setAttribute('aria-label',this.flight.active?'漫游视图：点击画面后 WASD 移动，Q 降 E 升，拖动鼠标转头':pan?'平移视图：左键或单指拖动平移，滚轮缩放':'旋转视图：左键旋转，右键或 Shift 加左键平移，滚轮缩放');
  }
  resize(){const w=this.root.clientWidth,h=this.root.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();}
  async load(file,onStage) {
    let model;
    try {
      let originalCount,previewCount;
      if(this.side==='source') {
        const info=await inspectModelFile(file);if(info.cloud)throw Error('左侧需要包含高斯属性的 3DGS，请把普通点云放在右侧。');
        model=new SplatMesh({stream:createModelStream(file,(n,total)=>onStage(`读取 3DGS · ${Math.round(n/total*100)}%`)),streamLength:file.size,fileName:file.name,lod:false});
        onStage('正在解码 3DGS');await model.initialized;
        const packed=model.packedSplats||model.extSplats;
        if(!packed?.numSplats)throw Error('文件没有可显示的高斯。');
        originalCount=previewCount=packed.numSplats;
        const step=Math.max(1,Math.ceil(previewCount/60000));
        const sample=[];
        for(let i=0;i<previewCount;i+=step){const p=packed.getSplat(i).center;if([p.x,p.y,p.z].every(Number.isFinite))sample.push(p.x,p.y,p.z);if(i%(step*4096)===0)await new Promise(r=>setTimeout(r,0));}
        this.nextBounds=this.calculateBounds(sample);
      } else {
        if(!/\.(pcd|ply)$/i.test(file.name)||!file.size)throw Error('右侧请选择非空的 PCD 或点云 PLY 文件。');
        const data=await this.loadCloud(file,onStage);
        const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));
        if(data.colors)geometry.setAttribute('color',new THREE.BufferAttribute(data.colors,3));
        const material=new THREE.PointsMaterial({color:data.colors?0xffffff:0x8dccf5,vertexColors:!!data.colors,size:2,sizeAttenuation:false});
        model=new THREE.Points(geometry,material);
        originalCount=data.originalCount;previewCount=data.positions.length/3;
        this.nextBounds=this.calculateBounds(data.positions);model.userData.noise=data.noise;
      }
      this.clearOverlay();
      if(this.model){this.group.remove(this.model);this.disposeModel(this.model);}
      this.model=model;this.group.add(model);this.box=this.nextBounds;
      if(this.side==='target')this.setNoiseMode(this.noiseMode);
      this.orient(this.up);
      return {originalCount,previewCount};
    } catch(e){if(model&&model!==this.model)this.disposeModel(model);throw e;}
  }
  loadCloud(file,onStage){return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./vendor/cloud-worker.js',import.meta.url),{type:'module'});
    this.worker=worker;
    worker.onmessage=({data})=>{if(data.stage){onStage(data.stage);return;}worker.terminate();this.worker=null;if(data.error)reject(Error(data.error));else resolve(data);};
    worker.onerror=e=>{worker.terminate();this.worker=null;reject(Error(e.message||'点云解码失败，可能是内存不足或格式不支持。'));};
    worker.postMessage({file});
  });}
  calculateBounds(positions){
    const axes=[[],[],[]],step=Math.max(1,Math.ceil(positions.length/3/60000));
    for(let i=0;i<positions.length;i+=3*step)for(let j=0;j<3;j++)axes[j].push(positions[i+j]);
    if(!axes[0].length)throw Error('没有有效的模型坐标。');
    axes.forEach(a=>a.sort((x,y)=>x-y));
    const q=(a,p)=>a[Math.min(a.length-1,Math.floor((a.length-1)*p))];
    return new THREE.Box3(new THREE.Vector3(...axes.map(a=>q(a,.03))),new THREE.Vector3(...axes.map(a=>q(a,.97))));
  }
  orient(up){this.up=up;this.group.rotation.set(up==='z'?-Math.PI/2:up==='flip'?Math.PI:0,0,0);this.group.updateMatrixWorld(true);this.fit();}
  fit(top=false){if(!this.box)return;const b=this.box.clone().applyMatrix4(this.group.matrixWorld),center=b.getCenter(new THREE.Vector3());const radius=Math.max(b.getSize(new THREE.Vector3()).length()/2,.001);
    const half=Math.min(THREE.MathUtils.degToRad(this.camera.fov/2),Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))*this.camera.aspect));
    this.radius=radius;this.controls.target.copy(center);this.camera.position.copy(center).addScaledVector(new THREE.Vector3(...(top?[0,1,.001]:[1,.65,1.3])).normalize(),radius/Math.sin(half)*1.12);
    this.flight.stop();this.camera.lookAt(center);
    this.camera.near=radius/10000;this.camera.far=radius*10000;this.camera.updateProjectionMatrix();this.controls.minDistance=radius*.003;this.controls.maxDistance=radius*200;
    const damping=this.controls.enableDamping;this.controls.enableDamping=false;this.controls.update();this.controls.enableDamping=damping;
  }
  setNoiseMode(mode){
    this.noiseMode=mode;const noise=this.model?.userData.noise;if(!noise)return null;
    const indices=filteredIndices(noise.support,mode);
    this.model.geometry.setIndex(indices?new THREE.BufferAttribute(indices,1):null);
    const total=noise.support.length,kept=indices?.length??total;
    return {total,kept,removed:total-kept,skipped:noise.skipped};
  }
  setArmed(active){this.armed=active;this.root.classList.toggle('picking',!!active);}
  async pick(event){if(!this.armed||!this.model)return;
    const rect=this.renderer.domElement.getBoundingClientRect(), ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),this.camera);
    ray.params.Points.threshold=Math.max(.00001,Math.max(this.radius||0,this.camera.position.distanceTo(this.controls.target))*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))*14/rect.height);
    try {
      this.group.updateMatrixWorld(true);
      const hits=ray.intersectObject(this.model,false);let hit=hits[0];
      if(!hit){this.onError('未命中模型，请放大后双击清晰的表面。');return;}
      let point;
      if(this.model.isPoints){
        // Point-cloud intersections give a point on the ray. Store the actual vertex.
        const candidates=hits.map(h=>{
          const world=new THREE.Vector3().fromBufferAttribute(this.model.geometry.attributes.position,h.index).applyMatrix4(this.model.matrixWorld);
          const view=world.clone().applyMatrix4(this.camera.matrixWorldInverse),screen=world.project(this.camera);
          return {...h,depth:-view.z,pixelDistance:Math.hypot((screen.x+1)*rect.width/2-(event.clientX-rect.left),(1-screen.y)*rect.height/2-(event.clientY-rect.top)),worldPerPixel:2*(-view.z)*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))/rect.height};
        });
        hit=selectSurfaceHit(candidates,Math.max(3,this.model.material.size/2+1));
        if(!hit){this.onError('鼠标附近没有可选表面，请放大后双击保留下来的实体点。');return;}
        point=new THREE.Vector3().fromBufferAttribute(this.model.geometry.attributes.position,hit.index);
      }else point=this.group.worldToLocal(hit.point.clone());
      this.onPick(this.side,point.toArray());
    } catch(e){this.onError('选点失败：'+e.message);}
  }
  setMarkers(rows,selected){
    this.markers.clear();this.tagObjects=[];this.labels.replaceChildren();
    for(const row of rows){const p=row[this.side];if(!p)continue;const anchor=new THREE.Object3D();anchor.position.fromArray(p);this.markers.add(anchor);
      const label=document.createElement('span');label.className='map-tag'+(row.id===selected?' selected':'')+(row.role==='check'?' check':'');label.textContent=row.id;this.labels.append(label);this.tagObjects.push({anchor,label});}
  }
  updateLabels(){const w=this.root.clientWidth,h=this.root.clientHeight;for(const {anchor,label} of this.tagObjects){const p=anchor.getWorldPosition(new THREE.Vector3()).project(this.camera);label.hidden=p.z<-1||p.z>1||Math.abs(p.x)>1||Math.abs(p.y)>1;label.style.left=`${(p.x+1)*w/2}px`;label.style.top=`${(1-p.y)*h/2}px`;}}
  clearOverlay(){if(this.overlay){this.group.remove(this.overlay);this.disposeModel(this.overlay);this.overlay=null;}}
  overlayTarget(target,t){this.clearOverlay();const input=target.model?.geometry?.attributes.position;if(!input)throw Error('请先加载右侧点云。');const inverse=invertTransform(t),out=[];
    const index=target.model.geometry.index,count=index?.count??input.count;
    for(let j=0;j<count;j+=Math.max(1,Math.ceil(count/100000))){const i=index?index.getX(j):j;out.push(...applyTransform(inverse,[input.getX(i),input.getY(i),input.getZ(i)]));}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(out,3));
    this.overlay=new THREE.Points(geo,new THREE.PointsMaterial({color:0x45dcff,size:2,sizeAttenuation:false,transparent:true,opacity:.32,depthTest:false,depthWrite:false}));this.overlay.renderOrder=100;this.group.add(this.overlay);
  }
  disposeModel(m){if(m.isPoints){m.geometry.dispose();m.material.dispose();}else m.dispose?.();}
  dispose(){this.worker?.terminate();this.flight.dispose();this.observer.disconnect();this.renderer.setAnimationLoop(null);this.controls.dispose();if(this.model)this.disposeModel(this.model);this.clearOverlay();this.spark?.dispose();this.renderer.dispose();}
}
