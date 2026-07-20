## Context

`Apps/Demos/LoadVectorTile/src` 是准备后续迁移到 Cesium 源码中的实验性矢量瓦片实现。当前代码已经按运行时职责拆分为 provider、layer、quadtree、bucket、style、worker、cache 等模块，但仍存在实验阶段遗留的不一致：

- 多个文件重复定义 `isPlainObject`、`cloneValue`、`isNonEmptyString` 等工具函数。
- 部分文件自定义 `isDefined`，而 Cesium 已有 `defined`。
- Cesium API 的导入方式混用 `import * as Cesium`、`CesiumModule` 和局部解构。
- 部分工具文件只提供命名导出，缺少默认导出，不利于后续按 Cesium 源码风格归档。

本次变更只规范代码结构和文档约定，不调整运行时逻辑。

## Goals / Non-Goals

**Goals:**

- 让 `LoadVectorTile/src` 的 Cesium API 使用方式统一为按需命名导入。
- 将跨文件重复工具函数集中到默认导出的工具类静态方法中。
- 让每个 `src` 文件都有明确的默认导出，默认导出表达该文件的主要职责。
- 同步更新调用方和测试导入，使现有测试覆盖继续验证行为不变。
- 在 `Apps/Demos/LoadVectorTile` 文档中沉淀后续开发规则。

**Non-Goals:**

- 不改变矢量瓦片加载、解码、渲染、样式、拾取、缓存和调度逻辑。
- 不新增生产依赖。
- 不把 demo 代码迁移到 `packages/engine/Source`。
- 不重命名已有主类文件，除非文件只默认导出单个函数且命名不符合小写函数文件约定。

## Decisions

1. 使用 `CommonUtils` 承载跨领域通用工具。

   `isPlainObject`、`cloneValue`、`isNonEmptyString` 这类逻辑不属于 style、provider 或 feature-state 的业务边界，应集中到一个默认导出的工具类中。这样后续迁移时可以清晰判断哪些工具需要进入 Cesium Core，哪些仍留在矢量瓦片模块内部。

   备选方案是把工具函数继续作为裸函数命名导出，但这会保留“函数散落”的问题，也难以满足工具文件默认导出的约定。

2. 优先复用 Cesium 已有 Core 方法。

   `defined`、`DeveloperError`、`destroyObject`、`Event` 等已经由 Cesium 构建产物提供命名导出。本目录不再重新实现同义工具，也不再通过 `Cesium.` 命名空间访问这些 API。

   备选方案是从 `globalThis.Cesium` 兜底读取 API，但这会让模块依赖隐式全局状态，和源码迁移目标不一致。

3. 保留必要的命名导出作为模块 API，但每个文件必须有默认导出。

   主类文件默认导出主类；单一工厂函数文件默认导出该函数；纯工具集合文件默认导出工具类。已有调用方需要命名导出的枚举、子类或测试辅助函数，可以继续命名导出，但默认导出必须存在并代表主要职责。

   这避免一次规范化改动破坏现有内部 API，同时满足后续迁移时的文件主职责识别。

4. 测试随导入结构同步调整，不降低行为覆盖。

   当前部分测试通过 `globalThis.Cesium` 注入假 Cesium 对象。命名导入后这类 mock 不再自动生效，因此测试需要改为使用真实 `Build/CesiumUnminified/index.js` 导出，或通过更明确的测试 seam 覆盖工具逻辑。测试调整只服务于验证同一行为，不引入新功能断言。

## Risks / Trade-offs

- [Risk] 大范围导入改写可能遗漏某个 `Cesium.` 引用。→ Mitigation: 使用 `rg "import \\* as Cesium|Cesium\\.|CesiumModule|globalThis\\.Cesium"` 做静态检查，并运行 LoadVectorTile 单测。
- [Risk] 工具函数迁移可能因为细微实现差异改变行为。→ Mitigation: 抽取时复制现有实现语义，特别保留 `Object.getPrototypeOf(value) === null` 这类 plain object 判定。
- [Risk] 将函数放入工具类静态方法会让调用点改动较多。→ Mitigation: 对跨文件高频函数先集中迁移；领域内只使用一次的私有 helper 保留在原文件。
- [Risk] 测试 mock 方式变化可能让单测变慢或更依赖 Cesium 构建产物。→ Mitigation: 本目录当前已经从 `Build/CesiumUnminified/index.js` 运行，验证前确认构建产物存在；必要时只调整受影响测试。

## Migration Plan

1. 新增 `CommonUtils.js`，默认导出 `CommonUtils`，并迁移跨文件重复工具函数。
2. 按文件逐步改写 Cesium 导入，从命名空间访问改为命名导入。
3. 将纯工具函数文件整理为默认导出工具类，更新内部调用方和测试。
4. 为缺少默认导出的文件补充默认导出，必要时保持命名导出兼容。
5. 更新 `Apps/Demos/LoadVectorTile` 开发文档，记录工具函数、导入、导出和命名规则。
6. 运行 LoadVectorTile 单测；若无法运行，记录具体原因。

## Open Questions

- `VectorTileProvider.js` 当前同时包含基类、`TileType`、XYZ/WMTS/WMTSGeo 子类。实现时需判断是否保持单文件多导出，还是拆分 provider 子类；本 proposal 建议本次保持单文件，避免超出“不改逻辑”的范围。
- `VectorTileBucketUtils.js` 等高频工具文件是否保留命名导出兼容层，可在实现时根据调用方规模决定，但默认导出工具类必须存在。
