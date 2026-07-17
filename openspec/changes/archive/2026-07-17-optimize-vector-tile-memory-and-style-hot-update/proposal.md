## Why

当前矢量瓦片 `instances` 渲染路径会为每个 GeometryInstance、Billboard 和 Label 长期保留包含完整 properties 的拾取 ID，并为同一 source 的所有 zoom 样式桶创建渲染资源；`setLayerStyle()` 即使只修改颜色或显隐也会推进整个 source 的内容代并重新解码、建桶，导致较高的稳定内存和样式刷新峰值。现有 manager 级 PBF 内存缓存已经能够避免多数重复网络请求，因此现在可以在保持数据可复用的前提下压缩运行时状态并引入细粒度样式热更新。

## What Changes

- 使用 Primitive 内数字 instance id 和瓦片级紧凑 feature table 取代每个渲染对象上的完整 metadata 拾取 ID，并新增 `manager.resolvePickedFeature(picked)` 解析公开拾取结果。
- 为 vector source 新增 `pickProperties`：未配置时保留全部属性以保持拾取信息完整；字符串数组只保留指定属性；空数组只保留 feature id 和定位信息。
- 从 filter、paint 和 layout 表达式中收集属性依赖，使 Worker 仅向主线程返回渲染和配置拾取所需的属性；后续样式引用未驻留属性时回退到 PBF 重新解码。
- 仅为可见且与瓦片构建 zoom 匹配的样式图层创建 bucket；LOD 祖先回退期间继续使用祖先已经构建的样式，精确瓦片就绪后切换。
- 降低 Demo 的 Cesium surface tile 与单 source 离屏渲染缓存配置，并补充区分当前可见资源、离屏资源和 PBF 驻留的诊断指标。
- 对 `setLayerStyle()` 增加差异分类：line/fill/circle/symbol 支持的颜色和图层显隐变化原地更新，避免清空整个 source 的渲染缓存；不支持原地更新的结构变化继续走重建路径。
- line/fill instances 通过 Cesium per-instance color attribute 更新；packed line 通过 material uniform 更新；circle、billboard 和 label 直接更新现有对象；图层级显隐使用 Primitive/点对象的 `show`，不为此增加逐实例 show attribute。
- 数据驱动颜色表达式仅在依赖属性已驻留时原地求值；透明/不透明渲染状态跨越或缺少依赖属性时重建受影响内容，保证渲染正确性。
- **BREAKING**：逐要素拾取的公开读取入口由 `picked.id.properties` 改为 `manager.resolvePickedFeature(picked)`；返回结果继续包含 feature id、properties、source/style layer 和瓦片定位信息。

## Capabilities

### New Capabilities

- `vector-tile-feature-picking`: 定义紧凑拾取身份、`pickProperties` 属性驻留规则、拾取结果解析和生命周期。
- `vector-tile-style-hot-update`: 定义颜色与显隐差异识别、原地更新、惰性同步和安全重建回退。
- `vector-tile-render-residency`: 定义必要样式桶构建、LOD 回退语义、离屏渲染缓存控制和内存诊断。

### Modified Capabilities

- 无。

## Impact

- 主要影响 `Apps/Demos/LoadVectorTile/src` 下的 Worker 解码、packed layer、各类 bucket、共享点集合、VectorTile 缓存、四叉树提交和 manager 样式更新路径。
- `VectorTileLayerManager` 新增拾取解析 API；source 配置新增 `pickProperties`；Demo 拾取示例需要迁移。
- `setLayerStyle()` 对支持的 paint/visibility 变化不再自动推进整个 runtime layer 的 `contentRevision`，诊断和测试需要区分原地更新、bucket 重建与 source 全量重建。
- 不新增生产依赖，不引入自定义 shader，不持久化 decoded geometry 或 GeometryInstance 引用；继续复用现有 PBF 内存缓存与 Cesium 属性更新 API。
