## 1. 基线盘点

- [x] 1.1 记录 `Apps/Demos/LoadVectorTile/src` 中所有 Cesium 命名空间导入、`Cesium.` 引用和 `CesiumModule` 全局兜底引用。
- [x] 1.2 记录重复定义的通用工具函数，包括 `isPlainObject`、`cloneValue`、`isNonEmptyString` 和本地 `isDefined`。
- [x] 1.3 记录缺少默认导出或默认导出不代表主要职责的源文件。

## 2. 公共工具整理

- [x] 2.1 新增 `CommonUtils.js`，默认导出 `CommonUtils` 工具类。
- [x] 2.2 将跨文件复用的普通对象判断、深拷贝和非空字符串判断迁移为 `CommonUtils` 静态方法。
- [x] 2.3 更新调用方复用 `CommonUtils`，移除重复工具函数定义。
- [x] 2.4 将本地 `isDefined` 调用改为 Cesium `defined`。

## 3. Cesium 导入规范化

- [x] 3.1 将 `import * as Cesium` 改为从 `../../../../Build/CesiumUnminified/index.js` 按需命名导入。
- [x] 3.2 将 `import * as CesiumModule` 和 `globalThis.Cesium` 兜底改为明确命名导入或明确测试注入策略。
- [x] 3.3 将所有运行代码中的 `Cesium.<name>` 引用替换为对应命名导入标识符。
- [x] 3.4 使用静态搜索确认 `src` 中不再存在 Cesium 命名空间导入。

## 4. 导出形态规范化

- [x] 4.1 为缺少默认导出的源文件补充默认导出。
- [x] 4.2 将纯工具集合文件整理为默认导出工具类，辅助 API 通过默认类静态成员访问。
- [x] 4.3 检查单一函数文件是否符合小写开头命名和默认导出约定。
- [x] 4.4 同步更新 `src` 内部调用方和 `test` 文件的导入方式。

## 5. 文档更新

- [x] 5.1 在 `Apps/Demos/LoadVectorTile` 文档中新增代码规范与源码迁移约定。
- [x] 5.2 文档说明 Cesium 命名导入、公共工具类、默认导出和单一函数文件命名规则。
- [x] 5.3 文档明确此类规范化不得夹带运行逻辑变更。

## 6. 验证

- [x] 6.1 运行 LoadVectorTile 相关 Node 单元测试。
- [x] 6.2 运行静态搜索，确认重复工具函数和 Cesium 命名空间导入已清理。
- [x] 6.3 如验证无法运行，记录具体命令、失败原因和剩余风险。

验证备注：全量 Node 单元测试已通过。静态搜索确认 `src` 中无非 default 导出、无 Cesium 命名空间导入、无 `globalThis.Cesium`/`CesiumModule` 兜底、无重复 helper 定义残留，且所有源文件都有默认导出。`VectorTileLayerManager.test.js` 已同步为“移除最后一个 style layer 后仍保留 provider”的预期。
