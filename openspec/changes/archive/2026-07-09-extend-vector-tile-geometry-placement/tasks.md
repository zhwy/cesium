## 1. 几何放置模型

- [x] 1.1 添加共享辅助函数，将样式规则映射为所需的 MVT 几何类型。
- [x] 1.2 支持 `layout["symbol-placement"]` 归一化，并将默认值设为 `point`。
- [x] 1.3 添加 polygon center 适配器，将已解码 polygon 转换为 points-like 的位置和元数据。
- [x] 1.4 为几何类型映射和 polygon center 计算添加测试，覆盖退化 polygon 情况。

## 2. 解码与过滤

- [x] 2.1 更新 worker 解码过滤逻辑，使 `symbol-placement: "polygon-center"` 保留匹配的 polygon 要素。
- [x] 2.2 更新 worker 解码过滤逻辑，使 `type: "line"` 同时保留匹配的 line 和 polygon 要素。
- [x] 2.3 更新主线程样式过滤回退逻辑，复用共享的几何类型映射。
- [x] 2.4 添加测试，覆盖点 symbol、polygon-center symbol、线数据源、polygon outline 数据源和混合数据源过滤。

## 3. Bucket 构建

- [x] 3.1 更新 `VectorTileBucketFactory`，将 `symbol-placement: "point"` 路由到现有点 symbol 行为。
- [x] 3.2 更新 `VectorTileBucketFactory`，将 `symbol-placement: "polygon-center"` 通过 polygon center 适配器接入现有 symbol bucket。
- [x] 3.3 扩展 `VectorTileLineBucket`，使其接收 polygon 数据，并使用 line paint 字段创建 polygon outline 线实例。
- [x] 3.4 复用现有 outline 线段生成逻辑，保持瓦片边界重复 outline 抑制行为一致。
- [x] 3.5 为新增派生几何保留 terrain 处理、picking id、diagnostics 和 primitive 存储结构。

## 4. 文档

- [x] 4.1 更新 `STYLE.md`，说明 `symbol-placement: "point"` 和 `symbol-placement: "polygon-center"`。
- [x] 4.2 更新 `STYLE.md`，说明 `line` 图层会自动将 polygon 要素绘制为 outline。
- [x] 4.3 记录 `clipToTile: true` 下 polygon-center 的语义，以及可能出现跨瓦片重复标注的限制。
- [x] 4.4 如果新增 source 或测试文件，更新 README 中的模块和测试列表。

## 5. 验证

- [x] 5.1 为 polygon-center 文字和图标补充或更新 symbol bucket / factory 测试。
- [x] 5.2 为使用 `line-color` 和 `line-width` 绘制 polygon outline 补充或更新 line bucket 测试。
- [x] 5.3 运行 `Apps/Demos/LoadVectorTile/test/*.test.js` 下的全部测试。
- [x] 5.4 运行 OpenSpec status/instructions 检查，确认所有任务都可被追踪。
