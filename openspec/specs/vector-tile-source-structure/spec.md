## ADDED Requirements

### Requirement: Provider 寻址逻辑按子类拆分为独立文件

矢量瓦片框架 SHALL 将 Provider 基类（含 PBF 加载入口与 `MVTLoader` 单例）保留在 `VectorTileProvider.js` 中，`XYZ`/`WMTS`/`WMTSGeo` 三个具体寻址子类与 `TileType` 枚举 SHALL 拆分为独立文件 `XYZVectorTileProvider.js`、`WMTSVectorTileProvider.js`、`WMTSGeoVectorTileProvider.js`、`TileType.js`；子类文件从对应基类文件默认导入并 `extends`，消费方（如 `VectorTileLayerManager`）直接从这些独立文件导入，不再通过 `VectorTileProvider` 的静态成员转发子类或枚举。

#### Scenario: 请求 XYZ 瓦片

- **WHEN** 图层配置 `tileType` 为 `XYZ` 且发起某 `(x, y, level)` 瓦片请求
- **THEN** 系统使用 `XYZVectorTileProvider.js` 导出的寻址实现生成正确 URL 并完成加载，行为与重构前一致

#### Scenario: 请求 WMTS 瓦片

- **WHEN** 图层配置 `tileType` 为 `WMTS`
- **THEN** 系统使用 `WMTSVectorTileProvider.js`（或 `format` 为 GeoJSON 时的 `WMTSGeoVectorTileProvider.js`）导出的寻址实现生成正确 URL，行为与重构前一致

### Requirement: Provider 工厂逻辑内联到 Manager

矢量瓦片框架 SHALL 由 `VectorTileLayerManager` 的私有方法 `_createProvider()` 承担按 `tileType` 与 `format` 选择 Provider 实现的工厂职责；`src/` 目录 SHALL 不再包含独立的 `createProvider.js` 文件。

#### Scenario: 通过 addLayer 创建图层

- **WHEN** 调用 `manager.addLayer(options)`
- **THEN** Manager 内部经由 `_createProvider()` 选择并实例化正确的 Provider，返回图层，行为与重构前一致

#### Scenario: 通过 setStyle 创建数据源

- **WHEN** 调用 `manager.setStyle(styleDocument)` 触发 `_createDataProvider`
- **THEN** 内部复用同一 `_createProvider()` 工厂逻辑创建 Provider，行为与重构前一致

### Requirement: 样式表达式与过滤合并且前缀统一

矢量瓦片框架 SHALL 将可序列化 filter 求值逻辑与样式表达式求值逻辑合并到单一模块，并以统一的 `VectorTile*` 前缀命名为 `VectorTileStyleExpression.js`；`src/` 目录 SHALL 不再包含 `VectorStyleExpression.js` 与 `VectorStyleFilter.js`。

#### Scenario: 求值样式表达式

- **WHEN** 样式规则包含 `get`/`match`/`case`/`interpolate`/`zoom` 等表达式
- **THEN** 系统从 `VectorTileStyleExpression.js` 求值，结果与重构前一致

#### Scenario: 应用 filter 表达式

- **WHEN** 样式图层配置可序列化 `filter`
- **THEN** 系统从 `VectorTileStyleExpression.js` 校验并求值 filter，结果与重构前一致

### Requirement: Bucket 基类与工厂合并

矢量瓦片框架 SHALL 将 `VectorTilePrimitiveBucket` 基类定义合并进 `VectorTileBucketFactory.js`；`src/` 目录 SHALL 不再包含独立的 `VectorTilePrimitiveBucket.js` 文件，且 bucket 的 primitive 存储结构保持不变。

#### Scenario: 按样式类型路由 bucket

- **WHEN** 样式图层类型为 `fill`
- **THEN** 系统从 `VectorTileBucketFactory.js` 创建对应的 fill bucket

#### Scenario: 创建自定义 bucket

- **WHEN** 需要扩展新的 bucket 类型
- **THEN** 系统通过 `VectorTileBucketFactory.js` 的扩展机制创建自定义 bucket

### Requirement: 样式解析逻辑集中化

矢量瓦片框架 SHALL 将样式解析逻辑集中到 `VectorTileStyleParser.js` 模块中，支持多种样式格式和版本。

#### Scenario: 解析 Mapbox 样式

- **WHEN** 输入 Mapbox 样式文档
- **THEN** 系统从 `VectorTileStyleParser.js` 解析并转换为内部样式表示

#### Scenario: 解析自定义样式

- **WHEN** 输入自定义样式格式
- **THEN** 系统通过 `VectorTileStyleParser.js` 的扩展机制解析

### Requirement: 瓦片缓存管理集中化

矢量瓦片框架 SHALL 将瓦片缓存逻辑集中到 `VectorTileCache.js` 模块中，支持多种缓存策略。

#### Scenario: 内存缓存管理

- **WHEN** 瓦片需要缓存到内存
- **THEN** 系统通过 `VectorTileCache.js` 进行缓存管理

#### Scenario: 磁盘缓存管理

- **WHEN** 瓦片需要缓存到磁盘
- **THEN** 系统通过 `VectorTileCache.js` 进行缓存管理

### Requirement: 瓦片加载器接口统一

矢量瓦片框架 SHALL 统一瓦片加载器接口，支持多种数据格式。

#### Scenario: PBF 格式加载

- **WHEN** 瓦片数据为 PBF 格式
- **THEN** 系统通过统一的加载器接口处理

#### Scenario: GeoJSON 格式加载

- **WHEN** 瓦片数据为 GeoJSON 格式
- **THEN** 系统通过统一的加载器接口处理

### Requirement: 错误处理机制统一

矢量瓦片框架 SHALL 统一错误处理机制，提供一致的错误报告接口。

#### Scenario: 网络错误处理

- **WHEN** 瓦片加载失败
- **THEN** 系统通过统一的错误处理机制报告错误

#### Scenario: 解析错误处理

- **WHEN** 样式解析失败
- **THEN** 系统通过统一的错误处理机制报告错误

### Requirement: 性能监控集中化

矢量瓦片框架 SHALL 集中化性能监控逻辑，提供统一的性能指标接口。

#### Scenario: 加载性能监控

- **WHEN** 瓦片加载完成
- **THEN** 系统记录加载时间并更新性能指标

#### Scenario: 渲染性能监控

- **WHEN** 瓦片渲染完成
- **THEN** 系统记录渲染时间并更新性能指标

### Requirement: 配置管理集中化

矢量瓦片框架 SHALL 集中化配置管理，提供统一的配置接口。

#### Scenario: 全局配置

- **WHEN** 需要设置全局配置
- **THEN** 系统通过统一的配置接口设置

#### Scenario: 局部配置

- **WHEN** 需要设置局部配置
- **THEN** 系统通过统一的配置接口设置

### Requirement: 事件处理机制统一

矢量瓦片框架 SHALL 统一事件处理机制，提供一致的事件接口。

#### Scenario: 瓦片加载事件

- **WHEN** 瓦片加载状态变化
- **THEN** 系统通过统一的事件接口触发事件

#### Scenario: 样式变化事件

- **WHEN** 样式配置变化
- **THEN** 系统通过统一的事件接口触发事件

### Requirement: 模块依赖管理

矢量瓦片框架 SHALL 优化模块依赖关系，减少循环依赖。

#### Scenario: 模块导入优化

- **WHEN** 模块之间有依赖关系
- **THEN** 系统通过优化的导入结构减少依赖

#### Scenario: 循环依赖解决

- **WHEN** 检测到循环依赖
- **THEN** 系统通过重构解决循环依赖问题

### Requirement: 代码结构优化

矢量瓦片框架 SHALL 优化代码结构，提高可维护性。

#### Scenario: 模块职责分离

- **WHEN** 模块承担多个职责
- **THEN** 系统通过职责分离提高可维护性

#### Scenario: 代码复用

- **WHEN** 存在重复代码
- **THEN** 系统通过提取公共代码提高复用性

### Requirement: 测试结构优化

矢量瓦片框架 SHALL 优化测试结构，提高测试覆盖率。

#### Scenario: 单元测试
- **WHEN** 需要测试单个模块
- **THEN** 系统提供完整的单元测试覆盖

#### Scenario: 集成测试

- **WHEN** 需要测试模块间交互
- **THEN** 系统提供完整的集成测试覆盖

### Requirement: 文档结构优化

矢量瓦片框架 SHALL 优化文档结构，提高文档质量。

#### Scenario: API 文档

- **WHEN** 需要查看 API 文档
- **THEN** 系统提供完整的 API 文档

#### Scenario: 使用示例

- **WHEN** 需要查看使用示例
- **THEN** 系统提供完整的使用示例

### Requirement: Provider owns source metadata and style rules

`VectorTileProvider` SHALL represent one vector tile style source, including source id, source configuration, tile request behavior, and the style rules that consume that source.

#### Scenario: Create provider for a style source

- **WHEN** the manager creates a provider for a style document source
- **THEN** the provider SHALL expose the source id, source configuration, tile availability, tile resource creation, tile request behavior, and associated style rules through one object

#### Scenario: Serialize provider style state

- **WHEN** a provider has one or more style rules and `toStyleDocument()` is called
- **THEN** the provider SHALL return a style document containing its source and those style rules

#### Scenario: Remove provider style rule

- **WHEN** `removeStyleRule(layerId)` is called with a matching style rule id
- **THEN** the provider SHALL remove that rule and report that a rule was removed

### Requirement: Manager exposes provider lookup by source id

`VectorTileLayerManager` SHALL expose provider lookup through `getProvider(sourceId)` instead of exposing source-backed runtime layers through `getLayer(layerId)`.

#### Scenario: Lookup existing provider

- **WHEN** `getProvider(sourceId)` is called for a source that is present in the current style document
- **THEN** the manager SHALL return the `VectorTileProvider` for that source

#### Scenario: Lookup missing provider

- **WHEN** `getProvider(sourceId)` is called for a source that is not present
- **THEN** the manager SHALL return `undefined`

#### Scenario: Runtime layer remains internal

- **WHEN** callers need to remove a style document layer
- **THEN** callers SHALL use `removeLayer(layerId)` rather than removing the source-backed runtime layer directly

### Requirement: Manager owns PBF cache for all sources

`VectorTileLayerManager` SHALL own and manage a shared PBF cache that serves all vector tile sources managed by this instance. The cache SHALL be configured with `pbfCacheBytes` parameter and SHALL provide LRU eviction based on master buffer byte size.

#### Scenario: Manager creates shared cache

- **WHEN** manager is instantiated with `pbfCacheBytes` configuration
- **THEN** manager SHALL create a shared `VectorTilePbfCache` instance with the specified budget

#### Scenario: Manager injects cache into providers

- **WHEN** manager creates or accepts a provider
- **THEN** manager SHALL inject the same PBF cache instance into all providers

#### Scenario: Cache budget validation

- **WHEN** `pbfCacheBytes` is invalid (negative, non-finite, non-number)
- **THEN** manager construction SHALL throw `DeveloperError`

### Requirement: PBF cache provides shared network task coordination

The PBF cache SHALL coordinate concurrent network requests for the same PBF key, merging multiple concurrent misses into a single shared request.

#### Scenario: Cache accepts concurrent requests

- **WHEN** multiple providers request the same PBF key simultaneously
- **THEN** cache SHALL merge these into a single shared network task

#### Scenario: Cache provides independent handles

- **WHEN** cache handles a shared request
- **THEN** cache SHALL return independent promise handles to each consumer with separate cancellation capability

#### Scenario: Cache cleans up after all consumers cancel

- **WHEN** all consumers of a shared request cancel
- **THEN** cache SHALL cancel the underlying network task and remove the pending entry

### Requirement: PBF cache maintains master buffer copies

The PBF cache SHALL maintain immutable master `ArrayBuffer` copies and provide working copies to consumers for Worker transfer.

#### Scenario: Cache saves master on first hit

- **WHEN** network request succeeds for a PBF key
- **THEN** cache SHALL save the master buffer and provide working copies to consumers

#### Scenario: Working copies are transferable

- **WHEN** consumer needs to transfer PBF data to Worker
- **THEN** cache SHALL provide a working copy that can be transferred while keeping master

#### Scenario: Master remains available for reuse

- **WHEN** master buffer is saved and new consumers request the same key
- **THEN** cache SHALL create new working copies from the same master buffer
