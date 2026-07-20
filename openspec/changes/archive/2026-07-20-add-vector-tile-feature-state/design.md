## Context

当前矢量瓦片运行时已经具备三项基础能力：解码阶段保留 PBF feature id 和属性；拾取注册表可以把 Cesium 拾取结果还原为 source、source-layer、样式图层和要素身份；instances 线、面 bucket 可以通过 `GeometryInstance` 的 `color` attribute 原地改色。缺口在于这些能力尚未被一个独立于源属性和样式文档的运行时状态模型串联起来。

状态驱动样式需要跨越 manager 公共 API、source 生命周期、worker 解码、表达式求值、bucket 实例索引、异步 Primitive ready 时序以及瓦片缓存生命周期。若只在鼠标事件中直接写当前拾取实例的颜色，同一源要素在相邻瓦片、裁剪片段或多个样式图层中的副本会产生不一致，也无法在瓦片重新加载后恢复状态。

## Goals / Non-Goals

**Goals:**

- 提供按 source、source-layer 和稳定 feature id 寻址的运行时状态 API，并采用浅合并语义。
- 让 `line-color`、`fill-color` 和已有轮廓实例的 `fill-outline-color` 可以读取 feature-state。
- 状态变化只重算目标要素并原地更新对应的 per-instance color attribute，不触发网络请求、PBF 解码或几何重建。
- 同步一个逻辑要素在跨瓦片副本、裁剪片段和多个样式图层中的所有驻留表示。
- 在状态先于瓦片加载、Primitive 尚未 ready、瓦片驱逐后重载和样式热更新等时序下保持确定行为。
- 提供足够的诊断和测试来证明更新范围、资源生命周期和性能边界。

**Non-Goals:**

- 不在首期支持 packed line 后端、circle/symbol、3D/挤出要素或自定义 shader 状态纹理。
- 不允许 feature-state 驱动 filter、layout、显隐、线宽、轮廓宽度、高度或其他会改变几何与批次结构的字段。
- 不把 feature-state 写回 PBF 属性，也不将其持久化到页面刷新之外。
- 不提供跨 source 的全局要素身份，也不使用 `sourceFeatureIndex` 作为稳定身份兜底。

## Decisions

### 1. 状态由 source 运行时拥有，manager 负责路由

`VectorTileLayerManager` 增加以下公共方法：

```js
manager.setFeatureState({ source, sourceLayer, id }, state);
manager.getFeatureState({ source, sourceLayer, id });
manager.removeFeatureState({ source, sourceLayer, id }, key);
```

target 的三个字段均为必填，`id` 接受 string 或 number 并保留类型差异。`setFeatureState` 只接受普通对象，将顶层键浅合并到旧状态；值相同的写入视为 no-op。`getFeatureState` 返回浅拷贝，避免调用方绕过更新链路直接修改内部状态。`removeFeatureState` 在有 `key` 时删除单个键，没有 `key` 时删除该要素的完整状态。set/remove 返回是否发生变化；未知 source 返回 false，get 返回空对象。缺少 target 字段、非法 id、非对象 state 或非法 key 使用 `DeveloperError` 报错。

manager 将请求路由到对应的 `VectorTileLayer`。每个 runtime source 保存自己的状态表，键为 `(sourceLayer, typedId)`；样式图层 id 不参与键计算，因此同一源要素的多个样式表示共享状态。source runtime 仍存在时，瓦片缓存和样式图层变化不会删除状态；source runtime 被移除、替换或 manager 销毁时统一清空。

选择 source 级所有权而不是 manager 全局表，可以让状态生命周期自然跟随资源所有者，并避免同名 source 在样式替换前后错误复用状态。选择显式 target 而不是直接接收拾取对象，可让业务代码只保留稳定身份，同时仍能用 `resolvePickedFeature()` 的返回值构造 target。

### 2. `promoteId` 在解码入口生成稳定身份

vector source 接受两种 `promoteId`：字符串表示所有 source-layer 使用同名属性；对象表示按 source-layer 映射属性名，未出现在映射中的 source-layer 继续使用 PBF 原生 id。配置了提升属性但目标要素缺失该属性，或值不是 string/number 时，该要素不可被 feature-state 寻址并记录诊断；不得退回 `sourceFeatureIndex`。

worker 在属性裁剪前解析最终 id，并将其写入 feature table。未配置 `promoteId` 时沿用 PBF id；配置生效时，拾取结果的 `id` 返回提升后的 id，从而可以直接传给状态 API。内部组合键同时编码 JS 类型，避免数字 `1` 与字符串 `"1"` 冲突。

在解码阶段完成提升可以保证 `pickProperties: []` 时仍保留身份，也避免每个 bucket 重复解析配置。没有采用任意表达式作为 `promoteId`，因为属性名或 source-layer 映射已覆盖当前需求，且更容易验证和在 worker 中稳定执行。

### 3. 表达式只扩展状态读取和布尔断言

表达式运行上下文增加 `state`。新增 `['feature-state', key]`，其中 key 必须是字符串；缺失状态或键时返回 `null`。同时新增 `['boolean', value, fallback]`，用于安全表达悬浮/选中分支，例如：

```js
[
  "case",
  ["boolean", ["feature-state", "hover"], false],
  "#00ffff",
  "#336699",
]
```

feature-state 首期只允许出现在 `line-color`、`fill-color` 和已有轮廓几何对应的 `fill-outline-color` paint 表达式中。样式规范化阶段拒绝它出现在 filter、layout 或任何几何相关 paint 字段，错误需要指出样式图层、字段和原因。依赖分析将状态键和源属性键分开，`feature-state` 不会导致该键被加入属性投影。

选择在现有表达式解释器中扩展上下文，而不是为交互维护第二套样式函数，可以复用现有 case/match/get/zoom 组合能力，并保持样式热更新与初次构建的语义一致。

### 4. bucket 建立从稳定身份到实例的反向绑定

instances 线、面 bucket 在创建 `GeometryInstance` 时，同时建立 `typedId -> instance bindings` 的局部反向索引。一个身份可以绑定多个 instance，以覆盖裁剪片段和同 bucket 内的重复几何。`VectorTileLayer` 再维护 `feature key -> resident buckets` 索引，使一次状态变化只访问包含目标身份的 bucket。

每个 binding 保留重新求值所需的 feature table 索引和样式图层上下文。状态变化时，bucket 使用最新 properties、id、zoom 和 state 只重新计算受影响的颜色字段，再通过现有 `getGeometryInstanceAttributes()` 与 `ColorGeometryInstanceAttribute.toValue()` 写入。多个瓦片、多个样式图层和 fill/outline 表示分别注册，因此会在同一状态提交中全部更新。

没有选择遍历全部 cache/bucket，因为悬浮事件频率高，全量扫描会让开销随可见要素总数增长。也没有把每个 instance 直接存入全局状态表，因为 bucket 才拥有 Primitive 生命周期；两级索引能在 bucket destroy 时一次性、确定性注销。

### 5. 新建与未 ready 的 Primitive 始终收敛到最新状态

新 bucket 创建实例初始颜色时读取 source 状态表，因此“先 set、后加载”的瓦片第一次可见即使用最新状态。bucket 注册后若 Primitive 尚未 ready，状态更新只记录目标身份及 source 状态 revision；在现有 update/ready 路径中应用，重复写入合并为该身份的最新状态。bucket 销毁会注销绑定并清空待处理项，异步回调不得再访问已销毁资源。

状态表独立于瓦片 cache，故驱逐只移除渲染绑定，不移除状态；同一要素重新进入 cache 时重新读取状态。样式热更新若保留 runtime source，也保留状态并让新 bucket 在构建时读取它。

### 6. feature-state 样式使用可原地改色的渲染后端

包含 feature-state 颜色表达式的线 bucket 必须使用 instances 路径，不能选择 packed line。若样式热更新首次把一个现有 packed line 图层改为 feature-state 颜色，允许进行一次已有的 bucket/backend 重建；之后的 set/remove 状态操作不得重建。

颜色表达式在 bucket 构建时按可产生透明值处理，确保后续状态切换 alpha 不需要替换 RenderState。面轮廓只更新已经由样式构建出的轮廓实例；状态更新不会凭空创建轮廓几何。若热更新新增需要的新轮廓表示，应走现有样式兼容性判断和一次性 bucket 重建。

### 7. 诊断以“状态提交没有进入重建管线”为核心

诊断增加状态写入、no-op、删除、已更新 instance、延迟更新和不可寻址要素计数，并暴露驻留状态数与绑定数 gauge。自动化测试同时断言状态变化前后的请求、解码和 bucket build 计数不变，从行为与性能两侧约束实现。

Demo 使用 `ScreenSpaceEventHandler`：mousemove 只在目标身份变化时清除旧 hover 并设置新 hover；click 以相同方式维护 selected。拾取必须开启，但调用方可以把 `pickProperties` 设为空数组，仅保留身份字段以控制内存。

## Risks / Trade-offs

- **驻留索引增加内存。** 每个可寻址实例会增加身份到 binding 的引用；通过只为包含 feature-state 表达式的相关 instances bucket 建索引、在 destroy 时批量注销，并提供 binding gauge 控制风险。
- **高频 hover 可能产生无效写入。** manager/bucket 对相同浅值做 no-op，Demo 也先比较身份；诊断单独统计 no-op 便于发现调用问题。
- **字符串与数字 id 容易碰撞。** 内部 typed key 显式编码类型，公共 API 和测试保留两者差异。
- **透明度变化可能与已有 opaque bucket 不兼容。** feature-state 表达式在构建时选择兼容透明颜色的路径；只有首次样式热更新引入该表达式时允许一次性重建。
- **同一逻辑对象若源数据没有稳定 id，跨瓦片仍无法同步。** 通过 `promoteId` 提供显式解法；缺失身份时记录诊断且不使用不稳定索引猜测。
- **状态长期保留可能随业务交互增长。** 状态在显式 remove 或 source 销毁前保留，这是跨瓦片恢复所需的语义；Demo 在 hover 离开时及时删除临时状态，诊断暴露状态表规模。

## Migration Plan

1. 先加入 `promoteId` 解析、表达式语义和纯单元测试，不改变未使用新配置的现有样式。
2. 加入 source 状态表、公共 API 和 bucket 反向绑定，再覆盖异步、驱逐、跨瓦片及多样式图层测试。
3. 加入诊断和 hover/click Demo，使用已有测试与 benchmark 验证状态写入不增加请求、解码和构建计数。
4. 该能力全部为增量能力；回滚时移除新 API、表达式和绑定即可，未使用 feature-state 的样式无需迁移。

## Open Questions

无。首期支持范围和状态生命周期均在本设计中固定；circle/symbol、packed line 原生状态和状态纹理方案留待后续独立变更。
