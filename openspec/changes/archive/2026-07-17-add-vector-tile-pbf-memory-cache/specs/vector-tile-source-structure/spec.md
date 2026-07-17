## MODIFIED Requirements

### Requirement: 瓦片缓存管理集中化

矢量瓦片框架 SHALL 将带 `contentRevision` 的渲染瓦片缓存与不依赖样式的原始 PBF 缓存分开管理。`VectorTileCache.js` SHALL 继续负责 runtime layer 的渲染内容、引用计数和 Primitive 确定性销毁；独立的 PBF cache 模块 SHALL 由 `VectorTileLayerManager` 持有并注入 source provider，在 manager 级总字节预算下复用原始网络数据。本阶段 SHALL 仅提供内存 PBF 缓存，不得启用磁盘或 IndexedDB 持久化。

#### Scenario: 管理带内容代的渲染缓存

- **WHEN** runtime layer 获取或释放某个带 `contentRevision` 的渲染瓦片
- **THEN** 系统 SHALL 通过 `VectorTileCache.js` 管理其引用、LRU、任务取消和渲染资源销毁

#### Scenario: 管理与样式无关的原始 PBF 缓存

- **WHEN** source provider 请求一个 PBF 瓦片
- **THEN** 系统 SHALL 通过 manager 持有的独立 PBF cache 管理原始 master buffer 和共享网络任务

#### Scenario: 两类缓存使用独立预算和生命周期

- **WHEN** 样式内容代变化或任一缓存达到自身预算
- **THEN** 系统 SHALL 独立处理渲染内容失效和原始 PBF 驱逐，且不得用一类缓存的字节统计覆盖另一类缓存的统计

