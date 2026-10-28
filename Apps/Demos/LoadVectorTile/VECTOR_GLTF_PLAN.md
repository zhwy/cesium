# Vector glTF 后端实现计划

目标：在 `LoadVectorTile` 内，用 Cesium 的 `buildVectorGltfFromMVT` + `VectorGltf3DTileContent` + `Cesium3DTileset` 加载线、面，与现有 Primitive 后端做公平的性能对比；点（circle/symbol）继续走现有 Billboard/Label 路径。

## 1. 约束

1. **不修改 `packages/` 下任何 Cesium 源码。** 所有新增代码都在 `Apps/Demos/LoadVectorTile/` 内。
2. 不再使用引擎的 `MVTDataProvider.fromUrl`，改用 demo 自己的 provider，因为：
   - 它不支持 `{-y}`（TMS）和 WMTS；
   - 它的瓦片树一次性生成，没有节点数保护；
   - 它没有样式、filter、zoom、属性裁剪的下推点。
3. 点要素继续走现有 `VectorTileCircleBucket` / `VectorTileSymbolBucket` / `SharedPointCollections`。
4. 首期只服务于 benchmark 对比，不接入 `VectorTileLayerManager` 的样式热更新、feature-state 和拾取。

## 2. 已确认的事实

| 事实                                                                                                                                                                                                               | 来源                                    | 影响                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------- |
| `buildVectorGltfFromMVT`、`decodeMVT`、`VectorGltf3DTileContent`、`Empty3DTileContent`、`Cesium3DTileset`、`Cesium3DTileStyle` 都从 `packages/engine/index.js` 导出                                                | `packages/engine/index.js`              | demo 可以直接组合，不需要改引擎                               |
| `buildVectorGltfFromMVT(decoded, {tileX,tileY,tileZ}, {featureIdProperty})` 输入是 `{layers:[{name, extent, features:[{type, geometry, properties}]}]}`，几何为瓦片内坐标，`y` 向下                                | `buildVectorGltfFromMVT.js`             | 可以在调用前自己过滤、裁剪、拆分                              |
| 每个 layer 一个 glTF node，要素属性里自动写入 `_layer = layer.name`                                                                                                                                                | 同上                                    | 可用合成 layer 名承载 style rule id                           |
| 自动 feature id 以要素对象身份为 key；`featureIdProperty` 以属性值为 key，且属性表 first-seen wins                                                                                                                 | 同上                                    | 同一要素被多条 rule 命中时必须克隆，见 4.2                    |
| 瓦片内容由 `tileset._runtimeContentCodec = {createContent, missingTilePolicy}` 接管                                                                                                                                | `Cesium3DTile.js`、`Cesium3DTileset.js` | 可以在 demo 里自己设置，无需继承引擎 provider                 |
| `MVTDataProvider` 的 tileset 配置：`skipLevelOfDetail:false`、`enablePick:true`、`featureIdLabel:"featureId_0"`、`instanceFeatureIdLabel:"instanceFeatureId_0"`、`_modelUpAxis=Axis.Z`、`_modelForwardAxis=Axis.X` | `MVTDataProvider.js`                    | 原样复刻                                                      |
| `Cesium3DTileset.fromUrl` 支持 `heightReference` + `scene` 贴地                                                                                                                                                    | `Cesium3DTileset.js`                    | 贴地可作为后续选项                                            |
| `VectorGltf3DTileContent.applyStyle(style)` 只调用 `style.show/color/lineWidth.evaluate(feature, result)`                                                                                                          | `VectorGltf3DTileContent.js`            | 可用鸭子类型样式对象复用 demo 的表达式引擎，需先做 spike 验证 |
| demo 已有 `VectorTileStyleExpressionUtils.evaluateVectorStyleFilter(filter, feature, {zoom, level})`                                                                                                               | `VectorTileStyleExpressionUtils.js`     | filter、zoom 下推可直接复用                                   |
| 引擎的 `buildVectorGltfFromMVT.js` 有 `@cesium/core` 等裸模块导入，import map 在 Worker 中不生效                                                                                                                   | 浏览器限制                              | 首期构建在主线程；Worker 方案见阶段 4                         |
| demo 的 `decodeVectorTile.js` 已在 Worker 中通过 jsDelivr URL 导入 `@mapbox/vector-tile` 和 `pbf`                                                                                                                  | `decodeVectorTile.js`                   | Worker 里可以用 URL 导入第三方库                              |

## 3. 总体结构

```text
VectorGltfTilesetProvider
  ├── buildTilesetJson()                 自建瓦片树（extent、min/maxZoom、{-y}、节点数上限）
  ├── Cesium3DTileset.fromUrl(blobUrl)   与 MVTDataProvider 相同的加载选项
  └── tileset._runtimeContentCodec
        createContent(tileset, tile, resource, arrayBuffer)
          1. decodeMVT(arrayBuffer)
          2. 解析 z/x/y（处理 {-y}）
          3. prepareDecodedTileForStyle()      样式下推（图层、filter、zoom、属性、几何类型）
          4. buildVectorGltfFromMVT(...)
          5. VectorGltf3DTileContent.fromGltf(...)
          点：6. 交给现有 point bucket（阶段 3）
```

新增文件：

| 文件                                                                                   | 职责                                                                                                                            |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/VectorGltfTilesetProvider.js`                                                     | 创建 tileset、实现 `update/prePassesUpdate/postPassesUpdate/updateForPass/destroy`，生命周期同 `UrlTemplate3DTilesDataProvider` |
| `src/VectorGltfTilesetJsonBuilder.js`                                                  | 生成瓦片树 JSON，纯函数，可在 Node 测试                                                                                         |
| `src/prepareDecodedTileForStyle.js`                                                    | 把 `decodeMVT` 的结果按 style rule 过滤、拆分、裁剪属性，纯函数，可在 Node 测试                                                 |
| `src/VectorGltfStyleAdapter.js`                                                        | style rule → 鸭子类型样式对象（阶段 2）                                                                                         |
| `test/VectorGltfTilesetJsonBuilder.test.js`、`test/prepareDecodedTileForStyle.test.js` | 轻量 Node 测试，沿用 `test/` 现有风格                                                                                           |

## 4. 关键设计

### 4.1 瓦片树

- 输入：URL 模板、`minZoom`、`maxZoom`、`extent`（弧度）。
- 节点：`region` 包围体，高度范围与引擎一致（-1000 ~ 10000）；`refine: "REPLACE"`；`geometricError = 地球周长 / (2^level * 256)`，末级为 0，与现有 Web Mercator 误差公式一致。
- URL：支持 `{z}`、`{x}`、`{y}`、`{-y}`、`{reverseY}`。
- **节点数上限（必须）**：先按各层 tile range 累加估算，超过上限（默认 50,000）就抛错，不生成 JSON。
- `maxZoom` 由调用方按视野截断，沿用 benchmark 里已有的 `chooseMaxZoom`。
- 对 `{-y}`：URL 里用翻转后的 `y`，但调用 `buildVectorGltfFromMVT` 时必须传回 XYZ 的 `y`，也就是 TMS 与 XYZ 在两处各转一次。

### 4.2 样式下推 `prepareDecodedTileForStyle`

输入：`decodeMVT` 的结果、瓦片 `z`、该 source 的 style rules（fill/line，仅启用的）。
输出：新的 `DecodedVectorTile`，每条 rule 对应一个合成 layer。

规则：

1. 按 `rule.sourceLayer` 取原 layer；没有对应 layer 或 rule `visibility === false` 则跳过。
2. zoom 过滤：`rule.minzoom` / `rule.maxzoom` 与瓦片层级 `z` 比较。使用瓦片层级作为样式缩放级别，与 demo 的 style zoom 对齐方式需在对比时记录，避免两边口径不同。
3. filter：对每个要素调用 `evaluateVectorStyleFilter(rule.filter, feature, {zoom: z, level: z})`，不通过则丢弃。
4. 几何类型映射（与 `VectorTileGeometryPlacementUtils` 一致）：
   - `fill`：保留 Polygon；LineString 按“强制闭合的单环面”处理。
   - `line`：保留 LineString；Polygon 的各环转成 LineString，对应现有“polygon 自动 outline”。
   - `fill-outline-color` 存在时，额外为该 rule 生成一个外环线 layer，rule id 加后缀 `#outline`。
   - Point 不进入 glTF。
5. **一要素多 rule**：每条 rule 克隆一份要素对象，不共享引用，避免自动 feature id 共用，导致 `_layer` 只保留 first-seen。克隆要素的 `properties` 增加：
   - `_fid`：`${ruleId}:${原 id 或要素序号}`，作为 `featureIdProperty`，保证 id 唯一；
   - `_id`：原始 feature id（promoteId 或 PBF 原生 id），供后续拾取和 feature-state 使用。
6. 属性裁剪：只保留 rule 的 filter、paint、layout 表达式依赖的属性，加上 `pickProperties`、`_fid`、`_id`。依赖收集复用 `VectorTilePropertyProjectionUtils` 和 `collectVectorStylePropertyDependencies`。
7. 合成 layer 的 `name = rule.id`（outline 为 `${rule.id}#outline`），`extent` 沿用原 layer。
8. 瓦片裁剪：阶段 1 可跳过，阶段 2 评估复用 `VectorTileGeometryUtils` 的裁剪函数，对瓦片内坐标做 `[0, extent]` 裁剪，避免半透明面在边缘重叠。

### 4.3 内容创建

```text
createContent(tileset, tile, resource, arrayBuffer):
  decoded  = decodeMVT(arrayBuffer)
  coords   = parseTileCoordinates(resource.getUrlComponent(true))   // 处理 {-y} 翻转
  prepared = prepareDecodedTileForStyle(decoded, coords.tileZ, rules)
  glb      = buildVectorGltfFromMVT(prepared, coords, { featureIdProperty: "_fid" })
  if !glb: return Empty3DTileContent
  return VectorGltf3DTileContent.fromGltf(tileset, tile, resource, glb)
```

- 404/204 作为 `missingTilePolicy`，与引擎一致。
- 记录诊断：解码要素数、过滤后要素数、glb 字节数、三个阶段的耗时，接入已有 `VectorTileDiagnostics`。

### 4.4 样式（阶段 2）

- 按合成 layer 名（即 `_layer`）区分 rule。
- 先做 **spike S1**：用鸭子类型对象 `{show:{evaluate}, color:{evaluate}, lineWidth:{evaluate}}` 赋给 `tileset.style`，确认 `Cesium3DTileset` 的 style setter 和 `tile.applyStyle` 不依赖 `Cesium3DTileStyle` 的其他成员（例如 `ready`、`style.meta`）。
  - 通过：直接用 demo 的 `evaluateVectorStyleValue` 对每个要素求值，完整保留 Mapbox 表达式、zoom 表达式。
  - 不通过：退化为把常量颜色/线宽翻译成 `Cesium3DTileStyle` 的 `conditions`，表达式只支持常量和 `case/get` 简单子集，不支持的先报错。
- 要素读取：适配器里把 `Cesium3DTileVectorFeature` 包成 `{properties, id}`，供表达式引擎使用。
- 颜色统一用 `Color.fromCssColorString`，与 Primitive 后端保持一致。

### 4.5 点要素（阶段 3）

- 组合 content：包装 `VectorGltf3DTileContent`，转发 `update/destroy/ready/featuresLength` 等接口，并持有该瓦片的点 bucket。
- 点只在 `tile._selectedFrame === frameState.frameNumber` 时参与提交，与 REPLACE 语义一致，避免父子重复。
- 点数据来源：demo 现有 Worker 解码的点数组，沿用 `SharedPointCollections` 的版本化瓦片 key。

## 5. Benchmark 改造（`createVectorTileBenchmark.js`）

1. `createVectorGltfBackend` 改用 `VectorGltfTilesetProvider`，保留现有 `extent` 与 `chooseMaxZoom` 的做法。
2. **工作量对齐是前提**，对比结果里新增并必须检查：
   - 两边的解码要素数、过滤后要素数、请求数；
   - 每个层级的瓦片数；
   - 偏差超过 10% 时，在结果里给出 `workloadMismatch` 警告，不输出 ratios 结论。
3. 超时改为 `setTimeout` 驱动，不再依赖渲染帧，避免标签页节流时误判。
4. 运行前检查 `document.visibilityState === "visible"`，不可见则拒绝运行。
5. 增加按要素折算的指标：`longTasks.totalMs / 过滤后要素数`、`loadMs / 过滤后要素数`。
6. 保留现有 draw command、堆内存、网络请求数的采样。贴地对比时给两边同时配置，或在结果里明确标注未贴地。

## 6. 阶段与验收

| 阶段      | 内容                                                                                                                                                         | 验收                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| 0         | 还原对引擎源码的全部改动；`git diff -- packages/` 为空                                                                                                       | 通过                                                            |
| 1         | `VectorGltfTilesetJsonBuilder`、`prepareDecodedTileForStyle`（图层、filter、zoom、几何映射、属性裁剪）、provider、内容创建、benchmark 切换；常量颜色         | 在相同相机下两边解码要素数偏差 ≤ 10%；页面不卡死；Node 单测通过 |
| 2         | 样式适配（spike S1）、outline、瓦片裁剪、贴地选项                                                                                                            | 视觉与 Primitive 后端一致（颜色、outline、filter）              |
| 3         | 点要素组合 content                                                                                                                                           | 点与线面同屏，REPLACE 时无重复点                                |
| 4         | 把 decode、filter、裁剪、三角化、GLB 构建迁到 demo 自己的模块 Worker：以 `decodeVectorTile.js` 为基础，用 URL 导入 earcut，写不依赖 Cesium 裸模块的 GLB 构建 | 主线程长任务总时长显著下降，需以阶段 1 的数据为基线             |
| 5（可选） | 接入 `VectorTileLayerManager`：样式热更新、feature-state、拾取                                                                                               | 另行评估                                                        |

## 7. 风险

1. **私有 API 依赖**：`tileset._runtimeContentCodec`、`_modelUpAxis`、`_modelForwardAxis` 属于内部字段，Cesium 升级时需要回归。需要在 provider 文件头集中标注。
2. **瓦片树一次性生成**：大范围、深层级时节点数会爆炸，只能靠 `extent`、`maxZoom` 和上限保护。
3. **主线程成本**：阶段 1 的 decode、三角化、GLB 构建都在主线程，对比结果会偏不利于 vector glTF。阶段 4 之前不能把阶段 1 的数据当成最终结论。
4. **样式口径**：Primitive 后端按 demo 的 style zoom 过滤，vector glTF 按瓦片层级过滤，两者不一致会导致工作量偏差，对比时要把这一点记录在结果里。
5. **属性表过大**：glTF 里的属性表按要素全量写入，属性裁剪不到位会明显增加内存。
6. **feature id**：`_fid` 方案会让同一原始要素在不同 rule 下拥有不同的 id，后续做 feature-state 时需要通过 `_id` 反查。

## 8. 不在范围内

- 修改 `packages/` 下的任何文件；
- 惰性瓦片树（隐式瓦片）；
- `symbol-placement: "polygon-center"`、碰撞避让等符号能力；
- 与 `VectorTileLayerManager` 的完整集成（阶段 5 另行评估）。
