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
- **THEN** `resolvePickedFeature()` SHALL 返回仅包含 feature id 和定位信息的基本 properties，不包含原始 PBF properties

### Requirement: 紧凑拾取解析接口

VectorTileLayerManager SHALL 实现 `resolvePickedFeature(picked)` 方法，该方法接受拾取结果并返回包含新 properties 对象及上下文信息的对象。非本 manager 或已销毁对象 SHALL 返回 `undefined`。返回的对象 SHALL 包含 source、style layer、tile 和 feature index 信息。

#### Scenario: 成功解析拾取要素

- **WHEN** 拾取结果指向有效且未销毁的 feature
- **THEN** `resolvePickedFeature()` SHALL 返回包含 properties、source、style layer、tile 和 feature index 的对象

#### Scenario: 解析无效拾取结果

- **WHEN** 拾取结果指向已销毁的对象或来自其他 manager
- **THEN** `resolvePickedFeature()` SHALL 返回 `undefined`

### Requirement: 拾取上下文生命周期管理

系统 SHALL 维护一个 manager 级弱引用拾取注册表，在 Primitive bucket 创建和 SharedPointCollections 生命周期中注册、替换和注销拾取上下文。已销毁对象的拾取上下文 SHALL 自动从注册表中清理。

#### Scenario: 创建 bucket 时注册拾取上下文

- **WHEN** VectorTile bucket 创建完成
- **THEN** 系统 SHALL 注册对应的拾取上下文，使其可用于后续拾取解析

#### Scenario: 销毁 bucket 时清理拾取上下文

- **WHEN** VectorTile bucket 被销毁
- **THEN** 系统 SHALL 注销对应的拾取上下文，防止解析已销毁对象

### Requirement: 拾取诊断与计数

系统 SHALL 记录拾取相关操作的成功次数、失败次数和属性驻留大小。当 pickProperties 配置变更时，系统 SHALL 更新属性驻留策略并重新计算相关成本。

#### Scenario: 记录拾取成功与失败

- **WHEN** 用户执行拾取操作
- **THEN** 系统 SHALL 记录成功解析和无法解析的次数

#### Scenario: 监控拾取属性驻留成本

- **WHEN** pickProperties 配置变更
- **THEN** 系统 SHALL 更新驻留策略并记录新的属性驻留大小
