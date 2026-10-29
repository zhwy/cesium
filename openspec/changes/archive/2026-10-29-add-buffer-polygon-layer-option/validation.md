# BufferPolygon 实施与验证记录

## 范围和人工验收边界

已实现图层级 useBufferPrimitive、独立 Buffer 面桶、贴地提交、样式/状态/拾取、同调度面后端对比和 HTML 手动验证面板。旧 bucket 文件未修改，没有 git commit/push 等写操作。

用户确认将 res_org_gr-level2-fill 的 maxzoom 从 5 改为 6，解决 source.minimumLevel=5 与排他上界 maxzoom=5 没有交集的问题。

用户随后明确“剩下的验证我可以自己做，在html中完善验证方法即可”。因此新增 HTML 面板仅完成源码、格式和 lint 检查，不继续自动浏览器操作；完整 LOD 往返、长时间清缓存/切换、复杂重叠顺序、起伏地形和 3D Tiles 贴合等剩余人工验收由用户执行。任务 5.4 保留未勾选，不能将已完成的局部验证解释为全部通过。

## 本地检查

- 新增的两个测试文件共 10 项通过：开关类型/往返/路由/结构更新、洞/细分/容量、普通准备/贴地提交分离、空面/成面线、材质及 feature-state、紧凑拾取/销毁、四叉树提交 hook、outline/高度回退，以及 benchmark 配置恢复和停止渲染超时。
- 与旧 fill、几何工具、拾取、feature-state 和热更新测试合跑，共 15 项通过。
- 所有修改的 JS、两个新测试和 index.html 的 ESLint/Prettier 检查通过。提案阶段 OpenSpec 严格校验通过；实施结束时当前 shell 无法找到 openspec 命令，未重跑最终严格校验。
- 旧桶保护范围经 git diff 核对：VectorTileFillBucket、VectorTilePrimitiveBucket、VectorTileLineBucket、VectorTileCircleBucket、VectorTileSymbolBucket 均无改动。

以下既有测试失败未在本次变更中修复：

| 文件 | 失败原因 |
| --- | --- |
| VectorTileStyle.test.js | 第 321 行断言的诊断字段不存在；同样错误在修改前基线中已出现 |
| VectorTileQuadtreePrimitive.test.js | 引入 Build/CesiumUnminified/index.js 时发生 CommonJS/ESM 的 import.meta 错误；修改前基线已出现 |
| VectorTileGeometryPlacement.test.js | 第 33 行调用不存在的 getStyleRuleGeometryTypes；该测试及对应模块在本次变更中均未修改 |

## 已完成的浏览器局部验证

用户接管剩余验收前，使用 Chromium/WebGL 和本地测试服务器完成：

- 合成带洞面在普通/贴地模式下出图、GPU 拾取、变色、隐藏及贴地注册退出，渲染错误为空。
- 完整 Demo 成功加载业务 PBF 并进入新 bucket；隔离可见测试层后，实际拾取解析为 res_org_gr-level2-fill。
- 对已拾取的业务 ID 通过 feature-state API 验证 49 个 Buffer 面片的 alpha 从 0 → 1 → 0，下载和建桶计数未增加；填充/轮廓状态更新共计 476 次。
- 页面出现一项现有 Rectangle 从 engine 迁移到 core 的弃用警告，最终浏览器运行没有渲染错误。

首次尝试对比时使用整体 setStyle，触发旧 source 销毁后四叉树引用释放错误。新增对比入口已改为 setLayerStyle，复验未再出现；等待稳定逻辑增加独立超时，渲染停止也能返回。

早期样式缩放约 6.46 的采样虽然已建桶，但目标层 maxzoom=6 导致面隐藏，该数据作废。新增 bufferPolygonSubmissions 并将实际提交为零列为不可比条件；以下仅记录在约 5.44 有效缩放窗口中重新采集的结果。

## 一次性业务采样

两种模式各自使用相同相机、指定 fill 图层和可见颜色，内存 PBF 缓存清空；浏览器 HTTP 缓存未强制清空。加载稳定后采样约 1.2 秒，仅用于确认入口和数据链路，不作为稳定性能结论。旧面与 Buffer 两边解码瓦片均为 10 个：level 5 为 3 个、level 6 为 7 个。

| 指标 | 贴地旧面 | 贴地 Buffer | 非贴地旧面 | 非贴地 Buffer |
| --- | --- | --- | --- | --- |
| 加载稳定窗口 ms | 1262.0 | 320.2 | 144.7 | 234.0 |
| 稳定帧 CPU p95 ms | 3.8 | 4.8 | 2.4 | 2.1 |
| 平均 command 数 | 95.0 | 26.86 | 26.78 | 27.0 |
| 实际 Buffer 提交次数 | — | 516 | — | 533 |
| 驻留 Buffer 面数 | — | 820 | — | 820 |
| CPU 缓冲容量字节 | — | 1231530 | — | 1231566 |
| Buffer 建桶平均 / p95 ms | — | 9.55 / 39.4 | — | 6.18 / 22.7 |

贴地初次烘焙包含在加载窗口；settled 表示队列和帧窗口稳定，不单独证明地表烘焙全部结束。首轮轮廓仍由旧线图元承担，上表同时受轮廓成本影响；CPU 缓冲容量不等于总 GPU/贴地缓存内存。HTML 面板是此后添加的，以上数字不声称包含新面板的运行开销。

## HTML 手动验证顺序

1. 在 index.html 右上角展开“BufferPolygon 手动验证”，选择目标 fill，点击“定位有效视野”，确认样式缩放处于显示区间。
2. 勾选隔离测试层，使用可见测试色，应用 Buffer/原有面及贴地/非贴地配置；普通面可设置高度。
3. 移动鼠标、点击面检查 hover/selected 与拾取属性。ID 自动填入面板，数字/字符串类型按拾取结果保持。
4. 应用透明模式，输入或保留 ID，点击“选中 ID / 悬停 ID / 清除 ID 状态”，观察显色及计数。透明片元被丢弃时，不要求其能直接鼠标命中。
5. 平移缩放检查祖先回退、子瓦片接管、显隐和重叠；清缓存后检查重新加载和残留面。
6. 使用“对比原有面 / Buffer 面”，结果在面板和 window._bufferPolygonComparison。仅建桶但没有实际提交时 comparable 应为 false。对比期间禁用相机输入和面板操作，结束后恢复。
7. 使用“还原配置”回到页面初始图层配置；source 的 instances/packed 控制与本面板的 fill 开关独立。

## 新增函数自检

没有新增仅为命名单行表达式的 helper。统计按生产调用入口计算，框架的动态派发及独立行为测试另列，内联回调不另抽取。

| 函数/方法 | 调用入口与保留理由 |
| --- | --- |
| BufferPolygonBucket constructor / build | 工厂各 1 个动态入口；独立新类及工厂/几何行为测试，build 超过 60 行 |
| _prepareGeometry | build 1 处；内联会使 build 明显超过 60 行并增加嵌套，几何行为有专项测试 |
| getStyleUpdateFallback | runtime layer 回退检查及基础 applyStyle 动态派发，至少 2 个入口 |
| applyStyle | runtime layer/待处理更新及独立测试，至少 2 个入口 |
| _indexFeatureStateBindings | addPrimitive 与重建 bindings，2 个入口 |
| _applyFeatureStateBinding | 即时状态更新与待处理状态更新，2 个入口 |
| BufferPolygonPrimitive constructor | bucket 1 处；生命周期与贴地适配对象，由专项行为测试覆盖 |
| update | 四叉树正常提交、隐藏预热及 replacement 预热，至少 3 个入口 |
| submitForFrame | 四叉树实际提交 1 处；必须与 update 分离以免预热误注册，有独立提交/显隐测试 |
| setColor | applyStyle 与 feature-state binding，2 处 |
| isDestroyed / destroy | 桶资源释放、测试及场景生命周期，至少 2 个入口 |
| compareBufferPolygons | HTML 按钮、控制台及专项测试，至少 2 个入口 |
| waitUntilSettled.finish | 达成稳定和独立超时，2 处 |
| 测试 createLayer / createRule / getMaterial | 均被多个测试调用，至少 2 处 |
| HTML 新增事件回调 | 均直接内联在事件注册处，无额外顶层 helper；用于浏览器事件的稳定回调 |
