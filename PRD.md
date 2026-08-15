# DeepSeek Harness Reproducible Distribution
## PRD v2.3 — Freeze · Prove · Reproduce · Package

**状态：** MVP Architecture Freeze / Ready for Implementation  
**日期：** 2026-08-15  
**项目代号：** DSH Stack（正式名称后定）  
**上游：** DeepSeek Harness  
**核心定位：** Reproducible Distribution Layer for DeepSeek Harness  
**本文替代：** PRD v2.2 及之前版本  
**第一阶段目标：** 将一套真实可工作的 DeepSeek Harness Profile 冻结，并证明其能够在干净环境中重新构建和启动  
**最终端到端验收：** 将官方默认 Harness Profile 通过同一套标准流程打包为普通用户可直接下载安装和运行的 Reference Client  
**产品原则：** 不重新实现 Harness、Profile、Plugin、pnpm 或官方 Web UI

---

# 1. Executive Summary

DeepSeek Harness 已经解决：

> **如何组合 Agent。**

DeepSeek Harness 通过：

```text
Plugin
↓
Bundle
↓
Profile
↓
Harness Runtime
```

实现可组合 Agent Runtime。

本项目不重新解决 Composition。

本项目解决：

> **如何证明一套已经工作的组合，可以被别人可靠地重新得到。**

最终核心链路：

```text
Working DSH Profile
        ↓
      Freeze
        ↓
Portable Reproducibility Artifact
        ↓
       Prove
        ↓
Clean-room Reconstruction
        ↓
Verification Receipt
        ↓
       Run
```

一句话：

> **Freeze a working Harness profile. Prove it works somewhere clean.**

长期表达：

> **DeepSeek Harness makes agents composable.  
> DSH Stack makes those compositions reproducible and distributable.**

---

# 2. 我们到底保证什么

这是整个项目最重要的 Contract。

## 2.1 我们保证

项目追求：

# Runtime Environment Reproducibility

即在满足明确前置条件的情况下：

```text
相同 Stack Artifact
+
相同支持的平台/Architecture
+
固定 Harness Version
+
固定 Profile Inputs
+
Frozen Dependency Closure
+
满足声明的 External Requirements
```

应该能够：

```text
重新安装依赖
↓
恢复相同 Profile 定义
↓
加载相同 Plugin Graph
↓
成功启动 Harness
↓
通过确定性的 Core Verification
```

---

# 3. 我们不保证什么

项目**不保证 Agent Behavioral Determinism**。

以下内容可能随时间变化：

```text
LLM 输出
模型服务行为
第三方 API
搜索结果
网页内容
远程 MCP 服务
网络环境
外部数据库
系统服务
```

因此：

```text
Prompt A
```

不承诺永远得到：

```text
Response B
```

项目的 `reproducible` 指：

> **运行环境可重建。**

而不是：

> **Agent 行为逐 token 相同。**

所有 README、CLI 和文档中不得混淆这两个概念。

---

# 4. 与 DeepSeek Harness 的边界

## 4.1 DSH Profile

Profile 属于 DeepSeek Harness。

它是：

> **本地运行态 Composition。**

负责：

```text
Plugin installation
Bundle composition
Cordis patch
Runtime configuration
Harness startup
```

## 4.2 Stack

Stack 属于本项目。

它是：

> **一个可移植、可验证的 Profile Reproducibility Recipe。**

Stack 不替代 Profile。

关系必须始终保持：

```text
DSH Stack
    │
    │ materialize
    ▼
DSH Profile
    │
    ▼
DSH Bundle / Plugin
    │
    ▼
Harness
```

---

# 5. 绝对禁止重新实现的能力

禁止开发：

```text
新的 Plugin API
新的 Profile Format
新的 Dependency Resolver
新的 Package Manager
第二份 dependency lockfile
新的 Harness Runtime
新的 Agent Loop
新的 Harness Chat UI
新的 Tool UI
Universal Agent Runtime
```

---

# 6. Source of Truth

## Dependency Graph

Source of Truth：

```text
package.json
+
pnpm-lock.yaml
```

## Profile Configuration

Source of Truth：

> 当前 DeepSeek Harness 原生 Profile-owned files。

## Stack Metadata

Source of Truth：

```text
stack.yaml
```

## Artifact Integrity

Source of Truth：

```text
stack.integrity.json
```

## Verification Evidence

Source of Truth：

```text
verification.receipt.json
```

---

# 7. MVP 核心价值

第一阶段只证明三件事：

```text
Freeze
↓
Prove
↓
Reproduce
```

CLI 核心命令：

```bash
dsh-stack freeze
dsh-stack verify
dsh-stack run --clean
```

如果这三件事不能形成独立价值：

> **停止项目。**

禁止因为已经投入开发而继续建设 Studio、Registry 或 Desktop。

---

# 8. 核心用户

## 8.1 Harness Power User

> 我调好了一套 Harness，怎么可靠地交给别人？

## 8.2 Plugin / Bundle 作者

> 我的插件组合到底在哪些 Harness Version / OS 上真实工作？

## 8.3 普通用户

> 我不想研究几十个插件，我只想运行别人已经证明可用的一套环境。

## 8.4 团队

长期问题：

> 怎么确保所有成员运行的是同一套经过验证的 Agent 环境？

不是 MVP，但架构不得阻塞此方向。

---

# 9. Freeze

命令：

```bash
dsh-stack freeze --profile web
```

目标：

> 将一套当前健康的 DSH Profile 冻结为可移植 Artifact。

---

# 10. Freeze 不是 Copy Folder

`freeze` 必须先证明：

> 当前 Profile 本身处于一致状态。

完整流程：

```text
Locate Profile
↓
Inspect Environment
↓
Consistency Preflight
↓
Portability Analysis
↓
Secret Scan
↓
Capture Profile-owned Inputs
↓
Capture Harness / Toolchain Metadata
↓
Generate Stack Manifest
↓
Generate Integrity Manifest
```

---

# 11. Consistency Preflight

这是 Freeze 的 P0 前置条件。

检查当前 Profile 的：

```text
package.json
pnpm-lock.yaml
installed dependency state
DSH bundle declaration
Cordis references
Profile-owned configuration
```

是否相互一致。

---

# 12. 为什么必须 Preflight

可能存在：

```text
package.json       = State A
pnpm-lock.yaml     = State B
node_modules       = State C
Cordis patch       = State D
```

而当前机器由于缓存或残留环境恰好还能运行。

这种 Profile 不能被视为健康 Distribution Source。

---

# 13. Preflight Result

状态：

```text
CONSISTENT
INCONSISTENT
UNKNOWN
```

只有 `CONSISTENT` 允许正常 Freeze。

---

# 14. Profile 不一致

返回：

```text
PROFILE_STATE_INCONSISTENT
```

并显示：

```text
Manifest dependency mismatch
Lockfile mismatch
Missing installed package
Dangling Bundle reference
Broken Cordis reference
```

---

# 15. Force Freeze

高级用户可以：

```bash
dsh-stack freeze --force
```

但产生的 Artifact 必须：

```yaml
source:
  consistency: unverified
```

并且所有后续 UI / Verify 明确展示：

> ⚠ Frozen from an inconsistent or unverified source profile.

---

# 16. Profile-owned Inputs

禁止代码中硬编码固定文件清单作为永远完整的 Profile 定义。

必须通过：

```text
HarnessAdapter
```

集中识别当前 Harness Version 下哪些文件属于 Profile Reproducibility Inputs。

---

# 17. MVP 至少需要识别

第一版至少处理：

```text
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
cordis.patch.yml
```

以及当前 Harness 官方 Profile 所需的其他配置文件。

---

# 18. Freeze 输出

推荐：

```text
research-agent/

├── stack.yaml
├── stack.integrity.json
├── profile/
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── pnpm-workspace.yaml
│   └── cordis.patch.yml
├── tests/
│   └── smoke.yaml
└── README.md
```

最终文件集由 HarnessAdapter 决定。

---

# 19. Stack Manifest

`stack.yaml` 只记录 DSH 原生 Profile 无法完整表达的 Distribution Metadata。

示例：

```yaml
schemaVersion: 1

id: research-agent
name: Research Agent
version: 0.1.0

description: >
  A reproducible DeepSeek Harness profile
  for research workflows.

harness:
  version: 0.1.0-rc.6

profile:
  source: ./profile

environment:
  node:
    required: ">=22"
    observed: "22.18.0"
  pnpm:
    observed: "10.x"

requirements:
  secrets:
    - DEEPSEEK_API_KEY

  platform:
    os:
      - macos
    arch:
      - arm64

source:
  consistency: verified

verification:
  tests:
    - ./tests/smoke.yaml
```

---

# 20. Stack Manifest 不得复制

禁止再次描述：

```text
完整 npm dependency graph
完整 Cordis graph
插件内部 configuration
pnpm dependency resolution
```

原则：

> **Stack Manifest = Distribution Metadata。**

不是 Profile 2.0。

---

# 21. Dependency Source Portability

Freeze 必须逐个检查 dependency source。

| Dependency | MVP 策略 |
|---|---|
| npm exact version | 支持 |
| npm range | 由 pnpm lock 固化 |
| tarball | 支持，记录 integrity |
| Git commit SHA | 支持 |
| Git branch/tag | 需要冻结为 commit SHA |
| local `link:` | 默认不可分发 |
| local `file:` | 需检查 portability |
| absolute local path | 默认拒绝 |
| workspace dependency | 根据具体结构分析 |

---

# 22. Git Dependency

Distribution 中 Git source 必须能够指向 immutable commit。

不能只依赖：

```text
main
master
develop
latest
```

Freeze 时应解析：

```text
branch/tag
↓
commit SHA
```

并将结果记录在 Artifact / Integrity Metadata 中。

---

# 23. Local Dependency

例如：

```text
link:/Users/alice/code/my-plugin
```

属于：

```text
NON_PORTABLE_DEPENDENCY
```

默认 Freeze FAIL。

---

# 24. Vendor Local

未来可支持：

```bash
dsh-stack freeze --vendor-local
```

将本地 package：

```text
pack
↓
hash
↓
vendor
```

进 Stack Artifact。

但不是 V0.1 必须项。

---

# 25. Integrity Manifest

Freeze 生成：

```text
stack.integrity.json
```

示例：

```json
{
  "schemaVersion": 1,
  "algorithm": "sha256",
  "files": {
    "stack.yaml": "sha256-...",
    "profile/package.json": "sha256-...",
    "profile/pnpm-lock.yaml": "sha256-...",
    "profile/pnpm-workspace.yaml": "sha256-...",
    "profile/cordis.patch.yml": "sha256-..."
  }
}
```

Verify 前必须重新计算。

---

# 26. Integrity ≠ Trust

Hash 只能证明 Artifact 没发生预期外变化。

不能证明 Plugin 是安全的。

---

# 27. Secret Scan

Freeze 必须扫描可能被误打包的：

```text
API Keys
Tokens
Private Keys
Passwords
Credentials
.env
Auth cache
```

---

# 28. Secret Policy

默认：

```text
疑似高置信 Secret
↓
BLOCK FREEZE
```

低置信：

```text
WARN
```

用户可显式 override，但必须记录。

---

# 29. Stack 只声明 Secret Name

例如：

```yaml
requirements:
  secrets:
    - DEEPSEEK_API_KEY
```

严禁保存 Secret Value。

---

# 30. Freeze 默认排除

```text
Session history
Prompt history
Responses
Logs
Caches
Temporary files
User home files
API credentials
Model conversation data
```

Stack 是 Environment Definition，不是 User Data Backup。

---

# 31. Verify

命令：

```bash
dsh-stack verify ./research-agent
```

目标：

> **证明 Artifact 能够在一个新的环境中重建出健康的 Harness Profile。**

---

# 32. Verify 分层

验证必须分成：

```text
Static Verification
+
Runtime Verification
```

---

# 33. Static Verification

不运行第三方插件代码。

检查：

```text
Stack schema
Artifact integrity
Harness version metadata
Platform requirement
Dependency source portability
Lockfile presence
Required files
Secret requirements
Known structural inconsistency
```

---

# 34. Runtime Verification

会执行第三方代码，包括：

```text
Dependency installation
Git package prepare scripts
Plugin code
Harness startup
Bundle activation
```

执行前必须明确提示：

> **Runtime verification executes third-party code from this Stack.**

---

# 35. Disposable Environment ≠ Security Sandbox

V0.1 使用：

```text
temporary DSH_HOME
temporary profile
isolated dependency directory
```

目标是 Reproducibility Isolation，不是 Malicious Code Isolation。

---

# 36. V0.1 不得宣称

禁止文案：

```text
Secure sandbox
Safe plugin verification
Malware-proof
Isolated from your computer
```

除非未来真的实现 OS/VM 级安全边界。

---

# 37. Future SandboxProvider

架构预留：

```ts
interface VerificationEnvironmentProvider {
  create(): Promise<VerificationEnvironment>
  destroy(): Promise<void>
}
```

未来实现：

```text
LocalDisposable
Container
VM
HostedWorker
```

MVP 只实现：

```text
LocalDisposable
```

---

# 38. Clean Environment 的严格定义

MVP 中 `clean` 至少意味着：

```text
新的 DSH_HOME
新的 Profile directory
新的 dependency installation directory
不复用当前 Profile node_modules
使用冻结的 profile inputs
使用指定 Harness version
```

---

# 39. Clean 不意味着

```text
新的 OS VM
完全空白机器
无权访问用户文件系统
无网络
恶意代码隔离
```

---

# 40. Verify Pipeline

```text
Read Stack
↓
Static Verification
↓
Integrity Verification
↓
Environment Requirement Check
↓
Create Disposable Environment
↓
Install Required Harness Version
↓
Materialize Native Profile
↓
Frozen Dependency Installation
↓
Boot Harness
↓
Activate Plugin Graph
↓
Run Core Verification
↓
Generate Receipt
↓
Destroy Environment
```

---

# 41. Frozen Dependency Installation

必须使用：

```text
pnpm --frozen-lockfile
```

或当前 pnpm 对等严格模式。

禁止 Verify 自动修改 `pnpm-lock.yaml`。

---

# 42. Core Verification

默认 Verify 不得依赖真实 LLM 响应。

Core Verification 应验证：

```text
Harness installs
Harness boots
Profile loads
Expected bundles activate
Expected plugins activate
Runtime reaches healthy state
Session subsystem is available
```

---

# 43. 为什么默认不调用 LLM

真实模型引入：

```text
API Key
Cost
Network
Rate Limit
Provider Availability
Non-deterministic Response
```

会污染 Runtime Environment Reproducibility。

---

# 44. Live Verification

额外命令：

```bash
dsh-stack verify --live
```

才可以执行：

```text
Real LLM
External API
Remote MCP
Network Tool
External Database
```

---

# 45. Verification Level

Receipt 必须声明：

```text
static
runtime
live
```

---

# 46. Smoke Test DSL

MVP 默认只需要 deterministic checks。

例如：

```yaml
tests:

  - name: harness boots
    type: runtime.health

  - name: browser plugin activates
    type: capability.exists
    capability: browser
```

---

# 47. Live Test

只有：

```yaml
mode: live
```

才允许：

```yaml
tests:

  - name: model responds
    type: prompt
    prompt: "Reply with OK"
    expect:
      responseContains: "OK"
```

---

# 48. Verification Receipt

这是项目的一等公民。

文件：

```text
verification.receipt.json
```

它表达：

> **某个 exact Stack 在某个 exact environment 中实际验证结果的机器可读证明。**

---

# 49. Receipt 核心字段

建议：

```json
{
  "schemaVersion": 1,

  "stack": {
    "id": "research-agent",
    "version": "0.1.0",
    "integrity": "sha256-..."
  },

  "verification": {
    "level": "runtime",
    "result": "pass",
    "startedAt": "...",
    "finishedAt": "..."
  },

  "environment": {
    "os": "macos",
    "arch": "arm64",
    "node": "22.18.0",
    "pnpm": "10.x"
  },

  "harness": {
    "version": "0.1.0-rc.6"
  },

  "checks": []
}
```

---

# 50. Receipt 必须能够回答

```text
验证的是哪一个 Stack？
Stack 有没有被修改？
在哪里验证？
用什么 Harness？
使用什么 Node / pnpm？
进行了哪些检查？
是否执行第三方代码？
是否调用真实外部服务？
哪一步失败？
什么时候验证？
```

---

# 51. Receipt Immutable Identity

Receipt 应绑定 Stack Artifact Hash。

如果 Stack 发生任何影响运行的修改，旧 Receipt 对当前 Stack 失效。

---

# 52. Verification Result

至少支持：

```text
PASS
FAIL
UNSUPPORTED
INCOMPLETE
```

---

# 53. UNSUPPORTED

例如：

```text
Absolute local dependency
Unsupported OS
Unsupported dependency source
Harness version unavailable
```

应该返回：

```text
UNSUPPORTED
```

而不是危险 fallback。

---

# 54. Zero False PASS

这是 MVP 最重要的质量指标。

目标不是尽可能多让 Stack PASS，而是：

> **绝不能把已知不能稳定复现的 Stack 判为 PASS。**

---

# 55. MVP 核心质量标准

测试集合中：

> **0 个已知不可复现场景被 Runtime Verify 判定为 PASS。**

---

# 56. Error Taxonomy

至少：

```text
STACK_SCHEMA_ERROR
STACK_INTEGRITY_ERROR
PROFILE_STATE_INCONSISTENT
NON_PORTABLE_DEPENDENCY
SECRET_DETECTED
HARNESS_VERSION_UNAVAILABLE
UNSUPPORTED_PLATFORM
FROZEN_INSTALL_FAILED
PROFILE_MATERIALIZATION_FAILED
CORDIS_CONFIGURATION_ERROR
PLUGIN_ACTIVATION_FAILED
HARNESS_BOOT_FAILED
CAPABILITY_MISSING
SMOKE_TEST_FAILED
LIVE_DEPENDENCY_UNAVAILABLE
VERIFICATION_INCOMPLETE
```

---

# 57. Error 必须 Actionable

错误必须回答：

```text
What happened?
At which stage?
Which component?
Is Stack broken or environment unsupported?
Can the user fix it?
How?
```

---

# 58. Verify Report

人类输出示例：

```text
Research Agent 0.1.0

Artifact
✓ Schema
✓ Integrity

Source
✓ Profile consistency verified

Platform
✓ macOS arm64

Harness
✓ 0.1.0-rc.6

Dependencies
✓ Frozen install

Profile
✓ Materialized

Plugins
✓ 8/8 activated

Runtime
✓ Harness healthy

Verification
Runtime

RESULT
PASS

Receipt:
./verification.receipt.json
```

---

# 59. Failure 示例

```text
RESULT
FAIL

Stage:
Plugin Activation

Plugin:
example-memory

Error:
PLUGIN_ACTIVATION_FAILED

Harness:
0.1.0-rc.6

Suggested action:
Use a compatible plugin version or update the source profile before freezing.
```

---

# 60. Run --clean

命令：

```bash
dsh-stack run ./research-agent --clean
```

使用与 Verify 相同的 materialization pipeline。

区别：

```text
verify
=
build → test → receipt → exit
```

```text
run
=
build → boot → keep running
```

---

# 61. Verify 和 Run 必须共享实现

必须共用：

```text
StackMaterializer
```

避免 Verify 通过、Run 失败。

---

# 62. Run 使用官方 Harness UI

启动后：

```text
Harness Runtime
↓
Official Web UI
```

不开发新的：

```text
Conversation UI
Timeline
Composer
Approval UI
Tool Renderer
Session UI
```

---

# 63. HarnessAdapter

所有 DSH-specific knowledge 集中：

```text
packages/harness-adapter
```

负责：

```ts
interface HarnessAdapter {
  detectInstallation(): Promise<HarnessInstallation>
  detectVersion(): Promise<string>
  locateProfile(name: string): Promise<ProfileLocation>
  inspectProfile(profile: ProfileLocation): Promise<ProfileInspection>
  getReproducibilityInputs(profile: ProfileLocation): Promise<ProfileInput[]>
  preflight(profile: ProfileLocation): Promise<ProfileConsistencyResult>
  materialize(
    stack: StackArtifact,
    destination: string
  ): Promise<MaterializedProfile>
  start(
    environment: HarnessEnvironment
  ): Promise<HarnessProcess>
}
```

---

# 64. Harness Version Compatibility

HarnessAdapter 必须允许 version-specific compatibility，但不要过早设计复杂 framework。

初期：

```text
adapters/
  current.ts
```

真实 breaking change 出现后再拆：

```text
rc6.ts
rc7.ts
```

---

# 65. Harness Version 必须 Exact Pin

Stack 必须记录 exact version，例如：

```text
0.1.0-rc.6
```

禁止最终 Distribution 使用：

```text
latest
^0.1
>=rc6
```

---

# 66. Toolchain Metadata

Freeze 至少记录观察到的：

```text
Node
pnpm
OS
Architecture
```

区分 Observed 和 Required。

---

# 67. Test Fixtures

必须至少覆盖：

```text
healthy-profile
broken-lockfile
missing-package
dangling-bundle
bad-cordis-patch
duplicate-runtime-package
plugin-activation-failure
non-portable-local-link
git-floating-reference
missing-secret
unsupported-platform
tampered-stack
```

---

# 68. Fixtures 来源

优先真实社区 failure pattern，其次最小化人工 reproduction。

---

# 69. Tests

至少四层：

## Unit

```text
schema
integrity
portability detection
error mapping
```

## Integration

```text
freeze real fixture
materialize
frozen install
```

## Runtime

```text
boot Harness
activate profile
```

## Regression

真实坏案例不得重新变为 PASS。

---

# 70. Real-world MVP Validation

完成工程实现后，至少寻找：

```text
10 个真实 DSH Profile / Configuration
```

进行：

```text
Source Environment
↓
Preflight
↓
Freeze
↓
Fresh Materialization
↓
Runtime Verify
↓
Clean Run
```

---

# 71. MVP 不以 8/10 PASS 为目标

新指标强调结果准确性。

---

# 72. MVP 成功条件 A — No False PASS

已知不可复现情况不能被判 PASS。

---

# 73. MVP 成功条件 B — Real Reproduction

至少存在多组：

```text
Environment A
↓
Freeze
↓
Environment B
↓
Verify PASS
↓
Run successfully
```

---

# 74. MVP 成功条件 C — Real Detection

Verify 至少提前发现：

```text
3 类真实世界故障
```

且错误比直接运行 Harness 更容易理解或更早暴露。

---

# 75. MVP 成功条件 D — Real Sharing

至少一位非项目开发者：

```text
Freeze own profile
↓
send artifact
↓
another user verifies
↓
another user runs
```

---

# 76. MVP 成功条件 E — User Preference

至少部分测试用户明确认为：

> 相比直接复制 Profile / README 指令，这种方式更可靠或更省事。

---

# 77. Go / No-Go

完成 V0.1 后强制：

# STOP AND REVIEW

---

# 78. GO 条件

```text
Freeze 可捕获真实工作状态
Verify 能发现真实问题
Clean-room reconstruction 成立
Verification Receipt 有明确价值
用户有实际分享需求
```

---

# 79. NO-GO 条件

如果出现：

```text
Profile 原生复制已经足够可靠
pnpm-lock 完全解决问题
Verify 只会发现语法错误
Receipt 没有人关心
用户不存在分享 Profile 的需求
大部分 Profile 根本无法定义可移植边界
```

则停止。

---

# 80. V0.1 Scope

只开发：

```text
freeze
inspect
verify
run --clean
verification receipt
```

---

# 81. V0.1 Definition of Done

## Profile Inspection

- [ ] 自动检测 Harness
- [ ] 自动检测 Harness version
- [ ] 自动定位 Profile
- [ ] 识别 Profile-owned reproducibility inputs
- [ ] Consistency Preflight

## Freeze

- [ ] stack.yaml
- [ ] integrity manifest
- [ ] secret scan
- [ ] platform metadata
- [ ] toolchain metadata
- [ ] dependency portability analysis
- [ ] Git SHA pin detection
- [ ] non-portable dependency error

## Verify

- [ ] Static Verification
- [ ] Runtime Verification
- [ ] Disposable DSH_HOME
- [ ] isolated Profile
- [ ] frozen dependency install
- [ ] Harness boot
- [ ] plugin activation
- [ ] deterministic Core Verification
- [ ] `--live` architecture reserved

## Receipt

- [ ] artifact identity
- [ ] environment metadata
- [ ] Harness version
- [ ] verification level
- [ ] checks
- [ ] timestamps
- [ ] PASS / FAIL / UNSUPPORTED / INCOMPLETE

## Run

- [ ] same materializer as Verify
- [ ] clean environment
- [ ] official Harness UI
- [ ] graceful shutdown

## Quality

- [ ] fixtures
- [ ] regression tests
- [ ] zero known false PASS
- [ ] diagnostics
- [ ] sanitized logs

## Validation

- [ ] ≥10 real-world Profile experiments
- [ ] real cross-environment reproduction
- [ ] at least 3 real failure categories detected
- [ ] at least one real user-to-user sharing test

---

# 82. V0.2 — Pack & Share

只有 V0.1 GO 后启动。

新增：

```bash
dsh-stack pack
```

生成：

```text
research-agent.dshstack
```

---

# 83. `.dshstack`

本质是：

```text
Stack Manifest
Profile Inputs
Integrity Manifest
Tests
Optional Verification Receipts
Metadata
```

---

# 84. Pack 不包含

默认禁止：

```text
Secrets
Sessions
Prompt history
node_modules
cache
user files
```

依赖在目标环境 frozen install。

---

# 85. V0.3 — Verification CI

建议放在 Registry 之前。

提供：

```text
GitHub Action / CI command
```

例如：

```bash
dsh-stack verify --ci
```

输出：

```text
verification.receipt.json
```

以及 machine-readable exit code。

---

# 86. CI Badge

未来：

```text
macOS arm64 ✅
Linux x64 ✅
Windows x64 ❌
```

必须来自实际验证结果。

---

# 87. Upgrade Verification

当 Harness 发布新版本：

```text
Current Stack
↓
Clone
↓
Change Harness version
↓
Verify
↓
Receipt
```

输出：

```text
Current rc6   ✅
Candidate rc7 ❌

Failure:
Plugin activation
```

---

# 88. V0.4 — Registry

只有出现多人分享 Stack + Verification Receipt 的实际需求后开发。

Registry 一等公民：

```text
Verified Distribution
```

而不是 Plugin。

---

# 89. Registry 核心内容

```text
Stack
Version
Artifact Integrity
Harness Version
Supported Platform
Verification Receipts
Last Verified
Source
```

---

# 90. Registry 初期不做

```text
Plugin Marketplace
Ratings
Reviews
Payment
Social Feed
Recommendation Algorithm
```

---

# 91. V0.5 — Studio

只有 CLI 有真实采用后开发。

Studio 是 CLI 的 GUI，负责：

```text
Inspect
Freeze
Verification
Receipts
Versions
Share
```

不是 Harness Client、IDE 或 Plugin Store。

---

# 92. Desktop Distribution

继续后移。

只有明确出现：

> 普通用户希望完全不安装 DSH / Node / CLI

的需求时开发。

---

# 93. Desktop 原则

如果开发：

```text
Stack
↓
Distribution Builder
↓
Desktop App
```

必须继续使用官方 Harness Web UI。

Desktop 只负责：

```text
Runtime packaging
Node runtime
Window
Updater
OS integration
```

---

# 94. 当前不冻结 Electron / Tauri

Desktop 真正进入开发前重新评估。

---

# 95. 长期核心数据资产

如果项目成立，真正的数据飞轮是：

# Verification Graph

```text
Stack
× Harness Version
× Profile Dependency Graph
× OS
× Architecture
× Verification Level
× Result
× Failure Cause
```

---

# 96. 长期价值：Compatibility as Evidence

不是：

> “这个 Plugin 应该兼容。”

而是：

> **这套 exact distribution 在这个 exact environment 中真实通过。**

---

# 97. Potential Hosted Services

如果社区规模成立，可以提供：

```text
Cross-platform Verification CI
Private Distribution Registry
Continuous Upgrade Verification
Organization Policies
Signed Verification Receipts
Hosted Desktop Builds
Provenance
Team Distribution
Compatibility Monitoring
```

---

# 98. 商业化不是第一目标

开源核心建议长期保持：

```text
Freeze
Verify
Run
Pack
```

真正可能形成商业价值的是：

```text
规模化验证
跨平台基础设施
私有 Registry
团队治理
持续升级验证
软件供应链 Provenance
```

---

# 99. 项目长期风险

最大风险：

> **DeepSeek Harness 本身没有形成长期生态。**

因此现在不能投入重资产平台建设。

---

# 100. 第二大风险

DeepSeek 官方未来可能加入：

```text
dsh profile freeze
dsh profile verify
dsh profile export
```

这不应被视为项目失败。

---

# 101. Upstream Absorption Strategy

如果官方吸收核心能力，可以贡献实现 upstream，然后项目向：

```text
Cross-platform Verification
Verification Registry
Team Distribution
Compatibility Infrastructure
```

继续发展。

---

# 102. 我们真正的护城河不是什么

不是：

```text
Stack YAML
CLI
React
Tauri
Zip format
```

---

# 103. 真正可能形成价值的东西

```text
Verification methodology
真实 failure fixtures
Clean-room reconstruction
Verification receipts
Compatibility evidence
Upgrade testing history
Community trust
```

---

# 104. Repository

推荐：

```text
dsh-stack/

packages/

  schema/
  harness-adapter/
  profile-inspector/
  preflight/
  freeze/
  integrity/
  portability/
  secrets/
  materializer/
  verifier/
  verification-receipt/
  runner/
  diagnostics/
  cli/
  testkit/

fixtures/

  healthy/
  broken-lockfile/
  dangling-bundle/
  broken-cordis/
  duplicate-runtime/
  activation-failure/
  local-link/
  floating-git/
  tampered-stack/

examples/

  minimal/
  coding/
  research/

docs/
```

---

# 105. 技术栈

Core：

```text
TypeScript
Node.js
pnpm
```

尽量贴近 DeepSeek Harness 原生生态。

---

# 106. CLI 设计

V0.1：

```bash
dsh-stack inspect
dsh-stack freeze
dsh-stack verify
dsh-stack run
```

---

# 107. CLI Exit Codes

CLI 必须适合 CI。

至少：

```text
0 = PASS / SUCCESS
1 = FAIL
2 = UNSUPPORTED
3 = INVALID INPUT
4 = INTERNAL ERROR
```

具体编号可由实现确定，但必须稳定并文档化。

---

# 108. Diagnostics

例如：

```bash
dsh-stack verify --diagnostics
```

输出：

```text
diagnostics/

environment.json
profile-inspection.json
validation.json
sanitized-install.log
sanitized-runtime.log
```

---

# 109. Logs 必须脱敏

禁止 diagnostics 包含：

```text
API Key
Bearer token
Cookie
Private key
Password
Secret environment variable value
```

---

# 110. Observability

每一步产生阶段状态：

```text
INSPECT
PREFLIGHT
FREEZE
STATIC_VERIFY
MATERIALIZE
INSTALL
BOOT
ACTIVATE
CORE_TEST
LIVE_TEST
```

失败必须知道发生在哪一阶段。

---

# 111. Performance

MVP 不追求极致速度。

优先级：

```text
Correctness
>
Explainability
>
Security honesty
>
Performance
```

---

# 112. Cache

初期可以不做复杂 cache。

Verify 的价值来自 Fresh Reconstruction。

如果后续加入 cache，必须支持：

```text
--no-cache
```

---

# 113. Verification Receipt 与 Cache

任何被标记为 clean-room verified 的 Receipt 必须明确记录：

```text
cacheUsed: false
```

或者记录具体 cache policy。

---

# 114. Agent 实施顺序

严格执行。

## Milestone 0 — Foundation

```text
monorepo
CLI skeleton
CI
testing
logging
```

## Milestone 1 — Harness Inspection

```text
Harness detection
Profile location
Profile-owned inputs
Version detection
```

## Milestone 2 — Preflight

```text
consistency checks
dependency portability
secret scanning
```

## Milestone 3 — Freeze

```text
stack schema
artifact
integrity
metadata
```

## Milestone 4 — Materializer

```text
temporary DSH_HOME
restore profile
install Harness
frozen install
```

## Milestone 5 — Verification

```text
static verify
runtime boot
plugin activation
core smoke test
```

## Milestone 6 — Receipt

```text
verification.receipt.json
human report
error taxonomy
```

## Milestone 7 — Clean Run

```text
same materialization pipeline
official Web UI
```

## Milestone 8 — Real-world Validation

```text
10+ profiles
cross-environment tests
failure fixtures
user-to-user sharing
```

然后：

# STOP AND REVIEW

---

# 115. Agent 不得提前执行

```text
Registry
Studio
Desktop Builder
Marketplace
Universal Agent Support
Custom Resolver
New Plugin API
Harness UI
```

---

# 116. Agent 无需再次确认的决策

已冻结：

```text
DeepSeek Harness only
DSH Profile remains composition primitive
pnpm remains dependency resolver
pnpm-lock remains dependency lock
Stack stores distribution metadata only
No duplicate lockfile
No Plugin ecosystem fork
No Harness UI rewrite
CLI-first
Consistency Preflight required
Environment reproducibility only
Disposable environment is not a security sandbox
Static and Runtime Verification separated
Core Verification does not require LLM
Verification Receipt is first-class
Zero False PASS priority
No Registry/Studio/Desktop before Go Review
```

---

# 117. Agent 可以自行决定

```text
CLI library
schema validation library
hash implementation
internal classes
temporary directory structure
logging framework
testing framework
exact interface naming
```

不得改变上位 contract。

---

# 118. 每个 Milestone 必须报告

1. Implementation Summary
2. Files Changed
3. Architecture Decisions
4. Tests Added
5. Test Results
6. Failure Fixtures Added
7. Known Limitations
8. Security Boundaries
9. PRD Deviations
10. Readiness for Next Milestone

其中 `PRD Deviations` 默认：

```text
None
```

---

# 119. 项目最终成功定义

不是 Stack 文件能生成，不是 Profile 可以压缩成 ZIP，也不是 Doctor 能发现错误。

真正成功是：

```text
Person A

Working Harness Profile
        ↓
     Preflight
        ↓
      Freeze
        ↓
Portable Exact Artifact
        ↓
      Share
        ↓

Person B / Clean Environment

      Static Verify
          ↓
      Materialize
          ↓
      Frozen Install
          ↓
       Harness Boot
          ↓
    Plugin Activation
          ↓
      Runtime Verify
          ↓
 Verification Receipt
          ↓
          PASS
          ↓
          Run
```

并且这个流程：

> **比 README + 手工配置 + 复制目录更加可靠。**

---

# 120. 最终价值判断

DeepSeek Harness 已经让 Agent：

> **Composable**

本项目让这些 Composition：

> **Provable**

然后才是：

> **Portable**

最后才可能是：

> **Distributable**

因此更准确的产品演进是：

```text
Freeze
↓
Prove
↓
Reproduce
↓
Share
↓
Continuously Verify
↓
Distribute
```

真正最核心的词不是 Stack，而是：

# **Proof**

---
---

# 121. Reference Distribution UAT — 最终端到端验收

Reference Client 不是另一个独立产品方向。

它是：

> **DSH Stack 的官方 Reference Case / End-to-End Acceptance Case。**

它的作用是证明本项目不仅能够在工程师环境中完成 Freeze / Verify / Reproduce，还能够把一套经过验证的 Harness Profile 真正变成普通用户可消费的软件产品。

Reference Client 必须由本项目的标准 Distribution Pipeline 生成。

禁止：

```text
Reference Client
↓
特殊 hardcode
↓
绕过 Stack / Materializer / Verification
```

必须：

```text
Official Default Harness Profile
        ↓
      Freeze
        ↓
      Verify
        ↓
Verification Receipt
        ↓
      Package
        ↓
Reference Client Installer
```

---

# 122. Reference Client 输入

第一版 Reference Distribution 优先使用：

> **DeepSeek Harness 官方默认 Profile / 最接近 Vanilla Harness 的稳定 Profile。**

原则：

```text
尽可能少的额外插件
尽可能少的自定义配置
尽可能贴近官方默认体验
```

原因：

Reference Client 的目的不是证明我们能做一个复杂 Agent，而是证明：

> **任何健康的 Harness Profile 都可以被标准化地分发。**

---

# 123. Reference Client 输出

最终至少生成：

```text
macOS:
.dmg / .app
```

后续：

```text
Windows:
.exe / installer
```

普通用户的期望路径：

```text
Download
↓
Install
↓
Open
↓
Configure required secret / API key
↓
Use Harness
```

---

# 124. 普通用户不得被要求

Reference Client UAT 中，测试用户不得被要求：

```text
安装 Node
安装 pnpm
安装 dsh CLI
手工安装 Harness
手工安装 Plugin
修改 package.json
修改 pnpm-lock.yaml
修改 cordis.patch.yml
打开 Terminal 修复环境
阅读 Harness 内部架构文档
```

如果这些步骤中的任何一步成为正常使用前置条件：

> **Reference Distribution UAT 判定失败。**

---

# 125. Reference Client UI 原则

客户端不重新实现 DeepSeek Harness Web UI。

客户端 Native Shell 只负责：

```text
Runtime packaging
Runtime lifecycle
Window
Secret onboarding
Native file dialog
Updater
OS integration
Diagnostics
```

Agent 使用体验继续复用：

> **官方 DeepSeek Harness Web UI。**

因此 Reference Client 的核心不是 UI 创新，而是：

> **Distribution correctness。**

---

# 126. Reference Client 与 Stack 的关系

Reference Client 必须本身来自一个标准 Stack，例如：

```text
reference/
├── stack.yaml
├── stack.integrity.json
├── profile/
├── tests/
└── verification.receipt.json
```

通过：

```text
dsh-stack package ./reference
```

生成客户端。

未来任何其他 Stack 都应该能够走相同流程：

```text
Research Stack
↓
Package
↓
Research Agent.app
```

```text
Coding Stack
↓
Package
↓
Coding Agent.app
```

如果 Reference Client 依赖专属构建逻辑：

> **说明 Distribution Layer 抽象失败。**

---

# 127. Package 命令

Reference UAT 阶段增加：

```bash
dsh-stack package ./reference
```

输入：

```text
Verified Stack Artifact
```

必须要求至少存在：

```text
Runtime Verification PASS
```

或在 package 流程中重新执行 Runtime Verification。

输出：

```text
Installable Desktop Distribution
```

---

# 128. Package Pipeline

推荐：

```text
Read Stack
↓
Static Verify
↓
Runtime Verify / Validate Receipt
↓
Materialize Exact Environment
↓
Bundle Required Runtime
↓
Bundle Official Harness UI
↓
Generate Thin Native Shell
↓
Embed Stack Metadata
↓
Package Installer
↓
Install on Fresh User Machine
↓
Launch
```

Package 与 `verify` / `run --clean` 必须尽可能共享：

```text
StackMaterializer
HarnessAdapter
Integrity
Verification
```

禁止重新发明第二套安装逻辑。

---

# 129. Client Runtime Ownership

Reference Client 应尽可能自包含自身运行所需环境。

普通用户不应该依赖系统已有：

```text
Node
pnpm
DSH
Profile
```

客户端应使用：

```text
Private Runtime
Private Profile
Private Dependency Environment
```

并避免污染：

```text
global npm
global pnpm
用户现有 DSH Profile
```

---

# 130. Reference Client Secrets

实际 Secret 不进入 Distribution Artifact。

首次启动可要求用户配置：

```text
DEEPSEEK_API_KEY
```

或其他 Stack 声明的必要 Secret。

Secret 必须存入系统安全存储或当前平台适当的 secure storage。

不得写入：

```text
Stack Artifact
package.json
plain-text config committed with distribution
```

---

# 131. Reference Distribution UAT

测试必须由：

> **非项目开发者**

完成。

测试机器：

> **没有预先配置该 Harness Profile。**

理想情况下：

> **没有系统级 Node / pnpm / dsh 依赖。**

完整流程：

```text
Project Team

Official Default Profile
↓
Freeze
↓
Verify
↓
Package
↓
Publish Installer


Test User

Download Installer
↓
Install
↓
Open App
↓
Enter required API Key
↓
Official Harness UI loads
↓
Create Session
↓
Complete one successful Agent Turn
```

---

# 132. Reference Distribution UAT 禁止开发者介入

测试过程中开发者不得：

```text
远程修改配置
让用户额外执行 CLI
手工安装插件
手工修改 Profile
补 Node/pnpm
修 package.json
修 lockfile
修改系统 PATH
```

如果需要开发者临时介入才能完成：

> **UAT FAIL。**

---

# 133. Reference Distribution 成功标准

必须同时满足：

- [ ] 客户端来自标准 Stack，而不是专属 hardcode
- [ ] Stack 在 Package 前 Runtime Verify PASS
- [ ] 客户端可以在干净测试机器完成安装
- [ ] 不要求用户安装 Node
- [ ] 不要求用户安装 pnpm
- [ ] 不要求用户安装 DSH CLI
- [ ] 不要求用户手工安装插件
- [ ] 不要求用户编辑配置文件
- [ ] 客户端能够启动指定 Harness Version
- [ ] 客户端能够加载指定 Profile
- [ ] 官方 Harness Web UI 正常打开
- [ ] 用户配置必要 Secret 后能够使用
- [ ] 至少完成一个真实 Agent Session
- [ ] 客户端退出和再次启动后仍能正常工作
- [ ] 出错时提供可理解的诊断，而不是白屏/静默退出

---

# 134. 两层完成标准

项目必须明确区分：

## Engineering MVP Complete

满足：

```text
Freeze
↓
Verify
↓
run --clean
```

在真实跨环境测试中成立。

这证明：

> **Reproducibility Layer 成立。**

## Product E2E Complete

满足：

```text
Official Default Harness Profile
↓
Freeze
↓
Verify
↓
Package
↓
Downloadable Reference Client
↓
Ordinary User Runs Successfully
```

这证明：

> **Reproducibility Layer 可以真正转化为 Distribution。**

---

# 135. 为什么 Reference Client 是 Case，而不是核心实现

客户端不能成为第一阶段技术重心。

否则项目容易退化成：

> 第 N 个 DeepSeek Harness Desktop。

正确关系：

```text
Core Product
=
Freeze + Proof + Reproduction


Reference Client
=
证明 Core Product 可以变成产品
```

因此客户端的价值在于：

> **验证 Distribution abstraction。**

不是：

> 自己提供一套比官方更漂亮的聊天 UI。

---

# 136. 最终产品验收口径

从普通用户角度，项目最终最直观的验收是：

> **团队能够把 DeepSeek Harness 官方默认 Profile，用 DSH Stack 的标准流程快速生成一个可公开下载的客户端；普通用户下载安装到一台没有预配置 Harness 环境的电脑后，只需提供必要 API Key，即可直接进入官方 Harness UI 并正常使用。**

这就是 Reference Distribution 的最终黑盒验收。

---

# 137. 对长期愿景的影响

如果 Reference Client UAT 成立：

我们就证明了：

```text
Profile
↓
Provable Artifact
↓
Portable Environment
↓
Installable Product
```

此后才能合理继续：

```text
Pack & Share
Verification CI
Registry
Studio
Custom Distributions
Team Distributions
Hosted Builds
```

如果连官方默认 Profile 都无法稳定转成普通用户客户端：

> **停止扩大项目范围，优先修复 Distribution 基础能力。**

---

# 138. 更新后的项目成功定义

项目真正的技术成功：

> 一个 Harness Profile 可以被 Freeze，并在 clean environment 中获得可信 Verification Receipt。

项目真正的产品成功：

> **同一个经过验证的 Stack，可以无需专属实现地被 Package 成人人可下载安装的 Reference Client。**

因此完整成功链路变为：

```text
Working Profile
↓
Freeze
↓
Proof
↓
Reproduce
↓
Package
↓
Ordinary User Download
↓
Install
↓
Run
```

---

# 139. 更新后的最终定位

核心层：

> **Freeze a working Harness profile. Prove it works somewhere clean.**

最终产品证明：

> **Turn that verified profile into something anyone can download and run.**

完整长期定位：

> **DSH Stack is a reproducibility, verification, and distribution layer for DeepSeek Harness. It captures working profiles, proves they can be reconstructed in clean environments, and turns verified Agent environments into portable distributions that ordinary users can run without understanding the underlying Harness setup.**

## Phase 2 Architecture Boundary (Locked)

Phase 2 supports real-world Profile variation without accumulating an ecosystem inside runtime artifacts.

**No ecosystem accumulation in runtime artifacts.** The capability that grows is the generic DSH Stack layer: `HarnessAdapter`, Preflight rules, compatibility rules, verification logic, failure fixtures, and tests. A generated App must remain self-contained and must contain only:

```text
Base Runtime
+ Exact Harness Closure
+ Current Profile Closure
```

It must never become:

```text
Base Runtime
+ Profile A
+ Profile B
+ Profile C
+ all known plugins
```

DSH Stack may understand many Profiles, but the App for Profile A may contain only the runtime and exact dependency closure required to run Profile A. Phase 2 therefore does not introduce a shared Runtime Manager, global plugin repository, Marketplace, Registry, or Studio, and must not trade self-contained distribution for a shared-runtime optimization.

当前实施顺序仍然必须保持：

```text
Freeze
↓
Prove
↓
Reproduce
↓
Reference Client UAT
↓
STOP AND REVIEW
```

Reference Client 是必做的端到端 Case，但不得绕过前面的核心能力。
