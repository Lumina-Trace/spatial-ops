import {CalibrationViewer} from './calibration-viewer.js';
import {solveAlignment,errorLabel,validateProject,validPoint} from './calibration-math.js';
const $=s=>document.querySelector(s), sides=['source','target'];
const DRAFT='spatial-ops-calibration-v1';
for(const id of ['source','target','project']) $(`#${id}-load`).onclick=()=>$(`#${id}-file`).click();
let pairs=[],selected=null,result=null,editing=null,busy=false;
let models={source:null,target:null},expected=null;
const viewers={};
function notice(message,error=false){$('#notice').textContent=message;$('#notice').classList.toggle('error',error);}
try {for(const side of sides)viewers[side]=new CalibrationViewer($(`#${side}-view`),side,picked,m=>notice(m,true));viewers.target.orient('z');}
catch(e){notice('三维窗口初始化失败：'+e.message,true);}
const coord=p=>p?p.map(n=>Number(n.toFixed(5))).join(', '):'点击后在地图中双击';
function available(){return !!models.source&&!!models.target&&!busy&&(!expected||sides.every(s=>matches(models[s],expected[s])));}
function matches(a,b){return !!a&&!!b&&a.size===b.size&&a.fingerprint===b.fingerprint;}
function canSave(){return !!(models.source&&models.target)||!!expected;}
function metadata(){return sides.reduce((a,s)=>(a[s]={...(models[s]||expected?.[s]),up:$(`#${s}-up`).value},a),{});}
function project(){return {schema:'spatial-ops-calibration',version:1,savedAt:new Date().toISOString(),models:metadata(),mode:$('#mode').value,unit:$('#unit').value,pairs,coordinateSystem:'native-file',transformDirection:'source-to-target',matrixLayout:'row-major',result:result?{...result,verification:result.check.count?'check-points-measured':'not-independently-checked'}:null,fingerprintMethod:'FNV1a-two-seeds-first-last-64KiB-and-file-size (quick association, not full-file integrity)'};}
function draft(){if(!canSave())return;try{localStorage.setItem(DRAFT,JSON.stringify(project()));$('#restore-draft').hidden=false;}catch{notice('浏览器无法保存草稿，请导出 JSON 留存。',true);}}
function invalidate(){result=null;$('#overlay').checked=false;viewers.source?.clearOverlay();}
function render(){
  $('#pairs').replaceChildren();$('#pairs-empty').hidden=!!pairs.length;$('#pair-count').textContent=String(pairs.length).padStart(2,'0');
  for(const row of pairs){const tr=document.createElement('tr');tr.classList.toggle('selected',row.id===selected);
    const name=document.createElement('td'),strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=row.id+' · '+row.name;small.textContent=row.role==='fit'?'标定点':'独立检查点';name.append(strong,small);tr.append(name);
    for(const side of sides){const td=document.createElement('td'),button=document.createElement('button');button.className='coord-button';button.textContent=coord(row[side]);button.title=`${row.id} ${side==='source'?'左侧':'右侧'}取点`;button.setAttribute('aria-label',button.title);button.disabled=!available();button.onclick=()=>arm(row.id,side);td.append(button);tr.append(td);}
    const error=document.createElement('td');const value=result?.[row.role==='fit'?'fit':'check'].items.find(r=>r.id===row.id)?.error;error.textContent=errorLabel(value,$('#unit').value);tr.append(error);
    const actions=document.createElement('td'),wrap=document.createElement('div');wrap.className='row-actions';
    for(const [text,handler] of [['编辑',()=>edit(row.id)],['删除',()=>remove(row.id)]]){const b=document.createElement('button');b.textContent=text;b.setAttribute('aria-label',`${text} ${row.id}`);b.disabled=busy;b.onclick=handler;wrap.append(b);}actions.append(wrap);tr.append(actions);$('#pairs').append(tr);
  }
  for(const side of sides)viewers[side]?.setMarkers(models[side]?pairs:[],selected);
  const complete=pairs.length>0&&pairs.every(r=>validPoint(r.source)&&validPoint(r.target));
  $('#solve').disabled=!available()||!complete||pairs.filter(r=>r.role==='fit').length<3;
  $('#export').disabled=!canSave()||busy;
  $('#overlay').disabled=!result||!available();
  $('#add-fit').disabled=$('#add-check').disabled=!available()||pairs.length>=500;
  $('#clear').disabled=(!pairs.length&&!expected)||busy;
  $('#result-state').textContent=result?(result.check.count?'已计算 · 待验收':'待独立检查'):'待标定';
  $('#fit-rms').textContent=errorLabel(result?.fit.rms,$('#unit').value);
  $('#check-rms').textContent=errorLabel(result?.check.rms,$('#unit').value);
  $('#max-error').textContent=errorLabel(result?Math.max(result.fit.max,result.check.max??0):null,$('#unit').value);
  $('#scale').textContent=result?result.scale.toPrecision(7):'—';
  $('#matrix').textContent=result?Array.from({length:4},(_,i)=>result.matrix.slice(i*4,i*4+4).map(v=>v.toFixed(7).padStart(13)).join(' ')).join('\n'):'尚未计算';
  $('#result-note').textContent=result?(result.check.count?`已用 ${result.check.count} 组独立检查点测量误差，请结合任务要求验收。`:'尚未添加独立检查点；拟合误差小并不等于现场定位准确。')+(result.scale<.01||result.scale>100?' 比例差异较大，请核对文件单位和对应关系。':''):'至少 3 组不共线的标定点。建议再添加 2 组独立检查点。';
  document.querySelectorAll('.steps li').forEach((el,i)=>el.classList.toggle('current',i===(result?2:available()?1:0)));
}
function navigationHint(side){return viewers[side]?.navigationMode==='fly'?'点击画面 · WASD 移动 · Q/E 升降 · 拖动转头':viewers[side]?.navigationMode==='pan'?'左键 / 单指拖动平移 · 滚轮缩放':'左键旋转 · Shift + 拖动平移';}
function disarm(){for(const s of sides){viewers[s]?.setArmed(false);$(`#${s}-pick`).textContent=navigationHint(s);}}
function arm(id,side){if(!available())return;selected=id;for(const s of sides){viewers[s].setArmed(s===side);$(`#${s}-pick`).textContent=s===side?`${id} · 双击选择这个位置`:'等待另一侧配对';}render();$(`#${side}-view`).scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});notice(`${id}：请在${side==='source'?'左侧 3DGS':'右侧点云'}双击选取同一个固定角点。`);}
function picked(side,p){const row=pairs.find(r=>r.id===selected);if(!row||!available())return;row[side]=p;invalidate();draft();const other=side==='source'?'target':'source';if(!row[other])arm(row.id,other);else{disarm();render();notice(`${row.id} 已配对。继续添加分散的对应点，或计算对齐。`);}}
function add(role){if(!available())return;const n=Math.max(0,...pairs.map(r=>Number(r.id.replace(/\D/g,''))||0))+1;const id=`P-${String(n).padStart(2,'0')}`;pairs.push({id,name:role==='fit'?'固定角点':'检查位置',role,source:null,target:null});invalidate();arm(id,'source');draft();}
function remove(id){pairs=pairs.filter(r=>r.id!==id);if(selected===id){selected=null;disarm();}invalidate();render();draft();}
function edit(id){editing=id;const row=pairs.find(r=>r.id===id);$('#point-name').value=row.name;$('#point-role').value=row.role;for(const s of sides)['x','y','z'].forEach((a,i)=>$(`#${s}-${a}`).value=row[s]?.[i]??'');$('#edit-error').textContent='';$('#edit-dialog').showModal();}
$('#close-edit').onclick=()=>$('#edit-dialog').close();
$('#edit-form').onsubmit=e=>{e.preventDefault();const row=pairs.find(r=>r.id===editing);if(!row)return;const next={};for(const s of sides){const values=['x','y','z'].map(a=>$(`#${s}-${a}`).value.trim());if(values.every(v=>v===''))next[s]=null;else if(values.every(v=>v!==''&&Number.isFinite(Number(v))))next[s]=values.map(Number);else{$('#edit-error').textContent='请填写完整且有效的 XYZ，或整侧留空。';return;}}Object.assign(row,next,{name:$('#point-name').value.trim()||'未命名点位',role:$('#point-role').value});disarm();invalidate();render();draft();$('#edit-dialog').close();};
async function identity(file){const chunks=[new Uint8Array(await file.slice(0,65536).arrayBuffer()),new Uint8Array(await file.slice(Math.max(0,file.size-65536)).arrayBuffer()),new TextEncoder().encode(String(file.size))];let a=2166136261,b=3335557771;for(const chunk of chunks)for(const x of chunk){a=Math.imul(a^x,16777619)>>>0;b=Math.imul(b^x,16777619)>>>0;}return {name:file.name,size:file.size,fingerprint:a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0')};}
function setBusy(value){busy=value;for(const s of sides){$(`#${s}-file`).disabled=$(`#${s}-load`).disabled=value;$(`#${s}-up`).disabled=value;}$('body').classList.toggle('busy',value);$('#new-project').disabled=$('#project-load').disabled=$('#project-file').disabled=$('#restore-draft').disabled=$('#mode').disabled=$('#unit').disabled=value;render();}
for(const side of sides){
  $(`#${side}-file`).onchange=async e=>{const file=e.target.files[0];e.target.value='';if(!file||busy)return;let meta,loaded=false;
    try{setBusy(true);disarm();meta=await identity(file);const required=expected?.[side]||(pairs.length?models[side]:null);if(required&&!matches(meta,required))throw Error('文件与已有配对记录不匹配。请加载原模型，或先清空配对再更换地图。');
      const stats=await viewers[side].load(file,m=>{notice(`${side==='source'?'A':'B'} · ${file.name} · ${m}`);$(`#${side}-meta`).textContent=m;});
      if(side==='target'){viewers.target.model.material.size=Number($('#point-size').value);updateNoise();}
      models[side]={...meta,up:$(`#${side}-up`).value};viewers[side].orient(models[side].up);$(`#${side}-empty`).hidden=true;
      $(`#${side}-meta`).textContent=`${file.name} · ${(file.size/1048576).toFixed(1)} MB · ${stats.previewCount.toLocaleString()}/${stats.originalCount.toLocaleString()} 点`;
      $(`#${side}-meta`).title=stats.previewCount<stats.originalCount?'已抽样显示原始点；放大后选取清晰角点，也可输入精确坐标。':file.name;
      loaded=true;invalidate();notice(stats.previewCount<stats.originalCount?'点云已加载并抽样显示。标记取自实际保留的点；可通过“编辑”输入精确坐标。':'模型已加载。两侧就绪后，添加标定点开始配对。');
    }catch(err){notice(err.message,true);$(`#${side}-meta`).textContent=models[side]?.name||'加载失败，请重试';}finally{setBusy(false);if(loaded&&available()){draft();if(expected)notice('两份模型与标定记录匹配，可复核点位并重新计算。');}}
  };
  $(`#${side}-up`).onchange=e=>{viewers[side]?.orient(e.target.value);if(models[side])models[side].up=e.target.value;draft();};
}
$('#point-size').oninput=e=>{if(viewers.target?.model?.material)viewers.target.model.material.size=Number(e.target.value);};
document.querySelectorAll('[data-nav-side]').forEach(button=>button.onclick=()=>{
  const side=button.dataset.navSide,mode=button.dataset.navMode;
  viewers[side]?.setNavigationMode(mode);
  document.querySelectorAll(`[data-nav-side="${side}"]`).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.navMode===mode)));
  $(`#${side}-speed-label`).hidden=mode!=='fly';
  if(mode==='fly')viewers[side]?.renderer.domElement.focus({preventScroll:true});
  if(!viewers[side]?.armed)$(`#${side}-pick`).textContent=navigationHint(side);
  notice(mode==='fly'?'漫游：点击画面后按住 WASD 移动，Q 下降 / E 上升；按住左键拖动转头，Shift 加速，Esc 退出键盘控制。':mode==='pan'?'平移模式：直接按住左键拖动；触控板按住后拖动。滚轮缩放到鼠标位置，双击仍可选取标定点。':'旋转模式：左键拖动旋转，右键或 Shift + 左键拖动平移，滚轮缩放到鼠标位置。');
});
for(const side of sides)$(`#${side}-speed`).onchange=e=>{viewers[side].flight.speed=Number(e.target.value);};
function updateNoise(){
  const stats=viewers.target?.setNoiseMode($('#noise-mode').value);
  $('#noise-status').textContent=stats?(stats.skipped?'点数过少或无空间跨度，未过滤':`显示 ${stats.kept.toLocaleString()} / ${stats.total.toLocaleString()} 点 · 已隐藏 ${stats.removed.toLocaleString()}`):'加载后自动分析 · 不修改原文件';
  if($('#overlay').checked&&result&&available())viewers.source.overlayTarget(viewers.target,result);
  return stats;
}
$('#noise-mode').onchange=()=>{const stats=updateNoise();notice(stats?.kept===0?'当前强度过滤了全部预览点，请降低强度或关闭去噪。':'去噪只影响显示与新选点，已标记的原始坐标保持不变。稀疏结构缺失时可降低强度；密集的漂浮杂点仍需人工避开。',stats?.kept===0);};
document.querySelectorAll('[data-fit]').forEach(b=>b.onclick=()=>viewers[b.dataset.fit]?.fit());
document.querySelectorAll('[data-top]').forEach(b=>b.onclick=()=>viewers[b.dataset.top]?.fit(true));
$('#add-fit').onclick=()=>add('fit');$('#add-check').onclick=()=>add('check');
$('#new-project').onclick=()=>{if((pairs.length||models.source||models.target||expected)&&!confirm('开始新的标定？当前记录和本机草稿将清空，请先导出需要保留的内容。'))return;pairs=[];selected=null;models={source:null,target:null};expected=null;disarm();invalidate();for(const side of sides){const v=viewers[side];if(v?.model){v.group.remove(v.model);v.disposeModel(v.model);v.model=null;v.box=null;}$(`#${side}-empty`).hidden=false;$(`#${side}-meta`).textContent=side==='source'?'尚未加载模型':'尚未加载点云';}$('#noise-status').textContent='加载后自动分析 · 不修改原文件';$('#mode').value='similarity';$('#unit').value='unknown';try{localStorage.removeItem(DRAFT);}catch{}$('#restore-draft').hidden=true;render();notice('已新建标定。先加载两张地图，文件只在本机处理。');};
$('#clear').onclick=()=>{if(!confirm('清空全部配对？需要保留时，请先导出标定。'))return;pairs=[];selected=null;expected=null;disarm();invalidate();render();draft();notice('配对已清空，可以更换地图。');};
$('#mode').onchange=$('#unit').onchange=()=>{invalidate();render();draft();};
$('#solve').onclick=()=>{try{if(!available())throw Error('请先加载匹配的两份模型。');result=solveAlignment(pairs,$('#mode').value==='similarity');disarm();render();draft();notice('已计算 A → B 的坐标变换。开启“叠加点云”检查几何重合，并添加独立检查点验证。');}catch(e){invalidate();render();notice(e.message,true);}};
$('#overlay').onchange=e=>{try{if(e.target.checked&&result&&available())viewers.source.overlayTarget(viewers.target,result);else viewers.source.clearOverlay();}catch(err){e.target.checked=false;notice(err.message,true);}};
$('#export').onclick=()=>{if(!canSave())return;const data=project();const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='map-calibration.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notice(result?'已导出坐标变换、对应点及误差报告。':'已导出配对草稿；尚未计算有效变换。');};
function restore(data){validateProject(data);pairs=data.pairs.map(r=>({...r}));expected=data.models;selected=null;$('#mode').value=data.mode;$('#unit').value=data.unit;for(const s of sides){$(`#${s}-up`).value=expected[s].up;viewers[s]?.orient(expected[s].up);if(models[s]&&!matches(models[s],expected[s])){models[s]=null;viewers[s].model.visible=false;$(`#${s}-empty`).hidden=false;}$(`#${s}-meta`).textContent=models[s]?.name||`请加载：${expected[s].name}`;}invalidate();disarm();render();notice('已恢复配对记录。请加载匹配的原模型；导入的矩阵不会直接采信，需重新计算。');}
$('#project-file').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;try{if(f.size>2*1024*1024)throw Error('标定 JSON 过大，请选择本页导出的记录。');restore(JSON.parse(await f.text()));draft();}catch(e){notice('导入失败：'+e.message,true);}};
$('#restore-draft').onclick=()=>{try{restore(JSON.parse(localStorage.getItem(DRAFT)));}catch(e){notice('草稿无法恢复：'+e.message,true);}};
try{$('#restore-draft').hidden=!localStorage.getItem(DRAFT);}catch{}
window.addEventListener('pagehide',()=>{for(const v of Object.values(viewers))v.dispose();});
render();
