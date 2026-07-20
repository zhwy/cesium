## Why

当前样式或 filter 变化会推进 `contentRevision` 并销毁渲染瓦片，原始 PBF 又在传入 Worker 后被转移并释放，因此同一可见瓦片必须重新发起网络请求。需要把与样式无关的原始 PBF 独立缓存，降低样式热更新的网络开销，同时用明确的内存预算避免缓存无上限增长。

## What Changes

- 新增 manager 级内存 PBF LRU，在所有 source 之间共享一个可配置的总字节预算；新增 `pbfCacheBytes` 配置，允许通过 `0` 禁用。
- 原始 PBF 使用包含 source 数据身份和瓦片坐标的 key，不包含 `contentRevision`、filter、paint、layout 或渲染后端，使样式重建能够复用同一份数据。
- 缓存保存不可变的 master `ArrayBuffer`；每次解码创建工作副本并 transfer 给 Worker，避免缓存内容被 detach。
- 合并同一 PBF key 的并发请求，并使单个旧内容代的取消不会错误取消仍有消费者等待的共享请求。
- 将渲染内容失效与原始 PBF 清理分开：样式、filter、图标、scene 和渲染后端变化仅重建渲染内容；数据源身份变化或显式调用才清理原始 PBF。
- 增加 PBF 缓存命中、未命中、驱逐、驻留字节、复制和共享请求等诊断数据，并补充单元测试、集成测试及 README/STYLE 配置说明。
- 本次不引入 IndexedDB、完整 decoded tile 缓存、GeometryInstance 引用或样式属性热更新；这些能力留给后续 change。

## Capabilities

### New Capabilities

- `vector-tile-pbf-memory-cache`: 定义原始 PBF 的可配置内存 LRU、source 隔离、Worker 安全复制、请求合并、失效和诊断行为。

### Modified Capabilities

- `vector-tile-source-structure`: 将现有笼统的瓦片缓存归属要求明确拆分为带内容代的渲染瓦片缓存和与样式无关的 manager 级原始 PBF 缓存。

## Impact

- 主要影响 `VectorTileLayerManager.js`、`VectorTileProvider.js`、`VectorTileLayer.js`、缓存模块、任务取消链路和 `VectorTileDiagnostics.js`。
- 新增 manager 构造配置 `pbfCacheBytes` 以及显式原始数据缓存清理入口；现有 `cacheBytes` 继续只控制渲染瓦片缓存。
- 样式热更新在 PBF 命中时不再请求网络，但仍按当前逻辑重新解码并构建 Primitive。
- 内存中会常驻不超过配置预算的压缩 PBF master buffer，并在每次解码期间短暂存在一个工作副本。
- 不新增生产依赖，不引入持久化存储，也不改变 MVT 服务协议。
