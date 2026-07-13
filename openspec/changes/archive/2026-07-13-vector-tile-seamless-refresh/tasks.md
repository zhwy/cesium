## 1. 内容代际与缓存隔离

- [x] 1.1 在 `VectorTileLayer` 中增加单调递增的内容版本，并将版本纳入矢量瓦片缓存键，确保同坐标的新旧代返回不同实例
- [x] 1.2 调整所有会改变瓦片输出的 `clearCache` 调用路径，使刷新先推进内容版本、再将旧缓存项标记为 stale，同时允许仍被引用的旧代继续存活
- [x] 1.3 在 `VectorTile` 创建时保存内容版本和规范化样式快照，并让 worker 过滤、主线程过滤及 Bucket 构建统一读取该快照
- [x] 1.4 在异步任务完成与渲染候选收集路径校验目标内容代，确保取消竞争或连续刷新产生的过期瓦片不能接管当前画面

## 2. 无缝渲染状态切换

- [x] 2.1 调整 `VectorTileLayerManager` 的 `layerChanged` 监听：重新失效四叉树绑定，但保留该图层上一代 `committedRenderSet`
- [x] 2.2 调整 `layerShownOrHidden` 监听：隐藏时依赖 `_show` 立即停止绘制且不释放 committed 状态，重新显示时重新绑定当前视口并保留旧覆盖兜底
- [x] 2.3 完善 `VectorTileQuadtreePrimitive` 的代际候选与 coverage 提交逻辑，使旧代保持到当前代 Primitive 实际可绘制，并按区域无重叠地原子接管
- [x] 2.4 保留图层删除、销毁和硬重置路径中的 render state 清理，确保普通刷新与最终销毁使用不同生命周期策略

## 3. 共享点与资源生命周期

- [x] 3.1 让共享点集合 entry key 包含内容代身份，并验证同坐标、同 bucket 的新旧 billboard/label 可以短暂并存
- [x] 3.2 调整跨代提交同步顺序，保证旧代销毁只删除旧 entry，新代 entry 在 render 与 pick pass 中保持一致
- [x] 3.3 验证当前代接管后旧代引用、Primitive、共享点条目和缓存字节全部释放，并处理快速连续刷新遗留的多代 stale 项
- [x] 3.4 在 `VectorTileDiagnostics` 中增加当前内容代、刷新保留瓦片和退役瓦片驻留情况的诊断指标

## 4. 自动化与手工验证

- [x] 4.1 为 `VectorTileCache` 和 `VectorTileLayer` 增加版本化缓存键、同坐标跨代并存、样式快照及显式缓存刷新的单元测试
- [x] 4.2 为 `VectorTileQuadtreePrimitive` 增加旧代覆盖保留、Primitive 未 ready 不切换、当前代区域接管和过期代拒绝提交测试
- [x] 4.3 为共享点集合增加跨代键隔离、旧代释放不误删新代条目及最终资源回收测试
- [x] 4.4 为 manager 增加 `setLayerStyle` 连续更新、隐藏立即生效、原视口重新显示无空提交帧及删除图层硬清理测试
- [x] 4.5 运行 LoadVectorTile 全部单元测试、ESLint、Prettier 和 diff 检查，并修复发现的回归
- [x] 4.6 在 `asynchronous: true` 场景手工验证 fill、line、circle、symbol 图层的样式刷新和显隐切换，记录无空白帧且旧代最终释放的诊断结果
