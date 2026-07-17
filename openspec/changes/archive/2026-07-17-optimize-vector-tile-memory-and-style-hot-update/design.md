## Context

LoadVectorTile 当前把一个 source 映射为一个 `VectorTileLayer`，每个 VectorTile 在 Worker 中解码 PBF 后，为 source 下所有可见样式规则创建 bucket。`setLayerStyle()` 最终调用 runtime layer 的 `setStyle()`，后者推进 `contentRevision`、清空整个 source 的渲染缓存并让四叉树重新绑定。PBF 内存缓存已经把重复网络请求与样式内容代分离，但颜色或显隐更新仍会产生工作副本、Worker 输出、新旧 Primitive 和完整 metadata 的短时并存。

当前 packed layer 的 `points/lines/polygons.metadata` 保存 `{ id, properties }` 对象，bucket 又为每个 GeometryInstance 或点对象创建 `{ ...metadata, layerId }`。Cesium `releaseGeometryInstances: true` 会释放输入 GeometryInstance，却仍在 Primitive 内部保留 instance id；因此完整 properties 会被渲染资源间接长期引用。渲染缓存的 `cacheBytes` 只是 decoded typed array 的估算值，而且每个 source 各有一份预算。

本 change 同时触及 Worker 数据模型、bucket 输出、拾取 API、样式更新、共享点集合、四叉树提交和缓存诊断。约束是继续使用现有 Cesium Primitive、GeometryInstance attribute、Billboard/Label 和 manager 级 PBF cache，不新增生产依赖、不保留 GeometryInstance 引用，也不通过自定义 shader 解决颜色更新。

## Goals / Non-Goals

**Goals:**

- 把长期拾取状态压缩为数字 instance id、共享 feature table 和必要属性投影，并提供同步稳定的 manager 拾取解析 API。
- `pickProperties` 未配置时保持全部拾取属性；显式配置时允许调用方用字段投影换取内存收益。
- 初始只构建当前 VectorTile level 真正需要的样式桶，降低多 zoom style layer 的稳定驻留。
- 降低 Demo 的离屏 surface tile 和单 source 渲染缓存预算，同时保持当前可见与 LOD fallback 资源安全。
- 对支持的颜色和图层显隐更新现有渲染资源，不推进整个 source 内容代；缺少属性、render state 不兼容或 bucket 不存在时只重建目标 bucket。
- 为拾取属性、style bucket、离屏瓦片和热更新路径增加可验证诊断。

**Non-Goals:**

- 不在拾取时解析 PBF、异步查询完整属性或引入 IndexedDB。
- 不实现逐要素 `feature-state`、动态 filter show mask、高亮 overlay 或任意属性编辑。
- 不原地修改线宽、几何高度、filter、source-layer、symbol 布局或其他会改变几何和放置的样式。
- 不修改 Cesium engine 的 Primitive 实现，不精确限制浏览器进程总内存。
- 不改变 `VectorTileLayerManager`、`VectorTileLayer` 和 source `cacheBytes` 的公共默认值；只调整 Demo 显式配置。

## Decisions

### 1. packed layer 使用共享 feature table 和 typed feature index

每个 decoded source-layer 新增 `features` 表，表项至少包含：

```js
{
  id,                  // PBF feature.id，可能为空
  sourceFeatureIndex,  // source-layer 中的原始序号
  properties,          // 投影后的属性对象
}
```

`points/lines/polygons.metadata` 改为 `featureIndices: Uint32Array`。一个 feature 被裁剪为多个线段、polygon 或多个放置点时，多个几何条目引用同一个 feature table index。主线程样式求值通过 packed layer helper 取得 feature 表项，不为每次求值复制 metadata wrapper。

备选方案是保留 metadata 对象数组，只把 GeometryInstance id 换成数字。该方案仍让同一 feature 的属性图在多个几何数组和样式桶间更容易被重复引用，也无法准确统计驻留 feature，因此不采用。

### 2. 属性依赖在调度 Worker 前静态收集

新增样式属性依赖收集器，遍历参与当前 build 的 filter、paint 和 layout：

- `['get', 'name']`、`['has', 'name']` 收集字面量字段名；
- `literal` 内容不作为表达式继续遍历；
- 属性名自身为表达式或出现无法静态判断的结构时，将投影标记为 `all`；
- Worker 始终可以用 PBF feature 的原始完整 properties 求 filter，只有返回主线程前才执行投影。

source 拾取配置与样式依赖合并，但公开和内部字段集合分开记录：

| 条件 | Worker 返回属性 | `resolvePickedFeature()` 公开属性 |
|---|---|---|
| `allowPicking: false` | 仅样式依赖 | 不注册拾取 |
| picking 开启，`pickProperties` 未配置 | 全部 | 全部 |
| `pickProperties: [a, b]` | 样式依赖与 a/b 的并集 | 仅 a/b |
| `pickProperties: []` | 仅样式依赖 | 空对象 |

`normalizeSources()` 校验 `pickProperties` 只能是未定义或无重复非空字符串数组。未配置默认全部是明确的兼容选择；它不会自动获得最小内存，README 和 Demo 会展示如何显式配置。

备选方案是在每次 pick 时读取 PBF master 并解析属性。它会让同步 `scene.pick()` 处理变成异步，还可能在 PBF LRU 淘汰后产生网络请求，因此本阶段不采用。

### 3. 数字 instance id 与 manager 级弱拾取注册表分离渲染和公开结果

line/fill instances 使用 Primitive 内从 `0` 开始的数字 id；bucket 构建结果为每个 Primitive 保存 `instanceFeatureIndices` 和角色（例如 `fill`、`fill-outline`、`line`）。数字 id 同时供 `getGeometryInstanceAttributes(id)` 使用，因此热更新不需要保留 GeometryInstance 或额外 id 对象数组。

新增 manager 持有的拾取注册表：

```text
WeakMap<Primitive|Billboard|Label, PickContext>
PickContext
├─ VectorTile / feature table 定位
├─ sourceId / sourceLayer / styleLayerId
└─ instanceId → featureIndex
```

Geometry Primitive 以 `picked.primitive + picked.id` 定位；共享点集合在 `add()` 得到 Billboard/Label handle 后注册 handle 上下文。VectorTile 和 bucket 仍持有可枚举的更新记录，WeakMap 只负责公开 picked 对象解析，避免注册表阻止已销毁对象回收。

`manager.resolvePickedFeature(picked)` 同步返回新对象，并按公开 pick 字段复制一层 properties，防止调用方修改内部 feature table。非本 manager 对象或已失效上下文返回 `undefined`。

这是有意的 API 迁移：`picked.id.properties` 不再受支持。用紧凑 token 模拟旧 `id.properties` getter 仍需每实例对象并会掩盖生命周期错误，因此不采用。

### 4. bucket 记录显式保存角色、样式版本和更新索引

现有 `vectorTile.primitives[layerId] = Primitive[]` 扩展为可描述更新目标的 bucket state，概念结构为：

```js
{
  layerId,
  buildZoom,
  bucketRevision,
  appliedStyleRevision,
  primitiveRecords: [{ primitive, role, instanceFeatureIndices }],
  pointDescriptors,
  pendingReplacement,
}
```

具体实现可以继续为兼容保留现有 map，但角色和 feature index MUST 与 Primitive 一一对应。fill 本体和 outline 必须使用不同 role，避免热更新写错颜色；packed line 使用 `packed-line` role，不保存逐 feature index。

VectorTile 销毁、bucket 替换和点条目移除统一通过 bucket state 清理诊断和拾取上下文。此状态不保存 decoded geometry 或 GeometryInstance。

### 5. setLayerStyle 通过更新计划选择 no-op、in-place、bucket rebuild 或 source rebuild

manager 合并并规范化目标 layer 后生成 `StyleLayerUpdatePlan`：

```text
NO_OP
IN_PLACE_APPEARANCE
REBUILD_BUCKET
REBUILD_SOURCE
```

- 规范化结果完全相同：`NO_OP`。
- 只改变受支持颜色或顶层 visibility：优先 `IN_PLACE_APPEARANCE`。
- 颜色表达式新增未驻留依赖、透明状态与当前 Appearance 不兼容、从未构建的 layer 被显示：`REBUILD_BUCKET`。
- filter、source/source-layer、type、线宽、高度、布局或其他结构字段：本阶段继续 `REBUILD_SOURCE`。

runtime layer 为每个 style layer 维护独立 `styleRevision` 和最新规则。原地更新只更新 style document/revision 并请求下一帧渲染，不调用 `VectorTileLayer.clearCache()` 或 `invalidateAllTiles()`。现有 `changedEvent` 继续表示需要四叉树内容失效；新增轻量 appearance/style event 或直接 `scene.requestRender()`，避免复用会全量失效的事件。

备选方案是所有非颜色字段也立即实现 bucket 局部替换。它会显著扩大首期测试矩阵，尤其是 filter 扩张、symbol placement 和 ground geometry，故留到后续。

### 6. 原地颜色更新复用 Cesium 现有接口

更新策略按 bucket role 分派：

- instances line/fill/outline：在 Primitive ready 后调用 `getGeometryInstanceAttributes(n)`，用 `ColorGeometryInstanceAttribute.toValue()` 写回；
- packed line：更新 `appearance.material.uniforms.color`；
- circle：按新的 fill/outline 组合复用 layer 级 circle image cache，并更新 Billboard image；
- symbol：更新 Label 的 fill、outline、background 等现有属性；当前尚未实现的 `icon-color` 不纳入热更新集合。

常量颜色对所有 instance 使用同一计算结果；数据驱动表达式通过 `instanceFeatureIndices` 查询 feature table。当前 committed bucket 在下一 render pass 前更新，离屏 bucket 不被全量扫描，而是在重新提交前比较 `appliedStyleRevision` 惰性同步。异步 Primitive 未 ready 时保留 revision，warmup/submit 检测 ready 后应用。

Cesium fill Appearance 可能以不透明 render state 创建。若新颜色或表达式可能产生透明 alpha，而当前 Appearance 不支持正确 pass，则生成 bucket replacement；不通过直接修改 `appearance.translucent` 猜测已创建 render state。线 appearance 默认可混合的情况仍按实际 record 能力判断。

### 7. 图层 visibility 使用 bucket 级显示，不增加 show attribute

整个 style layer 的显隐不需要逐 feature show mask：

- 线面 Primitive 在提交时根据 runtime layer 最新规则设置 `primitive.show`；
- circle/symbol 由 `SharedPointCollections` 更新当前 tile/bucket 条目的 membership 或 handle `show`；
- renderer 不再只依赖 VectorTile 构建时保存的 `primitiveStyleRules` 快照决定 visibility。

已经驻留的 bucket 被隐藏时暂不立即销毁，使快速重新显示无构建成本；它仍受 VectorTile 离屏缓存预算约束。初始隐藏或已经驱逐的 bucket 在显示时走目标 bucket rebuild。逐要素动态 filter/highlight 未来才引入 `ShowGeometryInstanceAttribute`。

### 8. bucket rebuild 以 style layer 为替换单元并复用 PBF 路径

`VectorTileLayer` 增加目标 bucket rebuild 状态。对当前 committed/需要的 VectorTile，provider 按原 tile identity 取得 PBF 工作副本，Worker 只用目标 style rule/source-layer 解码并构建 replacement bucket。旧 bucket 在 replacement Primitive 可绘制之前继续使用；新 bucket ready 后原子替换，刷新共享点条目和拾取上下文，再销毁旧 bucket。没有旧 bucket的显隐恢复则在新 bucket ready 后出现。

离屏 VectorTile 只标记目标 bucket dirty，重新成为候选时才调度 rebuild。相同 tile 的多个 bucket rebuild 可以继续通过 PBF pending 合并；PBF ready hit 只产生工作副本，不下载。PBF 已淘汰、空响应或失败继续遵循现有 provider 语义。

该机制首期只用于颜色依赖/render state 回退和显示缺失 bucket。结构更新仍可复用同一基础设施扩展，但不在本 change 承诺。

### 9. 初始 bucket 按 VectorTile level 选择，fallback 使用祖先构建样式

`getStyleRulesForDecode/Build` 接收 build zoom，并过滤：

```text
visibility !== false
AND supported type
AND minzoom <= vectorTile.level < maxzoom
```

Worker 也只接收这组规则和 source-layer 名。renderer 对祖先 fallback 不再用当前 camera style zoom 隐藏其已构建 bucket；祖先以自己的 `buildZoom` 样式继续覆盖，直到精确瓦片 ready。这样不会为了任何潜在的后代 zoom 给父瓦片预建全部 style layer。

代价是相机 style zoom 已跨阈值但 quadtree 精确 level 尚未切换或尚未 ready 时，旧 zoom 样式会短暂延续。它比空洞和显著稳定内存更可接受，并与当前祖先几何 fallback 的渐进语义一致。

### 10. 只降低 Demo 显式离屏预算

Demo manager 配置 `tileCacheSize: 50`，每个示例 source 配置 `cacheBytes: 16 * 1024 * 1024`。manager 的 100 和 source 的 64 MiB 公共默认值保持不变，避免没有全局基准数据时改变其他调用方。

`VectorTileCache` 继续只驱逐 `referenceCount === 0` 的条目。当前 committed、loading 和祖先 fallback 即使超过估算预算也不提前销毁。PBF cache 独立存在；渲染资源驱逐后，PBF 命中仍可无网络重建。

备选方案是引入 manager 级跨 source 统一渲染 LRU。它需要改变现有 cache 所有权、引用回调和 source 隔离语义，不是本次降低 Demo 内存所必需，因此不采用。

### 11. 诊断覆盖驻留和样式更新路径

新增或明确以下指标：

- counters：`styleNoopUpdates`、`styleInPlaceUpdates`、`styleInPlaceInstanceUpdates`、`styleInPlacePointUpdates`、`styleBucketRebuilds`、`styleBucketPropertyFallbacks`、`styleBucketRenderStateFallbacks`、`styleSourceRebuilds`；
- gauges：`residentStyleBuckets`、`residentRenderPrimitives`、`residentFeatureTableEntries`、`residentPickPropertyValues`、`offscreenResidentVectorTiles`。

已有 `residentPbfCacheBytes/Entries`、请求、decode、build、stale/retired 指标保持独立。计数更新集中在 bucket store/destroy、feature table create/destroy 和 VectorTile reference transition，避免只增不减。

## Risks / Trade-offs

- **[默认拾取仍保留全部 properties]** 未配置 `pickProperties` 的 source 只能获得共享 table/紧凑 id 的收益，属性本身不会被裁剪。→ 文档突出数组和空数组配置，Demo 为已知需求显式列字段，并用诊断展示差异。
- **[拾取 API breaking change]** 现有 `picked.id.properties` 调用失效。→ 更新 Demo、README 和 STYLE，提供固定返回结构与迁移示例，测试非本 manager 结果。
- **[颜色更新仍是 O(当前 instance 数)]** 大视图下单帧遍历可能造成 CPU 峰值。→ 只立即更新 committed 内容，离屏内容惰性同步；通过更新数量和耗时诊断决定后续是否增加分帧预算。
- **[Cesium attributes 仅 ready 后可访问]** 过早调用会抛错。→ bucket 保存 `appliedStyleRevision`，仅在 ready 后应用，并在 warmup/submit 前重试。
- **[alpha render state 不兼容]** 只写 color attribute 可能产生错误 pass。→ 明确检测并走目标 bucket replacement，不修改整个 source。
- **[祖先样式短暂滞后]** 只构建 tile-level 必要桶会让 fallback 使用祖先 zoom 样式。→ 保持祖先覆盖直到精确瓦片可绘制，测试无空洞且不构建全部 zoom bucket。
- **[bucket replacement 增加状态复杂度]** 旧新 bucket、点条目、拾取注册表和任务取消可能竞态。→ 使用独立 bucket revision，提交前验证 VectorTile/bucket 仍有效，替换后按统一顺序注销旧上下文并销毁资源。
- **[缓存估算不等于浏览器内存]** `cacheBytes` 仍不能统计 Cesium/native/浏览器全部成本。→ 不宣称硬限制，增加可枚举驻留对象诊断并只调整 Demo 配置。

## Migration Plan

1. 引入属性依赖收集、feature table/featureIndices 数据模型和 Worker/bucket 单元测试，暂时保持现有公开 pick 示例。
2. 引入弱拾取注册表与 `resolvePickedFeature()`，迁移 Demo、测试和文档，然后删除渲染对象上的完整 metadata id。
3. 把 bucket 存储扩展为带 role、feature index 和 revision 的记录，接入统一销毁与诊断。
4. 实现 style diff、颜色/visibility 原地更新和 pending/offscreen 惰性同步；所有未知差异继续回退现有 source rebuild。
5. 实现目标 bucket rebuild、属性/render state 回退和初始 zoom 必要桶过滤，覆盖 LOD fallback、取消和替换测试。
6. 调低 Demo 显式离屏预算，更新 README/STYLE，并执行定向测试、lint、格式检查和固定视角内存/请求诊断。

回滚时可以让所有 `setLayerStyle()` 差异重新走现有 source rebuild，并恢复原 metadata id 与 Demo 缓存配置；PBF cache 和已有外部 style document 不需要迁移。已经使用新拾取 API 的调用方需要随代码一起回滚。

## Open Questions

无。`pickProperties` 未配置默认全部、同步内存 feature table 解析、Demo 预算 `tileCacheSize: 50`/source `cacheBytes: 16 MiB`、祖先使用自身 build zoom 样式以及不兼容变化只重建目标 bucket，均已在本 change 中确定。
