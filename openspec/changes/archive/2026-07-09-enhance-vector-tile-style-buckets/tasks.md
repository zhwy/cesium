## 1. 点样式扩展

- [x] 1.1 为 `center`、`left`、`right`、`top`、`bottom`、`top-left`、`top-right`、`bottom-left`、`bottom-right` 增加锚点翻译 helper。
- [x] 1.2 增加 symbol 偏移 helper，把 `[x, y]` 风格的样式值转换为 Cesium `Cartesian2` 像素偏移。
- [x] 1.3 为有限数值的 `icon-width`、`icon-height` 和 padding 值增加安全回退的数值 helper。
- [x] 1.4 更新 `VectorTileSymbolBucket` 的 label 创建逻辑，支持 `text-font`、`text-font-family`、`text-anchor`、`text-offset`、`text-background-color` 和 `text-background-padding`。
- [x] 1.5 更新 `VectorTileSymbolBucket` 的 billboard 创建逻辑，支持 `icon-anchor`、`icon-offset`、`icon-width` 和 `icon-height`。
- [x] 1.6 扩展 `VectorTileSymbolBucket.test.js`，覆盖文字字体、背景、锚点、偏移、图标尺寸、表达式求值和非法数值回退。

## 2. 共享 Bucket 工具

- [x] 2.1 创建共享 bucket 工具模块，承载样式值求值、颜色求值、表达式检测、terrain helper 和 primitive 工厂 helper。
- [x] 2.2 将 Cartesian 线/环转换 helper 从 `VectorTileLayer` 移出，放到共享工具模块或 bucket 专属模块中。
- [x] 2.3 将 fill outline 线段提取 helper 从 `VectorTileLayer` 移出，同时保持瓦片边界线段跳过逻辑不变。
- [x] 2.4 在适合的地方为共享 helper 增加聚焦测试。

## 3. 线 Bucket 拆分

- [x] 3.1 新增继承 `VectorTilePrimitiveBucket` 的 `VectorTileLineBucket`。
- [x] 3.2 将普通线 geometry instance 创建逻辑迁移到 `VectorTileLineBucket`。
- [x] 3.3 将贴地线 geometry 和 primitive 创建逻辑迁移到 `VectorTileLineBucket`。
- [x] 3.4 将 packed 线后端选择和 packed primitive 创建逻辑迁移到 `VectorTileLineBucket`。
- [x] 3.5 将 `VectorTileLayer._createPrimitiveBucket` 中的 `line` 样式规则路由到 `VectorTileLineBucket`。
- [x] 3.6 增加普通线、贴地线、packed 线启用条件、样式过滤和诊断计数相关测试。

## 4. 面 Bucket 拆分

- [x] 4.1 新增继承 `VectorTilePrimitiveBucket` 的 `VectorTileFillBucket`。
- [x] 4.2 将 polygon fill geometry instance 创建逻辑迁移到 `VectorTileFillBucket`。
- [x] 4.3 将贴地面 primitive 选择和高度偏移回退处理迁移到 `VectorTileFillBucket`。
- [x] 4.4 将 fill outline primitive 创建逻辑迁移到 `VectorTileFillBucket`。
- [x] 4.5 将 `VectorTileLayer._createPrimitiveBucket` 中的 `fill` 样式规则路由到 `VectorTileFillBucket`。
- [x] 4.6 增加 polygon fill、fill outline、瓦片边界 outline 裁剪、terrain 回退和诊断计数相关测试。

## 5. Layer 清理与兼容性

- [x] 5.1 在 bucket 路由已有测试覆盖后，删除 `VectorTileLayer` 中废弃的 line/fill primitive 创建方法。
- [x] 5.2 验证 `VectorTileLayer` 仍然通过 `vectorTile.primitives[bucket.id]` 存储 `bucket.primitives`。
- [x] 5.3 验证 legacy `styles` 转换路径和现有 style document 示例仍然能通过新 bucket 正常渲染。
- [x] 5.4 运行现有 LoadVectorTile 的 Node 测试并修复回归。

## 6. 文档

- [x] 6.1 新增 `Apps/Demos/LoadVectorTile/STYLE.md`，完整说明 style document、source、layer、fill、line、symbol、terrain、expression、filter 和 icon 注册方式。
- [x] 6.2 补充一个完整 style document 示例，覆盖 fill、line、icon、label、背景、锚点、尺寸、表达式、过滤和 terrain。
- [x] 6.3 更新 `README.md`，链接 `STYLE.md`，并让 README 保持为架构与使用概览。
- [x] 6.4 更新已知限制，明确 symbol 的锚点、背景和尺寸已支持，而碰撞避让和沿线文字仍然不在本次范围内。
