# 实施前验证基线

记录日期：2026-10-29。本次验证在修改运行时代码前执行。

## 工作区起点

以下文件已有用户改动，本次保留：

- `Apps/Demos/LoadVectorTile/src/VectorTileBufferPolygonBucket.js`
- `Apps/Demos/LoadVectorTile/src/VectorTileBufferPolygonPrimitive.js`
- `Apps/Demos/LoadVectorTile/src/VectorTileDiagnostics.js`
- `Apps/Demos/LoadVectorTile/src/createVectorTileBenchmark.js`

## Node 测试

环境：PowerShell，Node.js v20.19.3。根目录 package.json 声明 Node.js >=22.17.0；本次结果仅代表上述实际运行环境。

执行命令：

```powershell
node --test Apps/Demos/LoadVectorTile/test/VectorTileBufferPolygonBucket.test.js Apps/Demos/LoadVectorTile/test/VectorTileBufferPolygonBenchmark.test.js Apps/Demos/LoadVectorTile/test/VectorTileGeometry.test.js Apps/Demos/LoadVectorTile/test/VectorTileStyleHotUpdate.test.js Apps/Demos/LoadVectorTile/test/VectorTileFeatureState.test.js Apps/Demos/LoadVectorTile/test/VectorTileLayer.test.js
```

结果：14 项测试，12 项通过，2 项失败，退出码 1。

通过范围包括面后端 benchmark、BufferPolygon 桶、几何工具和样式热更新。面桶用例覆盖非贴地细分、洞索引、实际容量、贴地提交分离、成面线、退化空面、颜色和 feature-state、拾取、四叉树提交、轮廓及高度回退。

既有失败：

1. `VectorTileFeatureState.test.js:21`：`TypeError: VectorTileFeatureStateUtils.getPromoteIdPropertyName is not a function`。当前源码将该方法保留为文件内部函数，测试仍通过类静态成员调用。
2. `VectorTileLayer.test.js:9`：导入 `Build/CesiumUnminified/index.js` 时出现 `SyntaxError: Cannot use 'import.meta' outside a module`。失败位置在构建产物的 `import.meta?.url`，尚未执行后续 Layer 断言。

## 继续实施后的补充验证

用户确认“继续实现”，将既有失败单独记录后继续。工作区新增的用户改动公开了 `getPromoteIdPropertyName`，之后 feature-state 测试已通过；本次未覆盖该用户改动。Layer 的构建产物导入问题仍属于既有验证边界。

扩大相关测试时还发现 `VectorTileGeometryPlacement.test.js` 调用未公开的 `getStyleRuleGeometryTypes`、`VectorTileLodSelection.test.js` 调用未公开的 `tileKey`，这两个断言入口在原源码中就不存在。本次不为适配这些旧测试增加生产 API，改以新增用例验证过滤和实际四叉树 LOD 行为。

浏览器基线通过 `validation/browser-check.mjs baseline` 补测：只替换浏览器收到的面桶、面适配对象及解码 Worker 三个脚本响应为 HEAD 版本，复现原同步 Buffer 算法，不切换工作区、不写 Git。该基线不含用户后来新增的阶段计时；并非完整的提交级别 A/B。固定相同 1280×720 视口、初始相机、`res_org_gr-level2-fill` 图层、颜色和冷内存 PBF 配置。原始数据见 `validation/baseline.json`；当前实现见 `validation/optimized.json`，完整分析见 `validation.md`。
