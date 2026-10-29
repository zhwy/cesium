## Context

本设计承接 `proposal.md`：用户要求直接构建 BufferPolygon，另建 bucket，保留 LoadVectorTile 数据加载和瓦片调度，并通过样式图层的 `useBufferPrimitive` 开关启用。首轮同时验证非贴地、贴地。

当前源码中的接入事实：

- `VectorTileStyleUtils.normalizeLayers()` 和 `VectorTileStyleRule` 显式列举字段，新增字段必须贯通规范化、运行时表示和 `toJSON()`。
- `createVectorTilePrimitiveBucket()` 按 style rule 建桶；`VectorTileLayer._buildTilePrimitives()` 以及 replacement bucket 构建都会经过该入口。
- `VectorTileQuadtreePrimitive` 使用 `show / ready / update(frameState)`，并在隐藏预热期间临时开启 show、丢弃绘制命令。Buffer 集合自身没有 ready 契约。
- `Scene` 的自动贴地扫描只遍历 PrimitiveCollection 中的集合，不会深入自定义 bucket；`VectorProvider.isSupported()` 按 collection.constructor 精确判断支持类型。
- `VectorTilePrimitiveBucket` 的默认颜色、feature-state 更新依赖 GeometryInstance attributes，不能原样套用于 Buffer 图元。
- 示例 `res_org_gr-level2-fill` 包含透明默认填充、outline、hover/选中颜色和 `clampToGround: true`。测试不能以默认全透明作为未渲染的判据。

## Goals / Non-Goals

**Goals:**

- `layers[].useBufferPrimitive === true` 且 `type === "fill"` 时，使用独立新 bucket 直接绘制 BufferPolygon。
- 旧 bucket 文件保持不变，同 source 支持新旧 fill 图层并存。
- 非贴地和贴地均可验证，保持当前过滤、zoom、裁剪、颜色、轮廓、feature-state、拾取和清理行为。
- 通过现有调度框架进行可回退的正确性和性能对比。

**Non-Goals:**

- 本期不新增 line/circle/symbol 的 Buffer 后端；不引入 GLB、Model 或 Cesium3DTileset。
- 不更换 Worker 输出结构、请求 URL、任务调度、LOD/coverage 算法或缓存策略。
- 不重构旧 bucket、提取其私有 helper 或修改引擎 Buffer/VectorProvider 实现；不新增生产依赖。

## Decisions

### 1. 开关属于单条样式图层

`useBufferPrimitive` 与 `type`、`paint` 同级，省略时规范化为 `false`，显式配置只接受 boolean。首期对非 fill 类型保留和序列化该字段，但仍执行原有 bucket 路径；文档明确支持范围。它与 source 的 `renderBackend: instances/packed` 独立，后者继续控制原有线后端。

`getStyle()`、合并/替换样式及运行时 rule 的序列化须保留该值。true/false 切换沿用现有结构样式变化的 `REBUILD_SOURCE` 流程，不在本期额外优化为目标 bucket 切换；规范化后 omitted 与 false 视作同一值。新建、重建、离屏缓存重新提交均须读取最新配置。

替代方案是增加 source 级 renderBackend 值，但它不能表达同源不同 fill 图层分别启用，因此不采用。

### 2. 新 bucket 持有独立渲染适配对象

新增 `VectorTileBufferPolygonBucket.js`，继承现有 VectorTileFillBucket 以复用轮廓构建和基础生命周期，保留登记/销毁所需记录结构，覆盖依赖 GeometryInstance 的 Buffer 颜色更新、feature-state、回退检查和拾取登记路径。所有旧 bucket 文件保持不变。

新增 `VectorTileBufferPolygonPrimitive.js`，内部持有真正的 BufferPolygonCollection，向调度器提供 `show / ready / update / isDestroyed / destroy`。不通过继承 BufferPolygonCollection 增加 ready，避免破坏 VectorProvider 的构造函数匹配。

集合通过有效几何数据准备及必要的初次资源预热后进入 ready；空几何不创建假 primitive，沿用 READY_EMPTY。ready 代表渲染对象准备状态，不宣称贴地纹理已经完成烘焙；测试应覆盖首帧及后续烘焙帧。原有选瓦片与 coverage 决策不变。

### 3. 直接消费当前 packed 几何，保持面语义

使用 packed polygons 的 positions、ringOffsets、polygonOffsets、featureIndices，以及共享 feature table。沿用现有 fill 对 lines 的成面语义：每条满足现有条件的线环进入面构建，不丢弃几何类型 2 的匹配要素；实现放在新 bucket 内，不从旧文件抽取 helper。

清理重复闭合点、排除退化环、建立外环/洞的局部索引，在适合当前面的二维投影中复用 PolygonPipeline.triangulate；不把世界坐标 XYZ 直接当二维坐标剖分。三维 positions 采用瓦片中心局部坐标加 modelMatrix，保持足够精度。预先统计 primitive、vertex、hole、triangle 容量并一次分配，禁止依赖默认 1024 容量或隐式扩容。

非贴地大面复用现有 PolygonPipeline 的椭球细分能力，再将细分三角顶点写入集合；环顶点保持在前，新增细分顶点追加，其 triangle 索引与洞数据保持一致。不能只连接地表稀疏顶点后忽略三角面穿入椭球的问题。贴地沿用环信息进入 VectorProvider，不需要为了地表贴合额外密化环。

构建几何时沿用现有 filter、feature 映射、heightOffset 和 clampToGround 判定。`clampToGround: true` 且存在非零 heightOffset 时，沿用当前非贴地高度偏移路径并保留相应诊断。

### 4. 显式提交贴地集合，隔离隐藏预热

在四叉树实际 committedRenderSet 提交位置，增加可选的渲染对象提交 hook，只对可见对象执行；适配对象在该 hook 中以真正的集合调用 `scene.vectorProvider.markForFrame(collection, frameNumber, HeightReference.CLAMP_TO_GROUND)`，保持当前贴地同时面向地形/3D Tiles 的语义。

`update(frameState)` 负责普通渲染和必要准备，不在其中无条件 mark；现有 warmUpPrimitive 和 replacement 预热继续调用 update 时，不会注册未选中的集合。已隐藏或未选中的集合按 VectorProvider 帧标记机制退出，销毁时在释放缓冲前主动 remove。

若运行环境缺少 vectorProvider，不能静默退化成普通面并宣称贴地成功；通过现有错误事件/诊断说明所需场景能力缺失。无需让原有 bucket 实现提交 hook。

### 5. 面材质使用 Buffer，轮廓首期保留线机制

填充逐要素求值并写入 BufferPolygonMaterial。非贴地集合先统一使用支持透明度的混合模式，覆盖从全透明到 hover/选中颜色的更新；不把 alpha 为零的要素从集合中剔除。首期不为不透明面额外分组优化。

新 bucket 内的轮廓继续用现有 PolylineGeometry/GroundPolylineGeometry 和 Primitive/GroundPolylinePrimitive 创建机制，复用现有 utils 的颜色、边界裁剪及工厂接口。保留 `fill-outline-color`、`fill-outline-width`、洞边界和 feature 映射；不把 BufferPolygonMaterial 声明的 outline 字段直接当作现有两个渲染分支均已验证支持的依据。没有配置 outline 时不创建轮廓。

面、轮廓颜色分别处理，feature-state 通过紧凑的 featureIndex → 渲染片段映射更新。依赖属性缺失时沿用目标 bucket 重建；保留最新 style revision、离屏惰性更新和显隐语义。不调用旧 bucket 的 GeometryInstance attributes 更新逻辑来更新 Buffer 面。

### 6. 复用紧凑拾取身份和生命周期

Buffer 图元的 pickObject 只保存所属集合/渲染对象身份与紧凑局部 id，通过 VectorTilePickRegistry 增加必要登记适配，继续解析到原有 feature table。不得在每个面复制完整 properties，`pickProperties`、promoteId、source/layer/tile 信息及 manager API 返回结构保持一致。一个要素拆成多个面片时均指回同一记录。

allowPicking=false 时跳过相关登记与身份分配。bucket 替换和销毁须同时清理面、轮廓及贴地注册；释放计数不得重复扣减，旧拾取结果不得解析为新 bucket。新增 diagnostics 记录实际 Buffer bucket、面和缓冲容量字节，CPU buffer 与贴地/GPU 资源的统计边界分别说明，不将 wrapper 数量误称为 DrawCommand 数量。

### 7. 验证与对比限定为同一调度链

实现阶段在用户指定的 `res_org_gr-level2-fill` 上启用开关，经用户确认将该层 maxzoom 从 5 调整到 6，使其与 source.minimumLevel=5 有可构建交集；其余配置保持原值。补充非贴地测试配置，通过 feature-state API 设置 hover/选中状态或临时使用可见常量色检查完全透明默认色场景。当前 `BufferPolygonMaterialFS.glsl` 对 alpha 小于 0.005 的片元执行 discard；不承诺完全透明面可直接通过鼠标命中来触发 hover。实际拾取以可见面/轮廓验证，并记录与原路径透明拾取行为的差异。

在现有 benchmark 工具中增加面专用入口，通过样式图层开关分别运行旧面与 Buffer 面，不改写旧 instances/packed 线对比或 vector glTF 对比。运行时切换通过 setLayerStyle 保持 source 对象存活，避免整体 setStyle 先销毁 source 后释放四叉树引用；等待稳定窗口增加独立定时器，即使渲染停止也能超时返回。固定相机、样式和相同填充图层集合，区分冷/热缓存；记录瓦片层级/数量、实际 Buffer 激活与提交计数、面构建耗时、帧 CPU p95、command 数和缓冲字节。贴地冷启动单独统计烘焙时间，不能与稳定帧混为性能收益。

## Risks / Trade-offs

- [非贴地大面三角面穿入椭球] → 纳入椭球细分和远近景样例；未验证前不宣称与旧几何等价。
- [贴地 mark 时序或隐藏预热导致重复覆盖] → 显式 committed 提交 hook，mock 验证注册帧和身份，浏览器验证首帧/LOD 切换。
- [渲染对象 ready 被误当作贴地烘焙完成] → 分离准备状态与视觉完成指标，验证低层级切换和纹理更新。
- [旧桶依赖实例属性，继承后误用] → 新 bucket 显式覆盖相关更新/映射路径；回归原 bucket 文件未变及旧路径行为。
- [轮廓仍使用线图元限制整体性能收益] → 分别报告 fill 与 outline 成本，本期不扩大为 BufferPolyline。
- [透明片元被着色器丢弃，无法仅靠透明面触发 hover] → 用 feature-state API 验证透明到显色的更新，用可见配色验证拾取；透明拾取差异明确报告，不用隐藏的旧面图元伪造 Buffer 验证结果。
- [同源切换开关会触发现有 source 重建] → 文档明确是结构切换成本；不把它计入颜色原地更新结果。
- [引擎 ESM、Worker 或 WebGL 环境限制验证] → 实施时先记录基线，区分纯数据/接口测试与真实渲染；报告既有失败和未完成的浏览器验证，不把网络成功视为出图成功。

## Migration Plan

1. 增加字段贯通与配置测试，默认走原路径。
2. 新增 bucket 和渲染对象，再接入工厂、提交 hook、拾取与必要诊断。
3. 完成数据/生命周期测试后，在 Demo 指定图层启用，分别验证贴地和非贴地。
4. 运行同调度面专用对比并记录边界，更新 STYLE.md/README.md。
5. 回退时把该图层 useBufferPrimitive 设为 false 或移除，经原有结构重建返回旧 bucket；不修改源数据、URL 或调度配置。

## Open Questions

用户在实施期间明确接管剩余浏览器验证，要求在 index.html 完善手动验证方法。已增加原生 HTML 面板，包含定位、逐 fill 后端/贴地/高度/配色切换、隔离、ID 状态、清缓存、对比和还原；显示样式缩放及实际提交。该面板只进行本地静态检查，剩余浏览器验收保留在任务 5.4，具体证据与边界见 validation.md。

无阻塞需求问题。真实贴地烘焙时序、重叠面顺序及低层级几何细分成本属于实现阶段必须验证的技术事项，不作为已通过结论。
