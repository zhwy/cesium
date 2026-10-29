## Why

LoadVectorTile 的 BufferPolygon 面目前在主线程逐面清理环、转换坐标、投影和三角剖分，贴地面也计算了贴地填充不会读取的三角形索引。需要同时减少无用几何计算、缩短主线程连续占用时间，改善加载和切换瓦片时的帧间隔。

## What Changes

- 仅优化 `type: "fill"` 且 `useBufferPrimitive: true` 的面填充，包括既有 fill 支持的成面线输入。
- 贴地面保留有效外环、洞和三维坐标，跳过切平面投影、三角剖分及三角缓冲分配；非贴地面继续保留现有投影、三角剖分、椭球细分和高度语义。
- 在既有解码 Worker 中准备 BufferPolygon 几何，以可转移的连续 TypedArray 返回；主线程消费结果，不重复执行面几何算法。
- 同一次瓦片任务中，几何参数相同的样式层复用准备结果；颜色、显隐及 feature-state 更新继续复用现有集合。
- 面集合填充按帧限制工作量，未完成时保留既有祖先或旧 bucket；完成后通过现有 ready、预热和替换流程提交。
- 保留现有轮廓路径，仅在未配置 outline 时省去面桶额外的轮廓中间数据；线图层、轮廓线几何和 BufferPolyline 迁移留待后续变更。
- 补充 Worker 几何、跨帧就绪、取消及版本隔离测试，使用现有 benchmark 验证构建耗时、长任务和帧间隔。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `vector-tile-buffer-polygon-rendering`：增加面几何 Worker 准备、贴地无三角形、任务内复用及分帧填充要求，明确异步构建的就绪、取消与诊断边界。

## Impact

- Demo：`createDecodeVectorTileTask.js`、`decodeVectorTile.js`、`VectorTileDecoder.js`、面几何准备模块、`VectorTileBufferPolygonBucket.js`、`VectorTileBufferPolygonPrimitive.js`、`VectorTileGeometryPlacementUtils.js`、桶工厂和必要的图层生命周期接入。
- 验证：面桶及 Worker 测试、样式重建与 LOD 就绪回归、现有 `createVectorTileBenchmark.js` 的阶段统计，以及 Demo README。
- 沿用现有 TaskProcessor、PBF 缓存、调度器和四叉树 coverage 规则，不增加生产依赖，不经过 GLB/Model/3DTileset，不修改引擎公共接口。
- 原有 fill/line bucket 和线渲染后端不在本次改动范围内；面轮廓的视觉和样式契约必须保持。
