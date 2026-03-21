# OpenSpec 轻量 DAG 模式 — 需求文档

## 背景

OpenSpec 现有的工作流模式（重模式）要求每个 artifact 定义 `generates`、`template`、`instruction` 三个字段，并依赖磁盘上的 template 文件。这适合需要沉淀和复用的研究工作流。

但对于一次性的分析任务（如"分析 BTC 是否该减仓"），生成 schema.yaml + template 文件 + change 目录的开销过重。需要一种轻量模式：schema.yaml 里只写 `id` + `task` + `requires`，即可直接执行。

## 设计原则

- 轻模式和重模式在同一个 schema 里可以混用
- 轻模式不引入新的 CLI 命令，复用现有命令
- 重模式的所有现有行为不受影响
- LLM 驱动执行循环（通过 skill），OpenSpec 只负责状态管理和数据存储

## 存储方案

轻模式 artifact 的完整产出存储为独立文件，与元数据分离：

```
openspec/changes/<change-name>/
├── .openspec.yaml              # change 元数据（现有）
├── .artifact-meta.yaml         # artifact 完成元数据（现有）
├── .artifact-output/           # 【新增】轻模式产出存储目录
│   ├── <artifact-id>.txt       # 每个 artifact 的完整产出
│   └── ...
├── proposal.md                 # 重模式产出文件（现有）
└── ...
```

---

## 需求列表

### R1：Schema 支持轻量 artifact 格式

**优先级**：P0

**现状**：每个 artifact 必须定义 `generates`、`template`、`instruction` 字段，`template` 对应的文件必须存在于 `schemas/<name>/templates/` 目录下。

**目标**：支持只有 `task` + `requires` 的轻量 artifact 定义。

**轻模式 artifact 格式**：

```yaml
artifacts:
  - id: macro
    task: 分析美联储利率政策对 BTC 的影响
    requires: []
```

**模式判定规则**：

| 字段组合 | 模式 |
|---------|------|
| 有 `instruction` + `template` + `generates` | 重模式（现有行为） |
| 有 `task`，无 `template`，无 `generates` | 轻模式（新行为） |
| 同时有 `task` 和 `instruction` | 报错：不允许混用 |

**同一个 schema 内可以混用**：部分 artifact 用重模式，部分用轻模式。

**验收标准**：

- [ ] schema.yaml 中包含 `task` 字段的 artifact 可以通过解析
- [ ] 缺少 `task` 和 `instruction` 的 artifact 报错
- [ ] 同一 artifact 同时有 `task` 和 `instruction` 报错

---

### R2：artifact complete 支持存储完整产出

**优先级**：P0

**现状**：`openspec artifact complete` 接受 `--summary` 参数，将摘要存储在 `.artifact-meta.yaml` 中。

**目标**：新增 `--output-file` 参数，将完整产出内容存储到 `.artifact-output/<artifact-id>.txt`。

**命令格式**：

```bash
openspec artifact complete <artifact-id> \
  --change <change-name> \
  --summary "美联储转鸽，中期看多" \
  --output-file /tmp/macro-output.txt
```

**行为**：

1. 读取 `--output-file` 指定的文件内容
2. 写入 `openspec/changes/<change-name>/.artifact-output/<artifact-id>.txt`
3. `.artifact-output/` 目录不存在时自动创建
4. `--summary` 行为不变，仍写入 `.artifact-meta.yaml`
5. `--output-file` 是可选参数，不传时行为与现有完全一致

**验收标准**：

- [ ] 传 `--output-file` 后，产出内容被正确写入 `.artifact-output/<artifact-id>.txt`
- [ ] 不传 `--output-file` 时行为不变
- [ ] `.artifact-output/` 目录自动创建
- [ ] 产出文件内容与源文件完全一致（不做任何转义或修改）

---

### R3：instructions 适配轻模式，返回 task 和依赖产出路径

**优先级**：P0

**现状**：`openspec instructions <artifact-id> --change <name> --json` 返回 instruction、template 内容、context、dependencies 等信息。

**目标**：轻模式 artifact 返回 `task` 字段内容和依赖 artifact 的产出文件路径。子 agent 拿到路径后自行读取文件，与 Guigu 原有重模式的"传路径、子 agent 自己读"模式一致。OpenSpec 不负责拼接 prompt。

**命令格式（不变）**：

```bash
openspec instructions <artifact-id> --change <change-name> --json
```

**轻模式返回内容**：

```json
{
  "changeName": "btc-analysis-v1",
  "artifactId": "synthesize",
  "schemaName": "btc-analysis",
  "changeDir": "/path/to/openspec/changes/btc-analysis-v1",
  "task": "综合以上三个维度的分析，给出 BTC 仓位调整建议",
  "dependencies": [
    {
      "id": "macro",
      "outputPath": ".artifact-output/macro.txt",
      "summary": "美联储 3 月转鸽，中期 bullish"
    },
    {
      "id": "onchain",
      "outputPath": ".artifact-output/onchain.txt",
      "summary": "交易所净流入为正，鲸鱼减持"
    },
    {
      "id": "technical",
      "outputPath": ".artifact-output/technical.txt",
      "summary": "日线下降通道上沿，4H 看跌背离"
    }
  ]
}
```

**字段说明**：

| 字段 | 说明 |
|------|------|
| `task` | schema.yaml 中该 artifact 的 `task` 字段内容 |
| `dependencies[].id` | 直接依赖的 artifact id |
| `dependencies[].outputPath` | 依赖 artifact 的产出文件相对路径（相对于 changeDir） |
| `dependencies[].summary` | 依赖 artifact 的摘要（从 `.artifact-meta.yaml` 读取，可能为空） |

**行为规则**：

- 轻模式 artifact（有 `task` 字段） → 返回 `task` + `dependencies`，不返回 `instruction`、`template`
- 重模式 artifact（有 `instruction` 字段） → 行为与现有完全一致，不受影响
- `dependencies` 只包含直接依赖（`requires` 中列出的），不递归
- 依赖 artifact 的 output 文件不存在时，`outputPath` 仍然返回预期路径，由子 agent 处理文件不存在的情况

**验收标准**：

- [ ] 轻模式 artifact 返回 `task` 字段而非 `instruction`
- [ ] `dependencies` 包含所有直接依赖的 id、outputPath、summary
- [ ] 重模式 artifact 行为不变
- [ ] `outputPath` 为相对于 changeDir 的路径

---

### R4：schema validate 适配轻模式

**优先级**：P0

**现状**：`openspec schema validate` 检查每个 artifact 的 template 文件是否存在于 `schemas/<name>/templates/` 目录下。

**目标**：轻模式 artifact 跳过 template 文件检查。

**保留的校验**：

- DAG 无环检测
- `requires` 中引用的 artifact id 必须在同 schema 中定义
- artifact id 唯一性
- 必须有至少 1 个 artifact

**跳过的校验（仅轻模式 artifact）**：

- template 文件存在性检查
- generates 字段存在性检查

**验收标准**：

- [ ] 只包含轻模式 artifact 的 schema 可以通过 validate
- [ ] 混用模式下，重模式 artifact 仍然检查 template，轻模式跳过
- [ ] DAG 结构校验（无环、依赖存在、id 唯一）对两种模式一致

---

### R5：status 适配轻模式

**优先级**：P0

**现状**：artifact 的 `done` 状态根据 `generates` 对应的产出文件是否存在来判断。

**目标**：轻模式 artifact 的状态根据元数据判断，不依赖文件系统。

**轻模式状态判定规则**：

| 条件 | 状态 |
|------|------|
| `.artifact-meta.yaml` 中有该 artifact 的完成记录 | `done` |
| 无完成记录，但 `.artifact-output/<id>.txt` 存在 | `unverified` |
| 无完成记录，无产出文件，且所有 requires 均为 done | `ready` |
| 无完成记录，无产出文件，且存在 requires 不是 done | `blocked` |
| 已完成，但上游有更新的完成记录（见 R6） | `stale` |

**`openspec status --json` 输出格式不变**，只是状态判定逻辑对轻模式使用上述规则。

**验收标准**：

- [ ] 轻模式 artifact 在 `artifact complete` 调用后状态变为 `done`
- [ ] 轻模式 artifact 产出文件存在但未 complete 时状态为 `unverified`
- [ ] 依赖未满足时状态为 `blocked`
- [ ] 依赖全部满足且未完成时状态为 `ready`
- [ ] 重模式 artifact 状态判定行为不变

---

### R6：stale 检测适配轻模式

**优先级**：P1

**现状**：基于产出文件的 mtime 比较。如果上游产出文件比下游新，下游标记为 stale。支持传递性。

**目标**：轻模式下基于 `.artifact-meta.yaml` 中的完成时间戳比较。

**规则**：

- 上游 artifact 的 `completedAt` > 下游 artifact 的 `completedAt` → 下游标记为 `stale`
- 传递性：A→B→C，A 被重跑（completedAt 更新），B 和 C 都变 `stale`
- 混用模式：上游是重模式（用 mtime）、下游是轻模式（用 completedAt），需要统一比较

**验收标准**：

- [ ] 上游重跑后，下游轻模式 artifact 变为 stale
- [ ] 传递性生效
- [ ] 混用模式下 stale 检测正常

---

### R7：reset 适配轻模式

**优先级**：P1

**现状**：`openspec reset` 删除 `generates` 对应的产出文件 + 清理 `.artifact-meta.yaml` 中的记录。

**目标**：轻模式下删除 `.artifact-output/<artifact-id>.txt` + 清理元数据。

**行为**：

1. 删除 `.artifact-output/<artifact-id>.txt`（如果存在）
2. 删除 `.artifact-meta.yaml` 中该 artifact 的记录
3. `--cascade` 对下游 artifact 递归执行相同操作（与现有行为一致）

**验收标准**：

- [ ] reset 后产出文件被删除
- [ ] reset 后元数据被清理
- [ ] reset 后 status 变为 `ready`（如果依赖满足）或 `blocked`
- [ ] `--cascade` 对下游轻模式 artifact 生效

---

### R8：--from 迭代适配轻模式

**优先级**：P1

**现状**：`openspec new change --from <source>` 复制源 change 的产出文件 + `.artifact-meta.yaml` 条目。

**目标**：轻模式下同时复制 `.artifact-output/` 目录中对应的产出文件。

**行为**：

1. 复制 `.artifact-meta.yaml` 中对应 artifact 的条目（现有行为）
2. 复制 `.artifact-output/<artifact-id>.txt`（新增）
3. 如果源 change 中某个轻模式 artifact 没有 output 文件，只复制元数据

**验收标准**：

- [ ] `--from` 后新 change 中包含源 change 的轻模式产出文件
- [ ] `--from` 后新 change 中轻模式 artifact 状态为 `done`
- [ ] 源 change 中无 output 文件时不报错

---

## 不改动的部分

以下命令和行为保持不变，无需修改：

- `openspec new change`（除 `--from` 的轻模式适配外）
- `openspec change lineage`
- `openspec list`
- `openspec archive`
- `openspec artifact meta`（读取 `.artifact-meta.yaml`，自然兼容）
- 重模式的全部现有行为

---

## 示例：完整的轻量 DAG 工作流

### 1. 创建 schema

```yaml
# openspec/schemas/btc-analysis/schema.yaml
name: btc-analysis
version: 1
description: BTC 仓位分析

artifacts:
  - id: macro
    task: 分析美联储利率政策对 BTC 的影响
    requires: []

  - id: onchain
    task: 分析 BTC 链上数据：大户持仓变化、交易所净流入、MVRV 比率
    requires: []

  - id: technical
    task: 分析 BTC 日线和 4H 级别的技术形态、关键支撑阻力位
    requires: []

  - id: synthesize
    task: 综合以上三个维度的分析，给出 BTC 仓位调整建议
    requires: [macro, onchain, technical]

  - id: risk-check
    task: 检查仓位建议是否符合风控规则（单票仓位不超过总资金5%、日亏损不超过2%、相关性检查）
    requires: [synthesize]

apply:
  requires: [risk-check]
```

### 2. 创建 change

```bash
openspec new change btc-analysis-v1 --schema btc-analysis
```

### 3. 查看状态

```bash
openspec status --change btc-analysis-v1 --json
```

```json
{
  "changeName": "btc-analysis-v1",
  "schemaName": "btc-analysis",
  "isComplete": false,
  "artifacts": [
    { "id": "macro",      "status": "ready" },
    { "id": "onchain",    "status": "ready" },
    { "id": "technical",  "status": "ready" },
    { "id": "synthesize", "status": "blocked" },
    { "id": "risk-check", "status": "blocked" }
  ]
}
```

### 4. 获取 ready artifact 的指令

```bash
openspec instructions macro --change btc-analysis-v1 --json
```

```json
{
  "changeName": "btc-analysis-v1",
  "artifactId": "macro",
  "schemaName": "btc-analysis",
  "changeDir": "/path/to/openspec/changes/btc-analysis-v1",
  "task": "分析美联储利率政策对 BTC 的影响",
  "dependencies": []
}
```

LLM 拿到 task 后，构建子 agent prompt 并派发执行。

### 5. 子 agent 完成后，记录产出

子 agent 的产出写入临时文件，然后调用 artifact complete：

```bash
openspec artifact complete macro \
  --change btc-analysis-v1 \
  --summary "美联储 3 月转鸽，就业超预期，中期 bullish，短期有回调风险" \
  --output-file /tmp/macro-output.txt
```

产出内容被存储到 `.artifact-output/macro.txt`，摘要存储到 `.artifact-meta.yaml`。

### 6. 下游节点获取上游产出路径

```bash
openspec instructions synthesize --change btc-analysis-v1 --json
```

```json
{
  "changeName": "btc-analysis-v1",
  "artifactId": "synthesize",
  "schemaName": "btc-analysis",
  "changeDir": "/path/to/openspec/changes/btc-analysis-v1",
  "task": "综合以上三个维度的分析，给出 BTC 仓位调整建议",
  "dependencies": [
    {
      "id": "macro",
      "outputPath": ".artifact-output/macro.txt",
      "summary": "美联储 3 月转鸽，就业超预期，中期 bullish，短期有回调风险"
    },
    {
      "id": "onchain",
      "outputPath": ".artifact-output/onchain.txt",
      "summary": "交易所净流入为正，鲸鱼地址减持 12000 BTC"
    },
    {
      "id": "technical",
      "outputPath": ".artifact-output/technical.txt",
      "summary": "日线下降通道上沿，4H 出现看跌背离"
    }
  ]
}
```

LLM 将 task、依赖文件路径传给子 agent。子 agent 用 Read 工具读取上游产出文件，完成自己的分析。

### 7. 迭代

```bash
# 创建 v2，复用 v1 中已完成的 artifact
openspec new change btc-analysis-v2 \
  --schema btc-analysis \
  --from btc-analysis-v1 \
  --parent btc-analysis-v1
```
