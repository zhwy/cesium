## ADDED Requirements

### Requirement: 公共工具函数必须集中复用
`LoadVectorTile/src` 中跨多个文件复用的通用工具逻辑 MUST 集中到默认导出的工具类静态方法中，调用方 MUST 复用该工具类而不是重复定义等价函数。

#### Scenario: 抽取重复 plain object 判断
- **WHEN** 多个 `LoadVectorTile/src` 文件需要判断普通对象
- **THEN** 它们 MUST 调用公共工具类的静态方法，而不是各自定义 `isPlainObject`

#### Scenario: 保留领域私有 helper
- **WHEN** 某个 helper 只服务于单个文件内部且没有跨文件复用价值
- **THEN** 它 MAY 继续作为该文件的私有函数保留，不需要迁移到公共工具类

### Requirement: Cesium API 必须按需命名导入
`LoadVectorTile/src` 文件 MUST 从 `../../../../Build/CesiumUnminified/index.js` 按需命名导入 Cesium API，并 MUST 优先使用 Cesium 已有工具方法。

#### Scenario: 使用 Cesium defined
- **WHEN** 代码需要判断值是否既不是 `undefined` 也不是 `null`
- **THEN** 代码 MUST 导入并调用 Cesium 的 `defined`，而不是定义本地 `isDefined` 或通过 `Cesium.defined` 命名空间访问

#### Scenario: 使用 Cesium 错误和销毁工具
- **WHEN** 代码需要抛出开发期错误、创建事件或销毁对象
- **THEN** 代码 MUST 按需导入 `DeveloperError`、`Event`、`destroyObject` 等 Cesium API

#### Scenario: 禁止 Cesium 命名空间导入
- **WHEN** `LoadVectorTile/src` 文件引用 Cesium 构建产物
- **THEN** 文件 MUST NOT 使用 `import * as Cesium` 或 `import * as CesiumModule` 形式

### Requirement: 每个源文件必须有默认导出
`LoadVectorTile/src` 中每个 JavaScript 源文件 MUST 提供一个 `export default`，且默认导出 MUST 表达该文件的主要职责。

#### Scenario: 主类文件默认导出主类
- **WHEN** 文件主要定义一个运行时类
- **THEN** 文件 MUST 默认导出该主类

#### Scenario: 单一工厂函数文件默认导出函数
- **WHEN** 文件只提供一个主要工厂函数
- **THEN** 文件 MUST 使用小写开头的函数式文件名，并默认导出该函数

#### Scenario: 工具集合文件默认导出工具类
- **WHEN** 文件主要由多个工具方法组成
- **THEN** 文件 MUST 默认导出一个工具类，工具方法 MUST 作为静态方法提供

#### Scenario: 必要命名导出兼容
- **WHEN** 调用方需要引用枚举、子类或明确的辅助 API
- **THEN** 文件 MAY 保留命名导出，但 MUST 同时保留符合主要职责的默认导出

### Requirement: 规范化不得改变运行逻辑
本次规范化 MUST 保持矢量瓦片加载、解码、渲染、样式、拾取、缓存和调度行为不变。

#### Scenario: 行为验证
- **WHEN** 导入、导出和工具函数复用完成后
- **THEN** 现有 LoadVectorTile 单元测试 MUST 通过，或记录无法运行的具体原因

#### Scenario: 不新增生产依赖
- **WHEN** 实现代码规范化
- **THEN** 变更 MUST NOT 新增生产依赖

### Requirement: 开发规则必须文档化
`Apps/Demos/LoadVectorTile` MUST 包含面向后续开发和源码迁移的代码规范文档。

#### Scenario: 记录导入导出规则
- **WHEN** 后续开发者查看 LoadVectorTile 文档
- **THEN** 文档 MUST 说明 Cesium 命名导入、默认导出、工具类静态方法和小写函数文件命名规则

#### Scenario: 记录非目标
- **WHEN** 后续开发者查看规范化说明
- **THEN** 文档 MUST 明确本类结构整理不应夹带运行逻辑变更
