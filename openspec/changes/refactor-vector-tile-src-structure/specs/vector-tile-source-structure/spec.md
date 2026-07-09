## ADDED Requirements

### Requirement: Provider 寻址逻辑集中于单一模块

矢量瓦片框架 SHALL 将所有瓦片寻址（URL 模板解析）与 PBF 加载逻辑集中在单一 `VectorTileProvider.js` 模块中，包含 Provider 基类、`XYZ`/`WMTS`/`WMTSGeo` 子类、`TileType` 枚举与 `MVTLoader` 加载器；`src/` 目录 SHALL 不再包含 `XYZVectorTileProvider.js`、`WMTSVectorTileProvider.js`、`WMTSGeoVectorTileProvider.js`、`TileType.js`、`MVTLoader.js` 独立文件。

#### Scenario: 请求 XYZ 瓦片

- **WHEN** 图层配置 `tileType` 为 `XYZ` 且发起某 `(x, y, level)` 瓦片请求
- **THEN** 系统从 `VectorTileProvider.js` 导出的 XYZ 寻址实现生成正确 URL 并完成加载，行为与重构前一致

#### Scenario: 请求 WMTS 瓦片

- **WHEN** 图层配置 `tileType` 为 `WMTS`
- **THEN** 系统从 `VectorTileProvider.js` 导出的 WMTS 寻址实现生成正确 URL，行为与重构前一致

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

- **WHEN** 某样式规则被路由到对应的 fill/line/symbol bucket
- **THEN** bucket 继承自合并后模块导出的基类，primitive 存储与生命周期行为与重构前一致

### Requirement: 覆盖状态枚举归入 LOD 选择模块

矢量瓦片框架 SHALL 将 `VectorTileCoverageState` 枚举合并进 `VectorTileLodSelection.js`；`src/` 目录 SHALL 不再包含独立的 `VectorTileCoverageState.js` 文件，枚举取值保持不变。

#### Scenario: 解析非重叠 LOD 覆盖集合

- **WHEN** 父子瓦片同时就绪并执行非重叠 LOD 选择
- **THEN** 系统使用合并后模块中的覆盖状态枚举进行判断，结果与重构前一致

### Requirement: 三兄弟保留命名并标注 Cesium 对标

矢量瓦片框架 SHALL 保留 `VectorSurfaceTile.js`、`TileVectorTile.js`、`VectorTile.js` 的文件名与类名，并在各文件内添加注释，分别标注其对标 Cesium 的 `GlobeSurfaceTile`、`TileImagery`、`Imagery`。

#### Scenario: 阅读三兄弟源码

- **WHEN** 开发者打开 `VectorSurfaceTile.js` / `TileVectorTile.js` / `VectorTile.js`
- **THEN** 文件顶部注释清晰说明其对标的 Cesium 内部类，帮助建立三层模型的心智映射
