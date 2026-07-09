## Context

`Apps/Demos/LoadVectorTile/src/` 是实验性 MVT/PBF 矢量瓦片加载框架，共 40 个源文件、约 7500 行。存在两类问题：

1. **碎片文件过多**：`TileType.js`(6)、`createProvider.js`(22)、`VectorTileCoverageState.js`(23)、`VectorTileDecodeWorker.js`(32)、`WMTSVectorTileProvider.js`(35)、`XYZVectorTileProvider.js`(40)、`VectorTilePrimitiveBucket.js`(41)、`VectorStyleFilter.js`(44)、`MVTLoader.js`(48) 等，独立成文的收益低、目录噪音高。
2. **命名前缀不统一**：主流 `VectorTile*`，但存在 `VectorStyle*`（`VectorStyleExpression`、`VectorStyleFilter`）与无前缀（`createProvider`、`decodeVectorTile`、`TileType`）。

本次是**纯结构重构**，不改变任何运行时行为、对外 API 或 style document 契约。目标读者约定：这套代码面向"熟悉 Cesium 内部四叉树模型"的读者，因此保留三兄弟对标命名。

## Goals / Non-Goals

**Goals:**

- 合并低耦合碎片文件，文件数从 40 降到 33。
- 统一样式表达式模块前缀为 `VectorTile*`。
- 为三兄弟补充 Cesium 对标注释，降低命名认知成本。
- 同步更新 `README.md` 的文件结构与模块职责表。
- 保持所有运行时行为、公开 API、Demo 与测试语义不变。

**Non-Goals:**

- 不拆分 `VectorTileLayer.js`(647 行) 上帝对象（方向与"减少文件"相反，本次不做）。
- 不做中风险的样式类合并（`VectorTileStyleRule` / `VectorTileStyleZoom` 并入 `VectorTileStyle.js`）。
- 不删除 `WMTSGeoVectorTileProvider` 遗留分支。
- 不改动 Worker 边界（`VectorTileDecodeWorker.js` 与 `decodeVectorTile.js` 保持分离）。
- 不改变任何几何、样式、缓存、LOD 的算法行为。

## Decisions

### 决策 1：Provider 簇合并为单文件 `VectorTileProvider.js`

将 base + `XYZ`/`WMTS`/`WMTSGeo` 子类 + `TileType` 枚举 + `MVTLoader` 全部并入 `VectorTileProvider.js`，对外从该文件命名导出 `TileType`、`XYZVectorTileProvider` 等符号。

- **为什么**：这些文件全部是"寻址 + 加载"同一职责域，且多为几十行碎片。单文件后 Provider 逻辑一处可读。
- **备选**：保留 `MVTLoader.js` 独立（fetch 职责分离）。已否决——`MVTLoader` 仅被 base Provider 调用，合并更彻底且用户已确认。

### 决策 2：工厂逻辑内联为 Manager 私有方法

删除 `createProvider.js`，把按 `tileType`/`format` 分派的逻辑改为 `VectorTileLayerManager._createProvider(options)`，供 `addLayer` 与 `_createDataProvider` 复用。

- **为什么**：工厂只有 Manager 两处调用，内联后减少一个跨文件跳转；且分派依赖的具体 Provider 类已集中在 `VectorTileProvider.js`。
- **备选**：将工厂作为 `VectorTileProvider.js` 的命名导出静态函数。已否决——用户明确要求内联到 Manager。

### 决策 3：表达式与过滤合并并统一前缀

`VectorStyleFilter.js` 并入表达式模块，文件重命名为 `VectorTileStyleExpression.js`，删除旧 `VectorStyleExpression.js` 与 `VectorStyleFilter.js`。

- **为什么**：filter 本就是表达式的一个可序列化子集，同源同域；重命名同时消除 `VectorStyle*` 前缀不一致。
- **注意**：需同步更新所有 import（含 Worker 侧 `decodeVectorTile.js` 与 `test/` 用例）。

### 决策 4：小基类/枚举就近合并

- `VectorTilePrimitiveBucket`(41 行基类) → `VectorTileBucketFactory.js`（工厂与基类天然相邻，bucket 存储形状不变）。
- `VectorTileCoverageState`(23 行枚举) → `VectorTileLodSelection.js`（枚举只服务覆盖/LOD 解析）。

### 决策 5：三兄弟保留命名 + 注释对标

不改名，只在 `VectorSurfaceTile.js` / `TileVectorTile.js` / `VectorTile.js` 顶部注释标注对标的 Cesium 类：`GlobeSurfaceTile` / `TileImagery` / `Imagery`。

- **为什么**：三兄弟精确复刻 Cesium 内部三层模型，改名会破坏与 Cesium 源码的心智映射；注释在保留资产的同时降低新读者的困惑。

### 逐文件迁移映射

| 现文件 | 去向 | 操作 |
| --- | --- | --- |
| `createProvider.js` | `VectorTileLayerManager._createProvider()` | 内联后删除 |
| `TileType.js` | `VectorTileProvider.js` | 合并后删除 |
| `XYZVectorTileProvider.js` | `VectorTileProvider.js` | 合并后删除 |
| `WMTSVectorTileProvider.js` | `VectorTileProvider.js` | 合并后删除 |
| `WMTSGeoVectorTileProvider.js` | `VectorTileProvider.js` | 合并后删除（分支保留） |
| `MVTLoader.js` | `VectorTileProvider.js` | 合并后删除 |
| `VectorStyleFilter.js` | `VectorTileStyleExpression.js` | 合并后删除 |
| `VectorStyleExpression.js` | `VectorTileStyleExpression.js` | 重命名（吸收 filter） |
| `VectorTilePrimitiveBucket.js` | `VectorTileBucketFactory.js` | 合并后删除 |
| `VectorTileCoverageState.js` | `VectorTileLodSelection.js` | 合并后删除 |
| `VectorSurfaceTile.js` / `TileVectorTile.js` / `VectorTile.js` | 原地 | 加对标注释 |

### 目标结构（33 文件）

```
编排层   VectorTileLayerManager(含_createProvider) / VectorTileLayerCollection
         VectorTileLayer / VectorTileDataProvider
四叉树   VectorTileQuadtreePrimitive / VectorTileQuadtreeProvider
         VectorSurfaceTile / TileVectorTile / VectorTile / VectorTileLodSelection(含CoverageState)
寻址     VectorTileProvider(含 XYZ/WMTS/WMTSGeo/TileType/MVTLoader)
解码     VectorTileDecoder / VectorTileDecodeWorker / decodeVectorTile / VectorTileGeometryUtils
样式     VectorTileStyle / VectorTileStyleExpression(含 filter) / VectorTileStyleZoom / VectorTileStyleRule
建桶     VectorTileSymbolBucket / VectorTileLineBucket / VectorTileFillBucket
         VectorTileGeometryPlacement / VectorTileBucketUtils / VectorTileBucketFactory(含基类)
基础设施 VectorTileTaskScheduler / VectorTileCache / VectorTileDiagnostics / VectorTileBenchmark
```

## Risks / Trade-offs

- **[遗漏 import 更新导致运行时报错]** → 每个合并/删除动作后全局搜索旧模块路径，逐一更新 `src/`、`decodeVectorTile.js`（Worker 侧）与 `test/`；改动完成后运行 `test/` 下 Node 单测并在 Demo 页面冒烟验证。
- **[Worker 侧 import 被忽略]** → `VectorTileDecodeWorker.js`/`decodeVectorTile.js` 独立打包，需单独确认对 `VectorTileStyleExpression.js`、`VectorTileProvider.js` 的引用同步更新。
- **[命名导出破坏]** → 合并后从 `VectorTileProvider.js` 命名导出所有子类与 `TileType`，避免调用方语义变化；Manager 内联工厂需保持与原 `createProvider` 完全相同的分派条件。
- **[主文件轻度膨胀]** → `VectorTileProvider.js` 合并后约 230–280 行、`VectorTileStyleExpression.js` 约 350 行、`VectorTileBucketFactory.js` 约 100 行，均在可读范围，属可接受权衡。

## Migration Plan

1. 先合并无外部反向依赖的叶子（`MVTLoader`、`TileType`、Provider 子类）到 `VectorTileProvider.js`。
2. 内联 `createProvider` 到 Manager，删除 `createProvider.js`。
3. 合并并重命名表达式模块，全局更新 import（含 Worker/test）。
4. 合并 Bucket 基类与 CoverageState 枚举。
5. 为三兄弟加注释。
6. 更新 `README.md`。
7. 运行 `test/` Node 单测 + Demo 冒烟。

回滚策略：每步为独立提交，出现行为异常可按步回退。
