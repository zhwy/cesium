## 1. 样式文档模型与兼容入口

- [x] 1.1 新增 `VectorTileStyle` 模块，定义 style document 的解析、默认值填充和基础校验。
- [x] 1.2 支持 `sources` 和 `layers` 顶层字段，校验 layer id 唯一、source 引用存在、type 合法。
- [x] 1.3 新增旧版 `styles` 到 style document 的兼容转换函数。
- [x] 1.4 在 `VectorTileLayerManager` 中新增 `setStyle(styleDocument)` 和 `getStyle()` API。
- [x] 1.5 保持 `manager.addLayer({ url, styles })` 旧调用路径可用，并通过兼容转换接入新模型。
- [x] 1.6 明确外部配置可使用 `sources/layers` 命名，但内部实现类名采用 Cesium 风格的 Provider、StyleRule、PrimitiveBucket。
- [x] 1.7 验证：运行 style document 解析/校验测试，覆盖合法配置、重复 layer id、缺失 source、旧版 `styles` 兼容转换；运行 `npx prettier --check` 和 `openspec validate --changes add-vector-style-document`。

## 2. DataProvider 与 StyleRule 分离

- [x] 2.1 新增 `VectorTileDataProvider`，封装 provider、tile availability、请求、解码和 source cache。
- [x] 2.2 新增 `VectorTileStyleRule`，封装外部 layer 配置规范化后的 id、type、source、sourceLayer、filter、paint、layout、terrain 和 visibility。
- [x] 2.3 调整 manager 内部结构，使多个 `VectorTileStyleRule` 可以共享同一个 `VectorTileDataProvider`。
- [x] 2.4 调整瓦片绑定逻辑，使 quadtree tile 以 data provider tile 为数据加载单位。
- [x] 2.5 保持现有 LOD 稳定渲染集合在 DataProvider/StyleRule 分离后仍能正确引用和释放 tile。
- [x] 2.6 验证：使用同一 source 的 fill/line 两个 style rule 加载同一视图，确认网络请求和基础解码只发生一次；确认旧 `manager.addLayer({ url, styles })` 示例仍能渲染；运行 LOD 选择相关测试和 `openspec validate --changes add-vector-style-document`。

## 3. 表达式与过滤

- [x] 3.1 新增 `VectorStyleExpression`，支持常量、`get`、`has`、比较、`all`、`any`、`case`、`match`、`zoom` 和线性 `interpolate`。
- [x] 3.2 新增 `VectorStyleFilter`，基于可序列化表达式计算每个 feature 是否进入 style rule，并显式拒绝函数 filter。
- [x] 3.3 为表达式增加单元测试，覆盖属性取值、分类设色、复合条件和 zoom 插值。
- [x] 3.4 调整 worker 解码参数，使其可以接收 style rule 描述并按 `sourceLayer + filter + geometryType` 生成结果。
- [x] 3.5 在 filter 或表达式不支持 worker 执行时，回退到主线程建桶前过滤，并记录诊断信息。
- [x] 3.6 验证：运行表达式与过滤测试，覆盖 `get`、`has`、比较、`all`、`any`、`case`、`match`、`interpolate`、函数 filter 拒绝；手动加载带 filter 的样式确认要素数量减少；运行 `openspec validate --changes add-vector-style-document`。

## 4. Fill 与 Line 渲染桶

- [x] 4.1 新增 `VectorTilePrimitiveBucket` 通用结构，用于按 style rule 管理 primitives/collections。
- [x] 4.2 将现有 polygon 创建逻辑迁移为 `fill` bucket，支持 `fill-color`。
- [x] 4.3 为 `fill` bucket 增加 outline 子桶，支持 `fill-outline-color` 和 `fill-outline-width`。
- [x] 4.4 将现有 polyline 创建逻辑迁移为 `line` bucket，支持 `line-color` 和 `line-width` 表达式。
- [x] 4.5 保留 packed line 后端，并明确其在动态属性、拾取和表达式上的降级行为。
- [x] 4.6 为 polygon 记录默认不贴地行为，并为 `terrain.clampToGround: true` 准备 `GroundPrimitive` 渲染路径。
- [x] 4.7 验证：分别加载 fill、fill outline、line、packed line 示例，确认颜色/线宽生效、拾取策略符合预期、无父子 LOD 重叠回归；运行相关几何桶测试、格式检查和 `openspec validate --changes add-vector-style-document`。

## 5. Symbol 点渲染

- [x] 5.1 扩展解码输出，确保点要素的坐标、metadata 和 properties 能用于 symbol bucket。
- [x] 5.2 新增 `VectorTileSymbolBucket`，支持基于点要素创建 `BillboardCollection`。
- [x] 5.3 为 `VectorTileSymbolBucket` 增加 `LabelCollection` 文字渲染。
- [x] 5.4 支持 `layout["icon-image"]`、`layout["icon-size"]`、`layout["text-field"]` 和 `layout["text-size"]`。
- [x] 5.5 支持 `paint["text-color"]`、`paint["text-halo-color"]` 和 `paint["text-halo-width"]`。
- [x] 5.6 增加图标资源注册或解析入口，第一阶段支持 URL、`HTMLImageElement` 和 `HTMLCanvasElement`。
- [x] 5.7 验证：加载包含点要素的 PBF，分别确认 icon-only、text-only、icon+text 三种 symbol layer 可显示；确认 URL/Image/Canvas 图标资源可解析；运行 symbol bucket 测试、格式检查和 `openspec validate --changes add-vector-style-document`。

## 6. 3D 贴地与高度偏移

- [x] 6.1 在 style rule 上解析 `terrain.clampToGround` 和 `terrain.heightOffset`。
- [x] 6.2 在线、面、symbol bucket 中统一应用 `heightOffset`。
- [x] 6.3 为 `clampToGround` 选择各几何类型的 Cesium 渲染路径，polygon 贴地优先使用 `GroundPrimitive`，并记录不支持组合的降级行为。
- [x] 6.4 更新 README，说明贴地与高度偏移在不同几何类型上的效果差异。
- [x] 6.5 验证：手动对比 polygon 默认不贴地、`clampToGround: true`、不同 `heightOffset` 的显示效果；确认线和 symbol 的高度偏移没有破坏拾取和 LOD 稳定；运行相关测试、格式检查和 `openspec validate --changes add-vector-style-document`。

## 7. Demo、文档与验证

- [x] 7.1 更新 `index.html`，增加一个使用新 style document 的示例。
- [x] 7.2 更新 `Apps/Demos/LoadVectorTile/README.md`，用中文说明外部 `sources/layers` 配置与内部 Provider/StyleRule/PrimitiveBucket 的整体框架。
- [x] 7.3 增加或更新测试，覆盖旧 `styles` 兼容、新 style document 校验、表达式、filter 和 LOD 渲染集合。
- [x] 7.4 运行格式化和相关测试，确认现有 demo 旧配置仍可加载，新配置能够渲染 fill/line/symbol。
- [x] 7.5 验证：完整跑一遍最终回归，包括 OpenSpec 校验、格式检查、相关单元测试、旧配置 Demo、新 style document Demo、点渲染 Demo 和 LOD 稳定渲染观察；记录任何未解决限制到 README。
