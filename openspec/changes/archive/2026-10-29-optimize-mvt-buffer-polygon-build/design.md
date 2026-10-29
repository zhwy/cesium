## Context

当前解码 Worker 返回经纬度 packed 数据，`VectorTileBufferPolygonBucket.build()` 在主线程清理环、转换 Cartesian3、投影、剖分和构建轮廓中间数组，再同步填充集合。`VectorTileTaskScheduler` 的 Promise 排队不提供按帧让出主线程的能力。

贴地填充由 `VectorProvider` 读取环及 holes 后生成地表查询纹理，不读取面三角形；非贴地填充仍需要三角形及现有椭球细分。首次加载和目标 bucket 重建都会调用现有解码 Worker。过滤不受 Worker 支持时，主线程会过滤并压缩 packed 数据及 feature table，新增准备数据必须参与相同映射处理。

现有四叉树通过图元 `ready`、隐藏预热和 coverage 保留祖先或旧 bucket。本次沿用这些规则，在面对象内部推进集合填充。

## Goals / Non-Goals

**Goals:**

- 贴地面不执行投影、剖分或分配三角索引。
- 正常运行时的面几何准备在 Worker 完成，主线程只处理样式、集合填充和现有渲染生命周期。
- 复用同一任务内相同几何参数的计算结果，限制主线程集合填充的连续耗时。
- 保持有效环、洞、成面线、过滤、拾取、feature-state、非贴地曲率和异步版本隔离。

**Non-Goals:**

- 不迁移线图层、轮廓线几何或 packed line，不引入 BufferPolyline。
- 不修改旧 fill bucket、引擎 VectorPipeline、服务端切片格式及四叉树 coverage 算法。
- 不将 Scene、WebGL Context、材质或拾取对象传到 Worker，不经过 Vector glTF 中间层。
- 不新增跨瓦片全局几何缓存或公开调度配置，不以扩大缓存、降低 LOD 或少画要素换取性能。

## Decisions

### 1. 在现有解码 Worker 内准备面几何

首次加载和目标 bucket 重建向 `VectorTileDecoder.decode()` 传递独立的可序列化面准备请求，内容仅包含 sourceLayer、实际贴地模式及高度等几何参数。这份请求与用于 Worker 预过滤的 `styleRules` 分离；不支持 Worker 的 filter 不能导致面准备请求丢失。

Worker 在完成当前解码与裁剪后调用纯数值面准备模块，处理 polygon 环以及旧 fill 支持的成面线。沿用现有 Core 数学实现和几何算法，新增模块须能在测试中独立验证；不直接搬运 bucket 或渲染类到 Worker。

准备结果不包含颜色、动态 feature-state 或渲染对象。主线程继续按最新样式和 feature table 筛选实例、求值材质并登记拾取。没有启用 Buffer 面的任务不生成准备结果。

实现验证确认 Worker 不继承页面 import map，完整 `Build/CesiumUnminified/index.js` 在 Worker 中还会触发 `global is not defined`。因此使用 Demo 的 `build-worker.mjs` 和既有 esbuild 只打包四个 Core 数学模块，输出 `Build/LoadVectorTile/BufferPolygonMath.js`，由现有解码 Worker 按需加载。纯数值模块通过入口注入数学实现，Node 测试使用同一套 Core 源码；启动前构建命令及 Build 清理后的重建要求记录在 README。

选择这个接入点可以避免第二次主线程到 Worker 的 packed 数据复制，目标 bucket 重建也能复用同一入口。保留“主线程 Worker 失败后同步剖分”的备选会隐藏性能退化，因此正常运行时缺少所需准备数据应明确失败，不能静默执行旧算法。

### 2. 使用按几何参数分组的连续 TypedArray

每个 sourceLayer 的准备结果按实际几何模式及高度分组，包含共享局部原点、连续三维 positions、逐面顶点偏移、holes 及其逐面偏移、可选 triangles 及其逐面偏移、输入几何类型与索引、featureIndices。环顺序与顶点索引须具有明确对应关系。

同一任务内，同一候选输入在相同实际贴地模式和高度下仅计算一次，不按样式 layer 复制几何。不同过滤条件和颜色通过实例映射消费这份结果。共享只覆盖本次任务及其消费阶段，不引入无界缓存。

Worker transferable 列表按底层 ArrayBuffer 去重，包含所有新增数组。保留原始 packed 数据供原有 fill、line、symbol 及现有轮廓机制使用，不能为准备面而 detach 主线程后续需要的数据。返回主线程后的准备数组只读使用，待所有消费方完成后释放，诊断中按底层 buffer 去重统计字节。

主线程过滤回退压缩 feature table 或 packed 几何时，必须同时筛选并重映射准备结果。通过原始几何身份和 feature 映射关联，不能依赖压缩前后的数组序号恰好一致。

### 3. 贴地和非贴地分别处理

贴地路径只进行去重、闭合点处理、有限值及退化环校验、Cartesian3 转换和局部坐标写入。保留 holes，不建立切平面，不调用 triangulate，不调用 computeSubdivision，集合 `triangleCountMax` 为零。

非贴地路径把当前切平面投影、triangulate、computeSubdivision 和 scaleToGeodeticHeight 原样迁入 Worker，保持算法与曲率语义。首轮不改用瓦片二维平面剖分，不降低细分精度。非零 heightOffset 的原有非贴地回退规则必须在生成请求时规范化。

主线程集合容量由实际有效面和顶点等数量计算。没有有效输入时继续走 READY_EMPTY，不创建永远无法 ready 的空占位集合。

### 4. 在面对象中分帧填充集合

面 bucket 创建容量已知但尚未填完的集合和渲染适配对象，保存只读准备数据及实例映射。适配对象通过既有隐藏预热 `update()` 分批调用 `collection.add()`，复用 scratch BufferPolygon 和材质；全部填充前不得直接绘制或向 vectorProvider 标记。

同一 manager 的面填充共享内部每帧 4 ms 软预算，按 frameNumber 重置，不新增用户配置。每个有预算的帧至少推进一个面，处理完整个面后检查预算；同一帧重复 update 或 pick 不获得新的预算。跨帧推进使用现有预热/更新链，并在尚有待处理工作时请求下一帧，不能用连续 Promise 微任务模拟让出绘制机会。

ready 仅在集合填充完成、必要的集合初始化完成且现有轮廓就绪条件满足后生效；四叉树继续显示祖先或旧 replacement，不改变 coverage 规则。贴地纹理是否已烘焙完成仍不由 ready 承诺。

单个超大面的 add、集合首次 GPU 资源创建及贴地打包仍可能超过软预算；本轮不声称消除所有长帧。使用帧间隔和长任务确认剩余瓶颈，避免只报告同步建桶耗时下降。

### 5. 保留异步期间的最新样式与资源生命周期

正在填充的面对象保留最新颜色/显隐版本。已填实例按现有方法更新，尚未填入的实例在 add 时使用最新值；首次实际显示前再次同步 feature-state，不能访问尚不存在的 collection 条目。

初始加载和 replacement 的 Worker 返回、分帧填充及最终提交均受现有 content revision、style revision、rebuild identity 和 released/cancelled 检查保护。取消不要求中断已运行的 Worker 数值循环，但过期结果不得创建、提交或替换当前资源。中途销毁须停止推进、释放准备数组、销毁部分集合并准确回退计数。

### 6. 轮廓与诊断保持聚焦

配置了 fill-outline-color 的面继续交给当前线 Primitive/GroundPolylinePrimitive；清理后的环身份和洞边界必须与原语义一致。未配置 outline 时，不再额外生成面桶的轮廓位置数组。本次不迁移轮廓线计算，也不变更透明轮廓是否创建的现有语义。

诊断分别记录 Worker 面准备、主线程分批填充的实际 CPU 片段、从开始到 ready 的墙钟时长、待填充数以及准备数组字节，新增/释放时准确结算。Worker 内时长作为数值返回，不能用不同线程的计时起点直接相减。`workerDecodeRoundTrip` 包含准备及排队，因此保留并解释其口径；benchmark 继续记录 load/steady 的 frameInterval 和 longTasks，不增加大型页面面板。

## Risks / Trade-offs

- [Worker 准备增加解码阶段总耗时及中间内存] → 只准备启用 Buffer 的 fill 所需几何组，任务内复用，转移 buffer，消费完成立即释放；分别报告总加载时长和帧间隔。
- [主线程过滤回退导致 featureIndices 错位] → 对准备 payload 执行相同筛选与映射，并使用带洞、多片段、成面线及多个过滤条件的测试验证。
- [分帧导致部分面提前出图或缺少新样式] → 全部填充前保持 not-ready，继续旧覆盖，首次提交前同步最新样式。
- [单面及 GPU 上传仍可形成尖峰] → 明确软预算边界，测量长任务，不把分帧视作 GPU 分块上传能力。
- [源码 Worker 导入方式与构建产物不一致] → 使用当前工程可运行的 Worker 依赖入口，并做真实浏览器 Worker smoke 验证，不能只用 Node 测试代替。
- [增加函数或状态过多] → 保持模块边界直接，只为独立测试和实际复用抽取数值函数，不新增通用任务框架；遵循本仓库函数粒度约定。

## Migration Plan

1. 记录现有面相关测试和相同视野的性能基线。
2. 完成纯数值准备和 Worker 协议，再接入面桶及分帧生命周期。
3. 验证贴地/非贴地、洞、成面线、样式热更新、取消与 LOD。
4. 沿用 useBufferPrimitive 开关及既有对比入口回退旧 fill；其他后端接口保持兼容。

## Open Questions

无阻塞实现的需求问题。内部 4 ms 软预算作为首轮默认值，只有实际性能证据表明需要调整时再修改；不承诺固定百分比的性能提升。
