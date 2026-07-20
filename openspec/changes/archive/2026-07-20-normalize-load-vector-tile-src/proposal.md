## Why

`Apps/Demos/LoadVectorTile/src` 目前仍保留实验阶段的代码组织痕迹：工具函数重复定义、Cesium 命名空间导入方式不统一、部分工具文件缺少默认导出。现在需要先把这些结构规范化，降低后续迁移到 Cesium 源码目录时的返工和审查成本。

## What Changes

- 抽取重复的通用工具函数，优先集中到 `CommonUtils` 这类默认导出的工具类静态方法中。
- 移除本目录内自定义的 `isDefined` 等可直接复用 Cesium 现有实现的函数，改用 Cesium 的 `defined` 等命名导出。
- 将 `import * as Cesium from "../../../../Build/CesiumUnminified/index.js"` 和 `CesiumModule` 命名空间导入改为按需命名导入。
- 统一 `src` 文件导出形态：每个文件都提供 `export default`，默认导出该文件的主要类、主要工厂函数或工具类。
- 保留现有运行逻辑、公共行为和测试期望，本次只做结构、导入、导出和文档规范化。
- 形成开发规则文档，后续新增或迁移代码时按同一约定执行。

## Capabilities

### New Capabilities

- `load-vector-tile-code-conventions`: 约束 `LoadVectorTile/src` 的工具函数复用、Cesium 导入方式、文件导出形态和迁移前代码规范文档。

### Modified Capabilities

- 无。

## Impact

- 影响代码范围：`Apps/Demos/LoadVectorTile/src/**/*.js`、对应 `Apps/Demos/LoadVectorTile/test/**/*.test.js` 导入方式，以及 `Apps/Demos/LoadVectorTile` 下的开发文档。
- 不新增生产依赖。
- 不改变矢量瓦片加载、解码、渲染、样式、拾取、缓存或调度逻辑。
- 可能需要同步调整测试中的 Cesium mock 策略，因为命名导入会替代当前部分文件依赖的 `globalThis.Cesium` 注入方式。
