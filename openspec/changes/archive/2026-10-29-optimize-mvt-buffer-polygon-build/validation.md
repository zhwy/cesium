# 验证与交付记录

日期：2026-10-29。实现范围为 Demo 的 Buffer fill，包含成面线；保留旧 fill/line 和引擎代码，未修改生产依赖或执行 Git 写操作。用户已有的阶段计时、benchmark close 视野和 feature-state 工具改动均保留。

## 实现与启动

- 首次解码和目标桶重建独立传递面准备请求，不受 Worker filter 回退影响。相同几何参数在任务内复用，准备结果以连续 TypedArray 和逐面偏移返回，transferable 按底层 buffer 去重。
- 贴地不执行投影、剖分、细分，不分配三角形；非贴地保留原算法及高度。过滤同步压缩几何身份和 featureIndices；无效结果沿用空桶路径。
- 主线程只消费准备结果，集合按实际容量分配。填充共享 manager 每帧 4 ms 软预算，完成前不绘制或标记贴地提交，完成后请求后续帧供 coverage 切换。颜色、显隐、feature-state、取消及 replacement 身份检查覆盖分帧过程。
- 未配置轮廓时不构建额外轮廓位置数组；配置时继续使用旧线图元。共享准备数组在最后消费者完成或取消后释放；驻留面只计已填实例，待填量及缓冲字节独立统计。诊断 reset 保留 Buffer 驻留仪表及共享缓冲引用计数，避免随后销毁时变负。

启动前在仓库根目录执行 `node Apps/Demos/LoadVectorTile/build-worker.mjs`，生成忽略跟踪的 `Build/LoadVectorTile/BufferPolygonMath.js`。该包仅包含四个 Core 数学模块，使用已有 esbuild；没有启用 Buffer 面时不加载。清理 Build 或更新对应 Core 算法后重建。Worker 不继承页面 import map；真实浏览器确认完整 Cesium 构建包不能作为该 Worker 的数学入口，因此使用上述专用数值包。

## Node 与静态验证

针对性测试命令：

```sh
node --test Apps/Demos/LoadVectorTile/test/VectorTileBufferPolygonPreparation.test.js Apps/Demos/LoadVectorTile/test/VectorTileBufferPolygonBucket.test.js Apps/Demos/LoadVectorTile/test/VectorTileBufferPolygonBenchmark.test.js Apps/Demos/LoadVectorTile/test/VectorTileDiagnostics.test.js Apps/Demos/LoadVectorTile/test/VectorTileStyleHotUpdate.test.js Apps/Demos/LoadVectorTile/test/VectorTileFeatureState.test.js Apps/Demos/LoadVectorTile/test/VectorTilePrimitiveBucketState.test.js
```

结果：25 项通过，0 失败。新增验证包括：贴地禁止访问投影/剖分/细分、带洞凹面、非贴地高度和细分、成面线、多片段、空结果、大容量、过滤后几何身份与 feature 映射、共享缓冲计数与 reset、Worker 协议与转移、同帧共享预算、跨帧颜色及 feature-state、取消部分集合、真实 Layer 晚到结果、快速高度切换、只改颜色不重新准备，以及实际四叉树保留父覆盖直至四个子面就绪。

对涉及的运行时及测试文件执行 ESLint 和 Prettier，执行 `git diff --check`。构建脚本及验证脚本显式使用 `--ignore-path .gitignore` 进行格式化，避免仓库默认忽略 `.mjs` 导致漏检。

实际 Node.js 为 v20.19.3，低于 package.json 的 >=22.17.0 要求；上述结果是该实际环境的定向验证，不代表全仓构建或全量测试通过。原 Layer 测试的构建产物 ESM 导入失败，以及 GeometryPlacement/LOD 旧测试调用未公开方法，记录于 `baseline.md`。本次以新增过滤和实际四叉树测试覆盖相关行为，没有为修复旧断言而扩充生产 API。

## 真实浏览器功能验证

Chromium 无头模式，1280×720。初次受限运行无法访问 CDN；允许访问 Demo 依赖后完成以下检查，最终 smoke 和夹具均没有页面或 Worker 错误。

- `validation/browser-check.mjs smoke`：实际数据的贴地和非贴地都拾取到 `res_org_gr` 的同一要素 `8601`；hover 可见红色高亮，`hover=true`，面桶数从 10 到 10，没有几何重建。见 `validation/smoke.json` 和 ground/hover/elevated 三张截图。
- `validation/browser-check.mjs fixture`：在现有 source 调度链中返回固定 MVT，真实经过 PBF 解码 Worker、准备、建桶与渲染；包含一个带洞面和一个独立成面线，启用黑色轮廓。两种模式的三点拾取均为 `["1", null, "2"]`，分别对应外环、洞内和成面线，脚本带断言。已查看两张夹具截图，洞未填充，外环及洞轮廓、三角形均可见。见 `validation/fixture.json` 和 fixture-ground/fixture-elevated 截图。

复查前启动本地 8080 服务并生成数值包，然后运行：

```sh
node openspec/changes/optimize-mvt-buffer-polygon-build/validation/browser-check.mjs smoke
node openspec/changes/optimize-mvt-buffer-polygon-build/validation/browser-check.mjs fixture
```

## 性能基线与限制

测试图层为 `res_org_gr-level2-fill`，同一初始相机和颜色 `#3388ff80`，关闭内存 PBF 复用；贴地高度 0，非贴地高度 10。每轮同时保留原 fill 对照。HEAD 基线由脚本仅替换浏览器的面桶、适配对象和解码 Worker 三个脚本响应复现，不修改工作区；它不包含用户后来加入的阶段计时，也不是完整提交的 A/B。两份结果的 decoded source 瓦片工作量都为 10（level 5 为 3、level 6 为 7）。

下表比较旧同步 Buffer 和本次 Buffer，单位为 ms；最后一列为加载/稳定窗口长任务数量。

| 模式   | 算法             | 加载时间 | 加载帧间隔 p95/最大 | 稳定帧间隔 p95/最大 | 长任务数 |
| ------ | ---------------- | -------: | ------------------: | ------------------: | -------: |
| 贴地   | HEAD 同步 Buffer |   2772.8 |       283.6 / 283.6 |       231.6 / 231.6 |   18 / 8 |
| 贴地   | Worker + 分帧    |   2788.9 |       415.9 / 415.9 |       288.3 / 288.3 |   17 / 7 |
| 非贴地 | HEAD 同步 Buffer |   1864.7 |       145.8 / 145.8 |       121.3 / 121.3 |  19 / 14 |
| 非贴地 | Worker + 分帧    |   1854.2 |       153.5 / 153.5 |       138.8 / 138.8 |  17 / 13 |

**本次单轮采样未显示帧间隔改善，不能声称整体帧率提升。** 旧同步 build 的平均值为贴地 5.39、非贴地 6.76，新主线程建桶为 1.49、1.32，但计算迁移到 Worker 后平均准备耗时为 4.15、9.09；新 add 和 ready 单独计量。不能将同步 build 的下降等同于总计算量下降。

旧路径立即填充全部 820 个缓存面；新路径已填 421 个、仍有 399 个未被选中预热的缓存祖先面。因此这些数值不能作为同等完整构建工作量的 CPU 对比。可见覆盖仍按相同四叉树规则提交，待填缓存量在输出中明确列出。最终新路径未释放的准备缓冲为贴地 610983、非贴地 782151 字节，对应这些待填缓存；已消费数据及取消资源释放由定向测试验证。贴地集合 CPU 容量由 1231500 变为 1000728 字节，非贴地为 1231536 与 1231500 字节。

原始数据保存在 `validation/baseline.json` 和 `validation/optimized.json`，包含 load/steady 的完整长任务耗时、命令数、往返及阶段统计。heapDeltaBytes 返回 0，不能据此声称零临时内存或给出峰值堆内存结论；本次没有采集可比较的堆峰值。无头浏览器的帧间隔整体偏高，样本数量少，HTTP 缓存及场景底图也会影响结果。未采集 GPU 时间线和贴地烘焙结束标记，不能对剩余长帧做确定归因。

4 ms 是完整处理一个面后检查的软预算；大面 add、集合首次 GPU 资源创建/上传以及地表打包和烘焙仍可能形成尖峰。真实贴地纹理烘焙完成度不由 ready 承诺。后续性能评估应使用目标设备重复采样，并同时记录可见与缓存工作量、内存峰值及上传/烘焙阶段。

## 新增函数与调用自检

以下为生产调用点数量，不含测试：

| 新增方法                                 | 调用点 | 保留依据                               |
| ---------------------------------------- | -----: | -------------------------------------- |
| Geometry.getParameters                   |      2 | 请求和桶消费统一几何参数               |
| Geometry.createRequests                  |      2 | 首次加载与目标桶重建复用               |
| Geometry.prepareGeometry                 |      1 | 独立数值测试，且实现超过 60 行         |
| Geometry.prepareLayer                    |      1 | 独立 Worker/几何测试，且实现超过 60 行 |
| Geometry.pack                            |      2 | 准备与过滤压缩复用                     |
| Geometry.filterGroups                    |      1 | 独立过滤测试，避免继续扩大既有过滤入口 |
| Geometry.getTransferableBuffers          |      2 | Worker 转移和主线程容量统计复用        |
| Diagnostics.retainBufferPolygonGeometry  |      1 | 独立共享缓冲及 reset 测试              |
| Diagnostics.releaseBufferPolygonGeometry |      2 | 完成与取消/销毁清理                    |
| Primitive.filling getter                 |      2 | 即时与延迟 feature-state 更新判断      |

新增颜色求值和有效性检查均以内联稳定回调传入适配对象；没有新增只为命名的单次简单 helper。Worker 的 async task 由既有 createTaskProcessorWorker 持有，属于稳定任务回调。

面桶测试新增的准备入口 helper `createBucket` 调用 18 次，预热 helper `fillBucket` 调用 6 次；夹具构造 `createLayer` 调用 15 次、规则构造 `createRule` 调用 27 次、材质读取 `getMaterial` 调用 10 次。新数值测试的 `createLayer` 多次复用。验证脚本没有额外抽取单次简单函数。
