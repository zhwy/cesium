## 背景

`Apps/Demos/LoadVectorTile` 目前已经具备样式文档解析、`VectorTileStyleRule`、轻量级 `VectorTilePrimitiveBucket`，以及专门的 `VectorTileSymbolBucket`。瓦片生命周期本身在 `VectorTileLayer` 中运转正常，但同一个文件仍然承担了大量线和面的渲染细节，包括 geometry instance 构建、贴地 primitive 选择、packed 线回退、polygon hierarchy 创建、fill outline 裁剪、paint 求值和诊断统计。

当前的 symbol 路径已经更清晰一些：`VectorTileLayer` 会把 symbol 样式规则路由到 `VectorTileSymbolBucket`，由 bucket 创建 Cesium `BillboardCollection` 和 `LabelCollection`。这条路径也正好可以作为线和面拆分成几何类型 bucket 的参照模型。

Cesium 对这次需求里的点样式也有现成支持：label 背景、CSS 字体、水平和垂直原点、像素偏移，以及 billboard 的宽高，都能直接通过 collection item 配置表达出来。因此这些能力可以直接在 symbol bucket 内完成映射，不需要修改解码器、source provider 或样式文档归一化模型。

## 目标 / 非目标

**目标：**

- 为 symbol 增加 Cesium 导向的文字背景、字体、文字锚点、文字偏移、图标锚点、图标偏移、图标宽度和图标高度配置。
- 保持新样式值继续兼容现有 symbol 字段已经支持的表达式求值模型。
- 将线 primitive 构建迁移到从 `VectorTilePrimitiveBucket` 派生的 `VectorTileLineBucket`。
- 将面 primitive 构建迁移到从 `VectorTilePrimitiveBucket` 派生的 `VectorTileFillBucket`。
- 让 `VectorTileLayer` 聚焦于瓦片生命周期、decode/build 调度、缓存状态和样式规则路由。
- 为 demo 用户提供完整的样式配置说明文档。
- 保持 legacy `styles` 行为和现有 style document 行为不变。

**非目标：**

- 不实现完整的 Mapbox symbol layout 兼容。
- 不实现 symbol 碰撞避让、去重排布、沿线文字、复杂文本 shaping 或 sprite atlas 打包。
- 不改变 worker 解码输出结构。
- 不改变 URL/provider/cache 语义。
- 不把这套 demo 代码直接提升为 Cesium engine 的公开 API。

## 关键决策

### 决策 1：在 `VectorTileSymbolBucket` 中解释新的 symbol 字段

`VectorTileSymbolBucket` 继续独占点渲染职责。新增的 layout 和 paint 字段在创建 billboard 与 label option 时求值：

- `layout["text-font"]`：映射到 Cesium `Label.font` 的 CSS 字体字符串。
- `layout["text-font-family"]`：当未提供 `text-font` 时，作为与 `text-size` 组合使用的可选字体族回退。
- `layout["text-anchor"]`：映射到 Cesium `HorizontalOrigin` 和 `VerticalOrigin`。
- `layout["text-offset"]`：映射到 Cesium `Cartesian2` 像素偏移。
- `paint["text-background-color"]`：启用 `Label.showBackground`，并映射到 `backgroundColor`。
- `paint["text-background-padding"]`：映射到 `Label.backgroundPadding`。
- `layout["icon-anchor"]`：映射到 Cesium `HorizontalOrigin` 和 `VerticalOrigin`。
- `layout["icon-offset"]`：映射到 Cesium `Cartesian2` 像素偏移。
- `layout["icon-width"]` 和 `layout["icon-height"]`：映射到 `Billboard.width` 和 `Billboard.height`。

原因：这些字段本质上都是渲染期配置，不是解码期配置。把它们留在 bucket 内可以避免把样式解析和 Cesium collection option 细节耦合在一起。

考虑过的备选方案：在 `VectorTileStyle.js` 里统一规范化所有 symbol option。这样只会让 style layer 对象变得更重，Cesium 枚举翻译仍然要在别处处理，整体上并没有更简单。

### 决策 2：使用一套小型锚点翻译辅助函数，供 label 和 billboard 共用

锚点接受字符串形式，例如 `center`、`left`、`right`、`top`、`bottom`、`top-left`、`top-right`、`bottom-left`、`bottom-right`。辅助函数将其翻译为：

- `Cesium.HorizontalOrigin.LEFT | CENTER | RIGHT`
- `Cesium.VerticalOrigin.TOP | CENTER | BOTTOM`

如果没有显式提供锚点，label 可以继续沿用当前较稳定的默认行为，尽量避免视觉回归。

原因：具名锚点比直接暴露 Cesium 枚举值更容易文档化，也更容易测试。

考虑过的备选方案：在配置里直接使用 Cesium 枚举名。这样会让 style document 过度依赖 Cesium 内部表示，不够稳妥。

### 决策 3：拆出 line 和 fill bucket，但不改变 vector tile primitive 的存储形状

新的 bucket 仍然保持 `bucket.id`、`bucket.type`、`bucket.sourceLayer` 和 `bucket.primitives` 这些对外结构。`VectorTileLayer` 继续用 `vectorTile.primitives[bucket.id] = bucket.primitives` 存储结果，这样缓存淘汰、LOD 渲染和 primitive 销毁路径都不用大改。

新的构建流转为：

```text
VectorTileLayer._createPrimitiveBucket()
  ├─ fill   -> new VectorTileFillBucket(...).build(polygons, zoom, tileContext)
  ├─ line   -> new VectorTileLineBucket(...).build(lines, zoom)
  └─ symbol -> new VectorTileSymbolBucket(...).build(points, zoom)
```

原因：这样可以按几何类型隔离渲染行为，同时把对其他瓦片生命周期代码的影响降到最低。

考虑过的备选方案：直接把 primitive map 改成 bucket 实例集合。长期看也许更整洁，但会连带改动 render submission 和 cache destruction，超出这次变更的需要。

### 决策 4：把共享 bucket helper 提取到工具模块

当前内嵌在 `VectorTileLayer` 里的 helper，要么跟着 bucket 迁走，要么进入共享工具模块。适合抽成共享模块的包括：

- 样式值求值；
- 样式颜色求值；
- vector style expression 检测；
- style rule 高度偏移；
- 贴地路径判断和相关诊断 helper；
- primitive 工厂 helper；
- Cartesian 线/环转换；
- polygon outline 线段提取。

原因：线和面 bucket 会共享不少逻辑，尤其是线段转换和 primitive 创建。用一个小型工具模块可以避免 bucket 之间再互相依赖。

考虑过的备选方案：在每个 bucket 中复制 helper。短期实现会快一点，但 terrain 行为和诊断逻辑很容易逐渐漂移。

### 决策 5：packed line 后端归属于 line bucket

packed 线是一种线渲染优化，因此 `VectorTileLineBucket` 负责：

- 检查 `renderBackend === "packed"`；
- 在 picking 或表达式使 packed 路径不安全时拒绝使用 packed；
- 先按 style rule 过滤线；
- 构建合并后的 polyline geometry；
- 记录 packed line 相关诊断指标。

原因：`VectorTileLayer` 不需要知道某条线最终为什么选择 packed 或 instances，它只需要拿到 primitive 结果。

考虑过的备选方案：继续把 packed 路径保留在 `VectorTileLayer` 里作为特例。这会立刻削弱 bucket 边界。

### 决策 6：把样式说明放到独立参考文档中

新增 `Apps/Demos/LoadVectorTile/STYLE.md`，并从 `README.md` 链接过去。新文档覆盖：

- 顶层 `styleDocument`；
- `sources`；
- 图层通用字段；
- fill 属性；
- line 属性；
- symbol 属性；
- terrain 行为；
- expressions 与 filters；
- icon 注册方式；
- 完整示例。

原因：README 现在更像架构和使用概览，单独的样式参考文档更适合做完整说明，也更容易维护。

考虑过的备选方案：只扩展 README。这样会让 README 过于膨胀，不利于作为架构概览继续使用。

## 风险 / 取舍

- [风险] 迁移线和面代码时可能引入细微的渲染回归。 -> 缓解：先用聚焦测试覆盖，再保持 primitive map 结构不变。
- [风险] 锚点名称可能被误认为与 Mapbox 的完整锚点语义完全一致。 -> 缓解：文档中明确这是 Cesium 导向的锚点映射，而不是完整 Mapbox 兼容。
- [风险] 新增 symbol 选项会增加逐要素求值成本。 -> 缓解：复用现有表达式求值路径，只对命中的 feature 在本地计算 option。
- [风险] fill outline 裁剪目前依赖 `VectorTileLayer` 内的 tile bounds 和工具函数。 -> 缓解：把 tile context 明确传给 fill bucket，并整体迁移 outline helper。
- [风险] 文档可能和实现逐渐偏离。 -> 缓解：为文档中承诺的 symbol 字段增加测试，并让 STYLE.md 示例与测试数据保持一致。

## 迁移计划

1. 先为 `VectorTileSymbolBucket.test.js` 增加 symbol option 翻译 helper 和相关测试。
2. 提取共享 bucket 工具模块，保证当前运行行为不变。
3. 增加 `VectorTileLineBucket`，并把 line style rule 路由到它。
4. 增加 `VectorTileFillBucket`，并把 fill style rule 路由到它。
5. 删除 `VectorTileLayer` 中已经废弃的 line/fill primitive 构建方法。
6. 增加或更新 bucket 路由、packed line 回退、fill outline 创建和 symbol 选项相关测试。
7. 新增 `STYLE.md`，并从 `README.md` 建立链接。

回滚方式比较直接，因为对外 style document 和 legacy `styles` API 都不变。如果某一步 bucket 拆分引入回归，可以临时把对应几何类型重新路由回 `VectorTileLayer` 中原有实现，再单独修复 bucket。

## 待确认问题

- 文档中是否只暴露 `text-font` 一个字体字段，还是也对外支持 `text-font-family` 这种更适合和 `text-size` 组合的配置？
- 锚点偏移是否直接采用 CSS 屏幕坐标语义，还是让正 Y 遵循地图样式里“向上为正”的语义？实现时需要选定一种并在文档中写清楚。
