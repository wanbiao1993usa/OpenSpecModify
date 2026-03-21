# OpenSpec 轻量 DAG 模式 — 测试报告

**日期**：2026-03-22
**测试环境**：Node.js v22.22.0 / Ubuntu 22.04 (aarch64)
**测试框架**：Node.js built-in test runner + TypeScript strip-types

---

## 总结

| 指标 | 结果 |
|------|------|
| 测试套件 | 10 |
| 测试用例 | 32 |
| 通过 | 32 |
| 失败 | 0 |
| 通过率 | **100%** |
| 执行时间 | ~383ms |
| TypeScript 编译 | ✅ 零错误 |

---

## 需求覆盖矩阵

### R1: Schema 支持轻量 artifact 格式 — ✅ 10/10 通过

| 测试用例 | 状态 | 说明 |
|----------|------|------|
| 解析包含 `task` 字段的轻模式 artifact | ✅ | `task` 字段正确解析，`template`/`generates` 为 undefined |
| 解析重模式 artifact（generates/template） | ✅ | 重模式行为不变 |
| 同一 schema 混用轻模式和重模式 | ✅ | `isLightArtifact`/`isHeavyArtifact` 正确区分 |
| 拒绝同时有 `task` 和 `instruction` | ✅ | 抛出明确错误信息 |
| 拒绝 `task` 与 `template` 并存 | ✅ | 模式互斥校验通过 |
| 拒绝 `task` 与 `generates` 并存 | ✅ | 模式互斥校验通过 |
| 拒绝既无 `task` 又无 `template`/`generates` | ✅ | 提示必须选择一种模式 |
| DAG 无环检测对轻模式生效 | ✅ | 环形依赖正确检测 |
| requires 引用校验对轻模式生效 | ✅ | 无效引用正确报错 |
| ID 唯一性校验对轻模式生效 | ✅ | 重复 ID 正确报错 |

### R2: artifact complete 支持存储完整产出 — ✅ 3/3 通过

| 测试用例 | 状态 | 说明 |
|----------|------|------|
| 产出文件正确写入 `.artifact-output/<id>.txt` | ✅ | 内容完整匹配 |
| `.artifact-output/` 目录自动创建 | ✅ | 目录不存在时自动创建 |
| 文件内容完全保持原样（无转义/修改） | ✅ | 二进制内容精确保持 |

### R3: instructions 适配轻模式 — ✅ 2/2 通过

| 测试用例 | 状态 | 说明 |
|----------|------|------|
| 轻模式 artifact 返回 `task` 字段 | ✅ | task 内容正确返回 |
| 正确识别轻/重模式依赖关系 | ✅ | 混合模式依赖链正确解析 |

### R4: schema validate 适配轻模式 — ✅ 2/2 通过

| 测试用例 | 状态 | 说明 |
|----------|------|------|
| 纯轻模式 schema 无需 templates 目录即可通过 | ✅ | 跳过 template 文件检查 |
| DAG 结构校验对轻模式一致生效 | ✅ | 环检测、依赖检查均正常 |

### R5: status 适配轻模式 — ✅ 5/5 通过

| 测试用例 | 状态 | 说明 |
|----------|------|------|
| 有 metadata 时状态为 done | ✅ | `.artifact-meta.yaml` 记录存在即完成 |
| 有 output 文件但无 metadata 时检测为 completed | ✅ | 文件存在即进入 completed 集合 |
| 无 metadata 无文件时不在 completed 集合 | ✅ | 正确返回未完成 |
| 混合轻/重模式完成检测 | ✅ | 两种模式独立检测，互不干扰 |
| blocked/ready 状态对轻模式 DAG 正确 | ✅ | 依赖满足即 ready，未满足即 blocked |

### R6: stale 检测适配轻模式 — ✅ 3/3 通过

| 测试用例 | 状态 | 说明 |
|----------|------|------|
| 上游 completedAt 更新后，下游变 stale | ✅ | 基于时间戳比较 |
| stale 传递性（A→B→C） | ✅ | A 重跑后 B、C 均标记 stale |
| 混合模式（重模式上游 + 轻模式下游）stale 检测 | ✅ | 跨模式时间戳统一比较 |

### R7: reset 适配轻模式 — ✅ 2/2 通过

| 测试用例 | 状态 | 说明 |
|----------|------|------|
| reset 删除 `.artifact-output/<id>.txt` + 清理 metadata | ✅ | 文件和元数据均清理 |
| cascade 对下游轻模式 artifact 生效 | ✅ | `getDependants` 正确返回下游 |

### R8: --from 迭代适配轻模式 — ✅ 2/2 通过

| 测试用例 | 状态 | 说明 |
|----------|------|------|
| 复制 `.artifact-output` 文件和 metadata | ✅ | 文件内容和元数据完整复制 |
| 源 change 无 output 文件时不报错 | ✅ | 仅复制 metadata |

### 集成测试：完整轻量 DAG 工作流 — ✅ 1/1 通过

| 测试用例 | 状态 | 说明 |
|----------|------|------|
| BTC 分析五节点 DAG 完整生命周期 | ✅ | 从创建到全部完成，状态流转正确 |

### 辅助函数测试 — ✅ 2/2 通过

| 测试用例 | 状态 | 说明 |
|----------|------|------|
| `isLightArtifact` 正确识别 | ✅ | task-only 返回 true |
| `isHeavyArtifact` 正确识别 | ✅ | generates+template 返回 true |

---

## 修改文件清单

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `src/core/artifact-graph/types.ts` | 修改 | 新增轻/重模式 schema 定义、`isLightArtifact`/`isHeavyArtifact` 辅助函数 |
| `src/core/artifact-graph/schema.ts` | 修改 | 新增 `validateArtifactModes` 验证函数 |
| `src/core/artifact-graph/state.ts` | 修改 | `detectCompleted` 支持轻模式检测，`detectStale` 支持基于时间戳的比较 |
| `src/core/artifact-graph/instruction-loader.ts` | 修改 | `generateInstructions` 轻模式返回 task 和依赖路径，`formatChangeStatus` 适配轻模式 |
| `src/core/artifact-graph/index.ts` | 修改 | 导出新类型 |
| `src/commands/workflow/artifact-meta.ts` | 修改 | 新增 `--output-file` 参数支持 |
| `src/commands/workflow/instructions.ts` | 修改 | `generateApplyInstructions` 适配轻模式 |
| `src/commands/workflow/reset.ts` | 修改 | reset 逻辑适配轻模式文件路径 |
| `src/commands/workflow/templates.ts` | 修改 | 兼容 optional template 字段 |
| `src/commands/schema.ts` | 修改 | validate 跳过轻模式 template 检查 |
| `src/utils/change-utils.ts` | 修改 | `copyCompletedArtifacts` 支持轻模式 |
| `src/cli/index.ts` | 修改 | 注册 `--output-file` CLI 选项 |

---

## 向后兼容性

所有修改均保持向后兼容：
- 重模式的所有现有行为不受影响
- 现有 schema 无需任何修改即可继续使用
- 新增字段均为可选
- TypeScript 编译零错误
