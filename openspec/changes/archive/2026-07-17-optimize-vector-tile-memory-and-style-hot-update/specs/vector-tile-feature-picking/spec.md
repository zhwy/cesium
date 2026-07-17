## ADDED Requirements

### Requirement: 渲染对象使用紧凑拾取身份

系统 SHALL 使用 Primitive 内唯一的紧凑 instance id 和瓦片级 feature table 表示可拾取要素，且 SHALL NOT 把完整 feature properties 复制到每个 GeometryInstance、Billboard 或 Label 的公开 `id` 上。同一 PBF feature 被裁剪或派生为多个渲染对象时，这些对象 MUST 能解析到同一瓦片级 feature 记录。

#### Scenario: 一个 feature 生成多个 GeometryInstance

- **WHEN** 一个 PBF feature 经裁剪后生成多个线段或 polygon 片段
- **THEN** 每个 GeometryInstance SHALL 使用各自在 Primitive 内唯一的紧凑 id，并通过 instance-to-feature 映射解析到同一 feature table 记录

#### Scenario: 点渲染对象使用紧凑身份

- **WHEN** circle 或 symbol bucket 创建 Billboard 或 Label
- **THEN** 对象 SHALL 保存紧凑身份或注册紧凑拾取上下文，而不是保存一份包含完整 properties 的 metadata 对象

### Requirement: Worker 输出共享 feature table 与属性投影

Worker SHALL 在解码期间使用原始 feature properties 完成 filter 求值，但传回主线程的长期驻留数据 SHALL 由 source-layer 级 feature table、几何到 feature 的索引以及所需属性投影组成。系统 MUST 从当前参与构建的 filter、paint 和 layout 表达式收集静态属性依赖；遇到无法静态确定属性名的表达式时 MUST 回退为保留全部属性。

#### Scenario: 多个几何片段共享属性

- **WHEN** 同一个 source feature 生成多个点、线或面片段
- **THEN** packed geometry SHALL 通过 feature index 引用一份共享 feature table 记录

#### Scenario: 表达式只引用部分字段

- **WHEN** 当前样式表达式只引用 `kind` 和 `level` 且拾取配置不要求其他字段
- **THEN** Worker 返回的 feature table SHALL 不长期保留其他 properties

#### Scenario: 表达式使用动态属性名

- **WHEN** 一个受支持表达式的属性名无法在构建前静态确定
- **THEN** 系统 SHALL 将该 source-layer 的属性投影升级为全部 properties，以保持样式结果正确

### Requirement: pickProperties 控制拾取属性驻留

启用 `allowPicking` 的 vector source SHALL 支持可选的 `pickProperties` 配置。未配置 `pickProperties` 时系统 MUST 为被保留的可拾取 feature 保存全部 properties；配置字符串数组时 SHALL 只为拾取额外保存数组列出的属性；配置空数组时 SHALL 不为拾取额外保存属性，但仍 MUST 保存 feature id 和定位信息。无论拾取配置为何，样式求值所需属性 MUST 继续驻留。

#### Scenario: 未配置 pickProperties

- **WHEN** source 启用 `allowPicking` 且没有配置 `pickProperties`
- **THEN** `resolvePickedFeature()` 返回该 feature 的全部 properties

#### Scenario: 配置部分拾取属性

- **WHEN** source 配置 `pickProperties: ["name", "year"]`
- **THEN** `resolvePickedFeature()` 返回的 properties SHALL 只包含该 feature 存在的 `name` 和 `year`，以及样式系统内部所需但不作为公开拾取属性返回的独立投影数据

#### Scenario: 配置空拾取属性

- **WHEN** source 配置 `pickProperties: []`
- **THEN** `resolvePickedFeature()` SHALL 返回空 properties，同时继续返回 feature id、source、style layer 和瓦片定位信息

#### Scenario: 未启用拾取

- **WHEN** source 配置 `allowPicking: false`
- **THEN** 系统 SHALL 不因 `pickProperties` 未配置而保留全部 properties，也 SHALL 不创建逐要素拾取上下文

### Requirement: Manager 同步解析拾取结果

`VectorTileLayerManager` SHALL 提供同步 `resolvePickedFeature(picked)` API，通过被拾取渲染对象和紧凑 id 查询仍驻留的 feature table。有效结果 MUST 包含 feature id、公开 properties、source id、source-layer、style layer id、瓦片 `(x, y, level)` 和瓦片内 feature index。该 API SHALL NOT 为一次拾取复制或重新解析 PBF，也 SHALL NOT 发起网络请求。

#### Scenario: 解析有效矢量瓦片拾取

- **WHEN** `scene.pick()` 返回由 manager 管理的有效线、面、circle、billboard 或 label 结果
- **THEN** `resolvePickedFeature(picked)` SHALL 同步返回对应的结构化 feature 信息

#### Scenario: 解析非矢量瓦片对象

- **WHEN** `resolvePickedFeature()` 接收到非该 manager 管理的拾取结果
- **THEN** API SHALL 返回 `undefined` 且不改变任何缓存状态

#### Scenario: 解析已经销毁的拾取上下文

- **WHEN** 调用方保存了旧 picked 对象，而对应 VectorTile 或点条目已经销毁
- **THEN** `resolvePickedFeature()` SHALL 返回 `undefined`，且已销毁资源不得被拾取注册表强引用保活

### Requirement: 拾取上下文遵循瓦片生命周期

紧凑拾取注册表 MUST 在 Primitive、Billboard、Label、bucket 或 VectorTile 被替换和销毁时失效，并 SHALL 使用不会阻止渲染对象垃圾回收的引用结构。feature table 的驻留数量和公开属性值数量 SHALL 暴露独立诊断指标。

#### Scenario: 驱逐离屏瓦片

- **WHEN** 一个引用为零的离屏 VectorTile 被渲染缓存驱逐
- **THEN** 其 feature table 和全部拾取上下文 SHALL 可被释放，诊断驻留计数 SHALL 相应减少

#### Scenario: bucket 原地替换

- **WHEN** 样式回退路径用新 bucket 替换旧 bucket
- **THEN** 旧渲染对象的拾取上下文 SHALL 失效，新渲染对象 SHALL 注册到同一 feature 语义记录或新解码记录
