## 1. 合并 Provider 簇到 VectorTileProvider.js

- [x] 1.1 将 `MVTLoader.js` 内容并入 `VectorTileProvider.js`，删除 `MVTLoader.js`，更新 base Provider 内部引用
- [x] 1.2 将 `TileType.js` 枚举并入 `VectorTileProvider.js` 并命名导出 `TileType`，删除 `TileType.js`
- [x] 1.3 将 `XYZVectorTileProvider.js`、`WMTSVectorTileProvider.js`、`WMTSGeoVectorTileProvider.js` 类并入 `VectorTileProvider.js` 并命名导出，删除三个子类文件
- [x] 1.4 全局搜索并更新对 `MVTLoader`/`TileType`/三个子类旧路径的所有 import（含 `src/` 与 `test/`）

## 2. 内联 createProvider 到 Manager

- [x] 2.1 在 `VectorTileLayerManager` 新增私有方法 `_createProvider(options)`，迁移 `createProvider.js` 的分派逻辑（保持相同 `tileType`/`format` 条件）
- [x] 2.2 将 `addLayer` 与 `_createDataProvider` 中的 `createProvider(...)` 调用改为 `this._createProvider(...)`
- [x] 2.3 删除 `createProvider.js` 并移除其 import

## 3. 合并并重命名样式表达式模块

- [x] 3.1 将 `VectorStyleFilter.js` 的 filter 求值/校验逻辑并入表达式模块
- [x] 3.2 将 `VectorStyleExpression.js` 重命名为 `VectorTileStyleExpression.js`（吸收 filter 后的完整模块）
- [x] 3.3 删除 `VectorStyleFilter.js` 与旧 `VectorStyleExpression.js`
- [x] 3.4 全局更新对 `VectorStyleExpression`/`VectorStyleFilter` 的 import（含 `decodeVectorTile.js` Worker 侧与 `test/`）

## 4. 合并小基类与枚举

- [x] 4.1 将 `VectorTilePrimitiveBucket` 基类并入 `VectorTileBucketFactory.js`，保持 primitive 存储结构不变
- [x] 4.2 删除 `VectorTilePrimitiveBucket.js` 并更新所有 import
- [x] 4.3 将 `VectorTileCoverageState` 枚举并入 `VectorTileLodSelection.js`
- [x] 4.4 删除 `VectorTileCoverageState.js` 并更新所有 import

## 5. 三兄弟对标注释

- [x] 5.1 为 `VectorSurfaceTile.js` 添加"对标 Cesium `GlobeSurfaceTile`"注释
- [x] 5.2 为 `TileVectorTile.js` 添加"对标 Cesium `TileImagery`"注释
- [x] 5.3 为 `VectorTile.js` 添加"对标 Cesium `Imagery`"注释

## 6. 文档同步

- [x] 6.1 更新 `Apps/Demos/LoadVectorTile/README.md` 的文件结构目录树（33 文件）
- [x] 6.2 更新 README 模块职责表：删除已合并文件行、修订 `VectorTileProvider`/`VectorTileStyleExpression`/`VectorTileBucketFactory`/`VectorTileLodSelection` 描述、补充三兄弟对标说明

## 7. 验证

- [x] 7.1 运行 `Apps/Demos/LoadVectorTile/test/` 下所有 Node 单测并全部通过
- [x] 7.2 在 Demo 页面冒烟验证 instances/packed/style document 三类示例渲染、拾取、缓存行为与重构前一致
- [x] 7.3 全局搜索确认无残留对已删除模块路径的引用
