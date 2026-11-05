import {THREE} from './vendor/engine.js';

// Free camera: rotation is around the camera itself, never around a model center.
export class FlightNavigation {
  constructor(viewer){
    this.viewer=viewer;this.canvas=viewer.renderer.domElement;this.keys=new Set();this.speed=1;
    this.events=new AbortController();const options={signal:this.events.signal};
    this.canvas.tabIndex=0;
    this.canvas.addEventListener('pointerdown',e=>{
      this.canvas.focus({preventScroll:true});
      if(!this.active||e.button!==0)return;
      e.preventDefault();this.drag={id:e.pointerId,x:e.clientX,y:e.clientY};this.canvas.setPointerCapture(e.pointerId);
    },options);
    this.canvas.addEventListener('pointermove',e=>{
      if(!this.active||this.drag?.id!==e.pointerId)return;
      const rotation=new THREE.Euler().setFromQuaternion(viewer.camera.quaternion,'YXZ');
      rotation.y-=(e.clientX-this.drag.x)*.003;rotation.x-=(e.clientY-this.drag.y)*.003;
      rotation.x=THREE.MathUtils.clamp(rotation.x,-Math.PI/2+.01,Math.PI/2-.01);rotation.z=0;
      viewer.camera.quaternion.setFromEuler(rotation);this.syncTarget();
      this.drag.x=e.clientX;this.drag.y=e.clientY;
    },options);
    for(const event of ['pointerup','pointercancel','lostpointercapture'])this.canvas.addEventListener(event,()=>this.drag=null,options);
    this.canvas.addEventListener('keydown',e=>{
      if(!this.active||e.metaKey||e.ctrlKey||e.altKey)return;
      if(e.code==='Escape'){this.canvas.blur();return;}
      if(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight'].includes(e.code)){e.preventDefault();this.keys.add(e.code);}
    },options);
    window.addEventListener('keyup',e=>this.keys.delete(e.code),options);
    this.canvas.addEventListener('blur',()=>this.stop(),options);
    window.addEventListener('blur',()=>this.stop(),options);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stop();},options);
    this.canvas.addEventListener('wheel',e=>{
      if(!this.active||!viewer.model)return;e.preventDefault();
      const forward=viewer.camera.getWorldDirection(new THREE.Vector3());
      viewer.camera.position.addScaledVector(forward,-Math.sign(e.deltaY)*this.baseSpeed()*.15);this.syncTarget();
    },{...options,passive:false});
  }
  setActive(active){this.stop();this.active=active;}
  stop(){this.keys.clear();this.drag=null;}
  baseSpeed(){return Math.max(this.viewer.radius||1,.001)*.35*this.speed;}
  syncTarget(){const v=this.viewer;v.controls.target.copy(v.camera.position).addScaledVector(v.camera.getWorldDirection(new THREE.Vector3()),Math.max(v.radius||1,.001));}
  update(dt){
    if(!this.active||!this.viewer.model||!this.keys.size)return;
    const has=k=>Number(this.keys.has(k)),v=this.viewer;
    const forward=v.camera.getWorldDirection(new THREE.Vector3()),right=new THREE.Vector3(1,0,0).applyQuaternion(v.camera.quaternion);
    const move=new THREE.Vector3().addScaledVector(forward,has('KeyW')-has('KeyS')).addScaledVector(right,has('KeyD')-has('KeyA'));
    move.y+=has('KeyE')-has('KeyQ');
    const fast=has('ShiftLeft')||has('ShiftRight');
    v.camera.position.addScaledVector(move.normalize(),this.baseSpeed()*Math.min(dt,.05)*(fast?4:1));this.syncTarget();
  }
  dispose(){this.stop();this.events.abort();}
}
