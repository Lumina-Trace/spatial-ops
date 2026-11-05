import {
  THREE,
  OrbitControls,
  SparkRenderer,
  SplatMesh,
} from "./vendor/engine.js";
import { createModelStream } from "./model-input.js";

export class SpatialViewer {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.current = null;
    this.points = [];
    this.labels = [];
    this.modelBox = null;
    this.orientation = "y";
    this.selected = null;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0b151a, 0);
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(44, 1, 0.01, 10000);
    this.camera.position.set(30, 24, 35);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.94;
    this.controls.autoRotateSpeed = 0.55;
    this.spark = new SparkRenderer({
      renderer: this.renderer,
      lodSplatCount: innerWidth < 700 ? 750_000 : 2_000_000,
    });
    this.scene.add(this.spark);
    this.route = new THREE.Group();
    this.scene.add(this.route);
    this.grid = new THREE.GridHelper(40, 40, 0x456555, 0x233c35);
    this.grid.visible = false;
    this.scene.add(this.grid);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.frameTime = performance.now();
    this.frames = 0;
    this.disposed = false;
    this.renderer.setAnimationLoop(() => this.frame());
    this.renderer.domElement.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      callbacks.fatal?.(
        "显卡上下文已丢失。请关闭其他占用显存的页面，然后重新加载。",
      );
    });
    this.renderer.domElement.addEventListener("dblclick", (event) =>
      this.pickPoint(event),
    );
  }
  resize() {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  frame() {
    if (this.disposed) return;
    try {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.updateLabels();
      this.frames++;
      const now = performance.now();
      if (now - this.frameTime > 900) {
        this.callbacks.fps?.(
          Math.round((this.frames * 1000) / (now - this.frameTime)),
        );
        this.frames = 0;
        this.frameTime = now;
      }
      this.callbacks.angle?.(
        Math.atan2(
          this.camera.position.x - this.controls.target.x,
          this.camera.position.z - this.controls.target.z,
        ),
      );
    } catch (error) {
      this.renderer.setAnimationLoop(null);
      this.callbacks.fatal?.("三维渲染失败：" + error.message);
    }
  }
  async prepare(file, { lod = false, onRead, onStage = () => {} } = {}) {
    let mesh;
    try {
      mesh = new SplatMesh({
        stream: createModelStream(file, onRead),
        streamLength: file.size,
        fileName: file.name,
        lod,
        nonLod: false,
      });
      await mesh.initialized;
      // With nonLod:false, LoD data can exist without a retained full-detail copy.
      const packed = mesh.packedSplats || mesh.extSplats;
      const source = packed?.numSplats ? packed : packed?.lodSplats;
      if (!source?.numSplats) throw new Error("文件不包含可显示的高斯数据");
      onStage("正在计算场景范围");
      // getBoundingBox() synchronously visits every splat. Yield between batches
      // so large maps keep the loading UI and other controls responsive.
      const box = new THREE.Box3();
      // 同时抽样中心点，用分位数估计"真实场景"范围，排除外围浮点壳。
      const stride = Math.max(1, Math.floor(source.numSplats / 300_000));
      const sx = [], sy = [], sz = [];
      for (let first = 0; first < source.numSplats; first += 32768) {
        const end = Math.min(source.numSplats, first + 32768);
        for (let i = first; i < end; i++) {
          const { center } = source.getSplat(i);
          if (![center.x, center.y, center.z].every(Number.isFinite)) continue;
          box.expandByPoint(center);
          if (i % stride === 0) {
            sx.push(center.x);
            sy.push(center.y);
            sz.push(center.z);
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (box.isEmpty()) throw new Error("模型坐标无效");
      for (const a of [sx, sy, sz]) a.sort((m, n) => m - n);
      const q = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
      const core = new THREE.Box3(
        new THREE.Vector3(q(sx, 0.03), q(sy, 0.03), q(sz, 0.03)),
        new THREE.Vector3(q(sx, 0.97), q(sy, 0.97), q(sz, 0.97)),
      );
      const median = new THREE.Vector3(q(sx, 0.5), q(sy, 0.5), q(sz, 0.5));
      return {
        mesh,
        box,
        core,
        median,
        count: source.numSplats,
        lod: !!packed.lodSplats || !!packed.extra?.lodTree,
      };
    } catch (error) {
      mesh?.dispose();
      throw error;
    }
  }
  releaseModel() {
    if (this.current) {
      this.scene.remove(this.current);
      this.current.dispose();
      this.current = null;
    }
    this.modelBox = null;
    this.presetView = null;
    this.setPoints([], () => {});
    this.renderer.renderLists.dispose();
  }
  commit({ mesh, box, core, median, count }, presetView = null) {
    const old = this.current;
    this.current = mesh;
    this.modelBox = box.clone();
    this.coreBox = (core || box).clone();
    this.median = (median || box.getCenter(new THREE.Vector3())).clone();
    this.presetView = presetView;
    this.captureQuaternion = new THREE.Quaternion();
    if (presetView) {
      this.captureQuaternion.setFromUnitVectors(
        new THREE.Vector3(...presetView.up).normalize(),
        new THREE.Vector3(0, 1, 0),
      );
      mesh.quaternion.copy(this.captureQuaternion);
    }
    this.orientation = presetView ? "capture" : "y";
    this.scene.add(mesh);
    if (old) {
      this.scene.remove(old);
      old.dispose();
    }
    this.fit();
    return count;
  }
  bounds() {
    if (!this.current) return null;
    this.current.updateMatrixWorld(true);
    return this.modelBox.clone().applyMatrix4(this.current.matrixWorld);
  }
  fit(top = false) {
    const box = this.bounds();
    if (!box) return;
    if (this.presetView) {
      this.current.updateMatrixWorld(true);
      const target = new THREE.Vector3(...this.presetView.target).applyMatrix4(
        this.current.matrixWorld,
      );
      const position = new THREE.Vector3(
        ...this.presetView.position,
      ).applyMatrix4(this.current.matrixWorld);
      const offset = position.clone().sub(target);
      const distance = offset.length();
      if (top) offset.set(0, distance * 1.6, 0.001);
      else if (this.camera.aspect < 1) offset.multiplyScalar(1.25);
      this.controls.target.copy(target);
      this.camera.position.copy(target).add(offset);
      this.camera.near = 0.01;
      this.camera.far = 10000;
      this.camera.updateProjectionMatrix();
      this.controls.minDistance = 0.08;
      this.controls.maxDistance = distance * 15;
      this.controls.update();
      this.grid.position.set(target.x, target.y - 1, target.z);
      this.grid.scale.setScalar(distance / 10);
      return;
    }
    // 用核心范围（3%~97% 分位）代替完整包围盒，外围浮点不再把相机推到场景外。
    this.current.updateMatrixWorld(true);
    const core = this.coreBox.clone().applyMatrix4(this.current.matrixWorld);
    const center = this.median.clone().applyMatrix4(this.current.matrixWorld);
    const size = core.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.01);
    if (top) {
      const fitAngle = THREE.MathUtils.degToRad(this.camera.fov / 2);
      const distance = (Math.max(size.x, size.z) / 2 / Math.tan(fitAngle)) * 1.1;
      this.controls.target.copy(center);
      this.camera.position.set(center.x, core.max.y + distance, center.z + 0.001);
    } else {
      // 室内视角：从中位点水平后退一小段，略微抬高，看向场景中心。
      const horiz = Math.max(size.x, size.z);
      const back = new THREE.Vector3(1, 0, 1.35)
        .normalize()
        .multiplyScalar(horiz * 0.18);
      this.controls.target.copy(center);
      this.camera.position
        .copy(center)
        .add(back)
        .add(new THREE.Vector3(0, size.y * 0.12, 0));
    }
    this.camera.near = Math.max(radius / 5000, 0.005);
    this.camera.far = radius * 200;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = radius * 4;
    this.controls.update();
    this.grid.position.set(center.x, core.min.y, center.z);
    this.grid.scale.setScalar(radius / 13);
  }
  orient(value) {
    if (!this.current) return;
    this.orientation = value;
    if (value === "capture")
      this.current.quaternion.copy(this.captureQuaternion);
    else
      this.current.rotation.set(
        value === "z" ? -Math.PI / 2 : value === "flip" ? Math.PI : 0,
        0,
        0,
      );
    this.current.updateMatrixWorld(true);
    this.fit();
  }
  quality(value) {
    this.spark.lodSplatCount =
      value === "low" ? 750_000 : value === "high" ? 4_000_000 : 2_000_000;
    this.spark.lodDirty = true;
    this.renderer.setPixelRatio(
      value === "low"
        ? 1
        : value === "high"
          ? Math.min(devicePixelRatio, 2)
          : Math.min(devicePixelRatio, 1.5),
    );
    this.resize();
  }
  setPoints(points, onSelect) {
    this.points = points;
    this.route.clear();
    this.routeResources?.forEach((r) => r.dispose());
    this.routeResources = [];
    this.labels.forEach((l) => l.element.remove());
    this.labels = [];
    const color = new THREE.Color();
    const vectors = [];
    const bounds = this.bounds();
    const span = this.presetView
      ? new THREE.Vector3(...this.presetView.position).distanceTo(
          new THREE.Vector3(...this.presetView.target),
        ) * 3
      : bounds
        ? bounds.getSize(new THREE.Vector3()).length()
        : 30;
    const unit = span / 32;
    for (const point of points) {
      const p = new THREE.Vector3(...point.position);
      vectors.push(p.clone().add(new THREE.Vector3(0, unit * 0.07, 0)));
      color.set(point.status === "warning" ? 0xe6b66b : 0x64e8ad);
      const geo = new THREE.RingGeometry(unit * 0.17, unit * 0.26, 24);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: color.clone(),
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthTest: false,
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.position.copy(p);
      ring.position.y += unit * 0.06;
      ring.renderOrder = 9;
      this.route.add(ring);
      this.routeResources.push(geo, mat);
      const stemGeo = new THREE.BufferGeometry().setFromPoints([
        p,
        p.clone().add(new THREE.Vector3(0, unit * 0.8, 0)),
      ]);
      const stemMat = new THREE.LineBasicMaterial({
        color: color.clone(),
        transparent: true,
        opacity: 0.7,
        depthTest: false,
      });
      this.route.add(new THREE.Line(stemGeo, stemMat));
      this.routeResources.push(stemGeo, stemMat);
      const element = document.createElement("button");
      element.className =
        "scene-label" + (point.status === "warning" ? " warning" : "");
      element.textContent = point.id;
      if (point.status === "warning") {
        const t = document.createElement("small");
        t.textContent = "待复核";
        element.appendChild(t);
      }
      element.setAttribute("aria-label", `${point.id} ${point.name}`);
      element.addEventListener("click", () => onSelect(point.id));
      document.querySelector("#labels").append(element);
      this.labels.push({
        element,
        position: p.clone().add(new THREE.Vector3(0, unit * 0.85, 0)),
        id: point.id,
      });
    }
    if (vectors.length > 1) {
      const geo = new THREE.BufferGeometry().setFromPoints(vectors);
      const mat = new THREE.LineDashedMaterial({
        color: 0x66d79b,
        dashSize: unit * 0.25,
        gapSize: unit * 0.14,
        transparent: true,
        opacity: 0.65,
        depthTest: false,
      });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      line.renderOrder = 8;
      this.route.add(line);
      this.routeResources.push(geo, mat);
    }
    this.select(this.selected);
    this.updateLabels();
  }
  updateLabels() {
    const width = this.container.clientWidth,
      height = this.container.clientHeight;
    for (const l of this.labels) {
      const p = l.position.clone().project(this.camera);
      const visible =
        this.route.visible &&
        p.z > -1 &&
        p.z < 1 &&
        Math.abs(p.x) < 1 &&
        Math.abs(p.y) < 1;
      l.element.hidden = !visible;
      if (visible) {
        l.element.style.left = `${(p.x * 0.5 + 0.5) * width}px`;
        l.element.style.top = `${(-p.y * 0.5 + 0.5) * height}px`;
      }
    }
  }
  select(id) {
    this.selected = id;
    this.labels.forEach((l) =>
      l.element.classList.toggle("selected", l.id === id),
    );
  }
  focus(id) {
    const point = this.points.find((p) => p.id === id);
    if (!point) return;
    const target = new THREE.Vector3(...point.position);
    const radius = this.presetView
      ? 3
      : this.bounds().getSize(new THREE.Vector3()).length() * 0.2;
    const offset = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize()
      .multiplyScalar(radius);
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(offset);
    this.controls.update();
  }
  async pickPoint(event) {
    if (!this.addingPoint || !this.current) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    this.callbacks.pickStatus?.(true);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      this.current.updateMatrixWorld(true);
      const hit = ray.intersectObject(this.current, false)[0];
      if (hit) this.callbacks.point?.(hit.point.toArray());
      else this.callbacks.toast?.("这里没有命中模型表面，请双击建筑或地面。");
    } catch (error) {
      this.callbacks.toast?.("无法选取点位：" + error.message);
    } finally {
      this.callbacks.pickStatus?.(false);
    }
  }
  dispose() {
    this.disposed = true;
    this.observer.disconnect();
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();
    this.current?.dispose();
    this.routeResources?.forEach((r) => r.dispose());
    this.grid.geometry.dispose();
    this.grid.material.dispose();
    this.spark.dispose();
    this.renderer.dispose();
  }
}