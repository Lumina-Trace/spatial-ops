# 巡境 · Spatial Ops

3D Gaussian Splatting 实景查看、巡检点位标记与 3DGS / 导航点云双地图标定平台。

当前版本包含 Apple 毛玻璃界面、WASD 自由漫游、后台点云去噪和表面优先选点。所有地图在本地浏览器处理。

## 启动

需要 Node.js 22.12 或更新版本。

```sh
cd platform
npm ci
npm run build
npm run assets:demo  # 可选：下载公开 Garden 实景示例；也可直接导入自己的模型
npm run dev
```

- 巡检平台：<http://127.0.0.1:5273/>
- 双地图标定：<http://127.0.0.1:5273/calibration.html>
- 同一局域网内可通过运行电脑的 IP 和端口 `5273` 访问。

首次进入时默认示例需要先下载；没有下载时，可通过「导入 3DGS」加载自己的实景模型。

## 验证

```sh
cd platform
npm run check
npm test
npm run build
```

详细功能、文件格式与使用限制见 [平台说明](platform/README.md)，示例模型来源见 [资产来源](platform/ASSET_SOURCES.md)。仓库不包含公司地图、采集文件、测试模型或第三方示例模型；依赖与渲染引擎由安装和构建步骤生成。
