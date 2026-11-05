import { SpatialViewer } from "./viewer.js";
import { inspectModelFile, LARGE_MODEL_BYTES } from "./model-input.js";
const statusText = {
  custom: "自定义",
  pending: "待巡检",
  complete: "已完成",
  warning: "待复核",
};
import { SCENES } from "./scenes.js";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
let viewer,
  points = [],
  selected = null,
  currentPreset = null,
  loading = false,
  toastTimer,
  modelName = "",
  loadRevision = 0;
const formatNumber = (n) => n.toLocaleString("en-US");
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 4200);
}
function showLoading(title, detail) {
  $("#loading-title").textContent = title;
  $("#loading-detail").textContent = detail;
  $("#import-progress").textContent = `${title} · ${detail}`;
  $("#loading").hidden = false;
}
function setBusy(value) {
  loading = value;
  $("#import-progress").hidden = !value;
  [
    "#file-picker",
    "#demo-button",
    "#import-button",
    "#dialog-demo",
    "#load-mode",
    "#release-before-load",
  ].forEach((s) => ($(s).disabled = value));
  $("#scene-state").textContent = value
    ? "正在加载"
    : viewer?.current
      ? "可交互"
      : "等待场景";
}
function fatal(message) {
  $("#loading").hidden = true;
  $("#fatal-message").textContent = message;
  $("#fatal").hidden = false;
  $("#renderer-status").textContent = "渲染器不可用";
  $("#scene-state").textContent = "渲染异常";
}
function updateClock() {
  $("#clock").textContent = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}
updateClock();
setInterval(updateClock, 1000);
function setToggle(selector, on) {
  $(selector).classList.toggle("active", on);
  $(selector).setAttribute("aria-pressed", String(on));
}
function selectPoint(id) {
  const point = points.find((p) => p.id === id);
  if (!point) return;
  selected = id;
  viewer.select(id);
  $("#point-id").textContent = point.id;
  $("#point-name").textContent = point.name;
  $("#point-status").textContent = statusText[point.status] || "自定义";
  $("#point-note").textContent = point.note;
  $("#point-coordinates").textContent = point.position
    .map((v, i) => `${"XYZ"[i]} ${v.toFixed(2)}`)
    .join(" · ");
  $("#point-source").textContent = "当前场景点位";
  $("#focus-point").disabled = false;
  $$(".route-point").forEach((b) => {
    b.classList.toggle("active", b.dataset.id === id);
    b.setAttribute("aria-pressed", String(b.dataset.id === id));
  });
}
function userSelectPoint(id) {
  selectPoint(id);
  if (innerWidth <= 600) {
    $("#workspace").classList.remove("settings-mode");
    $("#workspace").classList.add("points-mode");
  }
}
function renderPoints() {
  $("#point-source").textContent = "当前场景点位";
  viewer.setPoints(points, userSelectPoint);
  $("#nav-point-count").textContent = String(points.length).padStart(2, "0");
  $("#route-points").replaceChildren();
  for (const p of points) {
    const b = document.createElement("button");
    b.className = `route-point ${p.status}`;
    b.dataset.id = p.id;
    b.setAttribute("aria-label", `${p.id} ${p.name}`);
    const dot = document.createElement("i");
    dot.textContent =
      p.status === "warning" ? "!" : p.status === "complete" ? "✓" : "";
    const label = document.createElement("small");
    label.textContent = p.id;
    b.append(dot, label);
    b.addEventListener("click", () => userSelectPoint(p.id));
    $("#route-points").append(b);
  }
  if (points.length) {
    selectPoint(
      points.some((p) => p.id === selected) ? selected : points[0].id,
    );
  } else {
    selected = null;
    $("#point-id").textContent = "—";
    $("#point-name").textContent = "尚未添加巡检点";
    $("#point-note").textContent = "点击下方定位针，再双击场景表面添加。";
    $("#point-status").textContent = "待标注";
    $("#point-coordinates").textContent = "坐标以当前模型为准";
    $("#focus-point").disabled = true;
    const hint = document.createElement("span");
    hint.className = "empty-route";
    hint.textContent = "添加点位，建立你的巡检路线";
    $("#route-points").append(hint);
  }
  $("#route-subtitle").textContent = "当前模型 · 未标定";
  $("#export-points").disabled = !points.length;
}
function setAdding(value) {
  if (!viewer) return;
  if (value) {
    $("#workspace").classList.remove("settings-mode", "points-mode");
  }
  viewer.addingPoint = value;
  setToggle("#add-point", value);
  $("#point-hint").hidden = !value;
  $("#viewport").style.cursor = value ? "crosshair" : "";
}
function addPoint(position) {
  const id = `P-${String(points.length + 1).padStart(2, "0")}`;
  points.push({
    id,
    name: `自定义点位 ${points.length + 1}`,
    position,
    status: "custom",
    note: "当前模型坐标；尚未与机器人地图标定。",
  });
  selected = id;
  renderPoints();
  setAdding(false);
  toast(`${id} 已添加，可从底部导出点位。`);
}
async function loadModel(file, { preset = null, busyOwned = false } = {}) {
  if (loading && !busyOwned) {
    toast("正在加载场景，请稍候。");
    return;
  }
  let candidate;
  const revision = ++loadRevision;
  try {
    setBusy(true);
    setAdding(false);
    $("#import-error").hidden = true;
    $("#fatal").hidden = true;
    showLoading("正在检查模型", file.name);
    const { ext, cloud, sourceCount } = await inspectModelFile(file);
    const lod =
      !cloud &&
      $("#load-mode").value === "auto" &&
      // 桌面端显卡能直接跑几百万高斯（SuperSplat 就是全量渲染），只在超大模型或移动端启用 LoD。
      (innerWidth < 700
        ? file.size >= LARGE_MODEL_BYTES || sourceCount > 2_000_000
        : sourceCount > 6_000_000);
    if (!preset && $("#release-before-load").checked) {
      viewer.releaseModel();
      points = [];
      selected = null;
      modelName = "";
      currentPreset = null;
      renderPoints();
      $("#model-name").textContent = "已释放旧场景";
      $("#model-source").textContent = "等待新模型";
      $("#scene-title").textContent = "等待加载模型";
      $("#scene-description").textContent = "旧场景已释放";
      $("#scene-credit").hidden = true;
      $("#real-scene-note").hidden = true;
      $("#model-load-note").hidden = true;
      $("#splat-count").textContent = "—";
      $("#file-size").textContent = "—";
      $("#file-format").textContent = "—";
    }
    $("#load-progress").hidden = false;
    $("#load-progress").value = 0;
    candidate = await viewer.prepare(file, {
      lod,
      onRead: (loaded, total) => {
        $("#load-progress").value = (loaded / total) * 100;
        if (loaded < total)
          showLoading(
            "正在分块读取 3DGS",
            `${(loaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB · ${Math.floor((loaded / total) * 100)}%`,
          );
        else {
          $("#load-progress").removeAttribute("value");
          showLoading(
            lod ? "正在解码并优化大模型" : "正在解码三维模型",
            lod
              ? "文件读取完成，正在后台构建多精度模型…"
              : "文件读取完成，正在后台解码…",
          );
        }
      },
      onStage: (stage) => showLoading(stage, "分批处理场景范围，请稍候…"),
    });
    if (revision !== loadRevision) {
      candidate.mesh.dispose();
      return;
    }
    const count = viewer.commit(candidate, preset?.view);
    viewer.quality($("#quality").value); // 让界面显示的档位与实际渲染参数一致
    const usesLod = candidate.lod;
    candidate = null;
    $("#model-load-note").hidden = false;
    $("#model-load-note").textContent = usesLod
      ? "多精度显示已启用 · 可切换流畅 / 均衡 / 精细"
      : "完整细节显示 · 文件已分块读取";
    currentPreset = preset;
    modelName = file.name;
    points = [];
    selected = null;
    $("#capture-option").hidden = !preset?.view;
    $("#orientation").value = preset?.view ? "capture" : "y";
    $("#model-name").textContent = file.name;
    $("#model-name").title = file.name;
    $("#model-source").textContent = preset
      ? preset.source
      : cloud
        ? "本地文件 · 普通点云 PLY"
        : "本地文件 · 未上传";
    $("#scene-title").textContent = preset
      ? preset.title
      : file.name.replace(/\.[^.]+$/, "");
    $("#scene-description").textContent = preset
      ? preset.description
      : cloud
        ? "普通点云 · 非 3DGS"
        : "本地 3DGS 场景";
    $("#scene-credit").hidden = !preset?.sourceUrl;
    $("#scene-credit").href = preset?.sourceUrl || "#";
    $("#scene-credit").textContent = preset?.sourceUrl ? "查看实景来源 ↗" : "";
    $("#real-scene-note").hidden = !preset?.sourceUrl;
    $("#splat-count").textContent = formatNumber(sourceCount || count);
    $("#splat-count").title =
      usesLod && !sourceCount
        ? "包含多精度层级的高斯总数"
        : "源模型高斯数量";
    $("#file-size").textContent = (file.size / 1048576).toFixed(2) + " MB";
    $("#file-format").textContent = ext.toUpperCase();
    $("#renderer-status").textContent = "WebGL 2 · Gaussian Splatting";
    $("#scene-state").textContent = "可交互";
    $("#task-title").textContent = "等待现场任务接入";
    $("#task-description").textContent = "当前模型尚未与设备关联";
    $("#task-percent").textContent = "—";
    $("#task-progress-bar").style.width = "0";
    renderPoints();
    $("#import-dialog").close();
    $("#workspace").classList.remove("points-mode", "settings-mode");
    $("#fatal").hidden = true;
    if (!preset)
      toast(
        cloud
          ? "已加载普通点云 PLY。它不会自动变为照片级 3DGS。"
          : "场景已加载。可调整坐标朝向，或添加巡检点。",
      );
  } catch (error) {
    candidate?.mesh.dispose();
    const message =
      "加载失败：" +
      (error.message || String(error) || "无法解码该文件") +
      "。大模型若内存不足，可勾选释放旧场景，或压缩模型后重试。";
    $("#import-error").textContent = message;
    $("#import-error").hidden = false;
    toast(message);
    if (!viewer?.current) fatal(message + "，你也可以尝试导入其他模型。");
    console.warn("Scene load failed:", error);
  } finally {
    setBusy(false);
    $("#loading").hidden = true;
    $("#load-progress").hidden = true;
  }
}
async function loadPreset(id) {
  if (loading) return;
  const preset = SCENES[id];
  if (!preset) return;
  setBusy(true);
  $("#import-dialog").close();
  try {
    showLoading("正在加载" + preset.title, "读取三维模型…");
    const response = await fetch(preset.url);
    if (!response.ok) throw new Error(`场景文件读取失败 (${response.status})`);
    const total = Number(response.headers.get("content-length"));
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      chunks.push(value);
      showLoading(
        "正在加载" + preset.title,
        `${(received / 1048576).toFixed(1)} MB${total ? " / " + (total / 1048576).toFixed(1) + " MB" : ""}`,
      );
    }
    const file = new File(chunks, preset.fileName);
    await loadModel(file, { preset, busyOwned: true });
  } catch (error) {
    toast(error.message);
    if (!viewer?.current)
      fatal(error.message + "。可以重试实景示例，或导入本地模型。");
  } finally {
    setBusy(false);
    $("#loading").hidden = true;
  }
}
$("#import-button").onclick = () => {
  $("#import-error").hidden = true;
  $("#import-dialog").showModal();
};
$("#file-picker").onclick = () => $("#file-input").click();
$("#file-input").onchange = () => {
  const f = $("#file-input").files[0];
  if (f) loadModel(f);
  $("#file-input").value = "";
};
$$(".close-dialog").forEach(
  (b) => (b.onclick = () => b.closest("dialog").close()),
);
$("#help-button").onclick = () => $("#help-dialog").showModal();
$$("dialog").forEach((d) =>
  d.addEventListener("click", (e) => {
    if (e.target === d) {
      const r = d.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        d.close();
    }
  }),
);
$("#demo-button").onclick = () => loadPreset("garden");
$("#learn-3dgs").onclick = () => $("#learn-dialog").showModal();
$("#dialog-demo").onclick = () => {
  $("#import-dialog").close();
  loadPreset("garden");
};
$("#mobile-settings").onclick = () => {
  $("#workspace").classList.remove("points-mode");
  $("#workspace").classList.toggle("settings-mode");
};
$("#fit-view").onclick = () => {
  viewer?.fit();
};
$("#top-view").onclick = () => viewer?.fit(true);
$("#auto-rotate").onclick = () => {
  if (!viewer) return;
  viewer.controls.autoRotate = !viewer.controls.autoRotate;
  setToggle("#auto-rotate", viewer.controls.autoRotate);
};
$("#toggle-grid").onclick = () => {
  if (!viewer) return;
  viewer.grid.visible = !viewer.grid.visible;
  setToggle("#toggle-grid", viewer.grid.visible);
};
$("#toggle-route").onclick = () => {
  if (!viewer) return;
  viewer.route.visible = !viewer.route.visible;
  setToggle("#toggle-route", viewer.route.visible);
};
$("#toggle-panels").onclick = () => {
  const enabled = $("#workspace").classList.toggle("focus-mode");
  setToggle("#toggle-panels", enabled);
};
$("#add-point").onclick = () => {
  if (!viewer?.current) {
    toast("请先加载场景。");
    return;
  }
  setAdding(!viewer.addingPoint);
};
$("#focus-point").onclick = () => viewer?.focus(selected);
$("#orientation").onchange = (e) => {
  if (!viewer?.current) return;
  if (points.length) {
    toast("已有点位会随模型一起旋转。");
  }
  const old = viewer.current.matrixWorld.clone();
  viewer.orient(e.target.value);
  const inverse = old.invert();
  const current = viewer.current.matrixWorld; // Preserve point alignment through model orientation changes.
  for (const p of points) {
    const x = p.position;
    const a = inverse.elements,
      b = current.elements;
    const q = [
      a[0] * x[0] + a[4] * x[1] + a[8] * x[2] + a[12],
      a[1] * x[0] + a[5] * x[1] + a[9] * x[2] + a[13],
      a[2] * x[0] + a[6] * x[1] + a[10] * x[2] + a[14],
    ];
    p.position = [
      b[0] * q[0] + b[4] * q[1] + b[8] * q[2] + b[12],
      b[1] * q[0] + b[5] * q[1] + b[9] * q[2] + b[13],
      b[2] * q[0] + b[6] * q[1] + b[10] * q[2] + b[14],
    ];
  }
  renderPoints();
};
$("#quality").onchange = (e) => viewer?.quality(e.target.value);
$("#fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $("#workspace").requestFullscreen();
  } catch {
    toast("当前浏览器不支持全屏，可使用窗口最大化。");
  }
};
$$("[data-workspace]").forEach(
  (b) =>
    (b.onclick = () => {
      $$("[data-workspace]").forEach((n) =>
        n.classList.toggle("nav-active", n === b),
      );
      const on = b.dataset.workspace === "points";
      $("#workspace").classList.toggle("points-mode", on);
      if (on) {
        $("#workspace").classList.remove("focus-mode");
        setToggle("#toggle-panels", false);
        if (points.length) selectPoint(selected || points[0].id);
        toast("点击底部点位查看详情；定位针工具可添加新点。");
      }
    }),
);
$("#export-points").onclick = () => {
  const data = {
    version: 1,
    model: modelName,
    orientation: viewer.orientation,
    coordinateSystem: "viewer-world",
    calibrated: false,
    source: currentPreset?.sourceUrl ? "public-real-scene" : "local-model",
    attribution: currentPreset?.sourceUrl || null,
    points,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = "inspection-points.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("已导出点位 JSON；坐标尚未与机器人地图标定。");
};
let dragDepth = 0;
window.addEventListener("dragenter", (e) => {
  if ([...e.dataTransfer.types].includes("Files")) {
    e.preventDefault();
    dragDepth++;
    $("#drop-overlay").hidden = false;
  }
});
window.addEventListener("dragover", (e) => {
  if ([...e.dataTransfer.types].includes("Files")) e.preventDefault();
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $("#drop-overlay").hidden = true;
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("#drop-overlay").hidden = true;
  const files = [...e.dataTransfer.files];
  if (files.length !== 1) {
    toast("请一次导入一个场景文件。");
    return;
  }
  loadModel(files[0]);
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    setAdding(false);
    $("#workspace").classList.remove("settings-mode", "points-mode");
  }
});
window.addEventListener("pagehide", () => {
  viewer?.dispose();
});
try {
  viewer = new SpatialViewer($("#viewport"), {
    fps: (n) => ($("#fps").textContent = n),
    angle: (a) => ($("#compass-needle").style.transform = `rotate(${-a}rad)`),
    fatal,
    toast,
    point: addPoint,
    pickStatus: (busy) => {
      if (busy) toast("正在定位模型表面…");
    },
  });
  await loadPreset("garden");
} catch (error) {
  fatal("需要支持 WebGL 2 的浏览器和硬件加速。" + error.message);
}
const context = document.modelContext;
if (context?.registerTool) {
  const lifecycle = new AbortController();
  window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
  const tools = [
    {
      name: "get_scene_state",
      description: "读取已加载场景与点位，不包含本地文件内容。",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => ({
        model: modelName,
        loaded: !!viewer?.current,
        demo: false,
        source: currentPreset?.source || "local-model",
        points: points.map(({ id, name }) => ({ id, name })),
        selected,
      }),
    },
    {
      name: "focus_inspection_point",
      description: "将相机移动到已有巡检点；不会下发机器人任务。",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      execute: ({ id }) => {
        if (typeof id !== "string" || !points.some((p) => p.id === id))
          throw new Error("Unknown inspection point");
        selectPoint(id);
        viewer.focus(id);
        return { selected: id };
      },
    },
  ];
  for (const t of tools) {
    try {
      Promise.resolve(
        context.registerTool(t, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {}
  }
}
