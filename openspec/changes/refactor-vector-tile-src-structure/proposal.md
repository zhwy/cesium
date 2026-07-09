## Why

`Apps/Demos/LoadVectorTile/src/` 当前有 40 个源文件、约 7500 行，其中大量是十几到几十行的碎片文件（`TileType.js` 6 行、`createProvider.js` 22 行、`VectorTileCoverageState.js` 23 行等）。同时命名前缀不统一（`VectorTile*`、`VectorStyle*`、无前缀混用），导致文件职责不易一眼看清、目录噪音大。本次在**不改变任何运行时行为**的前提下，合并低耦合碎片、统一命名，让文件作用更清晰。

## What Changes

- **合并 Provider 簇**：`VectorTileProvider.js`（base）吸收 `XYZVectorTileProvider.js`、`WMTSVectorTileProvider.js`、`WMTSGeoVectorTileProvider.js`、`TileType.js`、`MVTLoader.js`，成为单一寻址/加载模块。
- **createProvider 内联**：删除 `createProvider.js`，其工厂逻辑改为 `VectorTileLayerManager` 的私有方法 `_createProvider()`，`addLayer` 与 `_createDataProvider` 复用。
- **合并样式表达式**：`VectorStyleFilter.js` 并入表达式模块，并将文件**重命名**为 `VectorTileStyleExpression.js`（统一 `VectorTile*` 前缀），`VectorStyleExpression.js` 删除。
- **合并 Bucket 基类**：`VectorTilePrimitiveBucket.js`（41 行基类）并入 `VectorTileBucketFactory.js`。
- **合并覆盖状态枚举**：`VectorTileCoverageState.js` 并入 `VectorTileLodSelection.js`。
- **命名对标注释**：为 `VectorSurfaceTile.js` / `TileVectorTile.js` / `VectorTile.js` 三兄弟各添加"对标 Cesium `GlobeSurfaceTile` / `TileImagery` / `Imagery`"的说明注释（**保留原文件名**）。
- **同步文档**：更新 `Apps/Demos/LoadVectorTile/README.md` 的文件结构、模块职责表与相关描述。
- 保留 `WMTSGeoVectorTileProvider` 遗留分支，不删除。

文件数量从 40 降到 33。本次不做任何中风险的行为相关重组（如样式类合并、`VectorTileLayer.js` 拆分）。

## Capabilities

### New Capabilities

- `vector-tile-source-structure`: 约束 `Apps/Demos/LoadVectorTile/src/` 的模块划分与命名约定——Provider 寻址统一在单文件、工厂逻辑内联到 Manager、样式表达式与过滤合并、Bucket 基类与工厂合并、覆盖状态枚举归入 LOD 选择、三兄弟保留 Cesium 对标命名。

### Modified Capabilities

<!-- 无。本次为纯结构重构，不改变任何对外行为或运行时契约。 -->

## Impact

- **受影响代码**：`Apps/Demos/LoadVectorTile/src/` 内的 import 路径（合并/重命名/删除涉及的模块引用）、`VectorTileLayerManager.js`（内联工厂）、`Apps/Demos/LoadVectorTile/README.md`。
- **删除文件**：`createProvider.js`、`TileType.js`、`XYZVectorTileProvider.js`、`WMTSVectorTileProvider.js`、`WMTSGeoVectorTileProvider.js`、`MVTLoader.js`、`VectorStyleExpression.js`、`VectorStyleFilter.js`、`VectorTilePrimitiveBucket.js`、`VectorTileCoverageState.js`（部分内容合入其它文件）。
- **无 API/依赖变更**：对外入口（`VectorTileLayerManager` 的公开方法、style document 契约、Demo 页面）保持不变。
- **测试**：`Apps/Demos/LoadVectorTile/test/` 内引用被合并/重命名模块的用例需更新 import 路径。
