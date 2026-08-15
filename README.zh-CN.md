# DSH Stack

中文版 | [English](README.md)

DSH Stack 是 DeepSeek Harness 的**可复现分发层**。它让一套已经能正常工作的 Harness Profile 可以被冻结（Freeze）、验证（Verify）、重建（Reproduce）并打包（Package）为普通用户可直接下载使用的 macOS 桌面应用。

项目的核心定位很明确：**不重新实现** Harness 运行时、Profile 格式、插件系统、pnpm 依赖解析、Agent Loop 或官方 Web UI。它只做一件事——把已有的组合变成可复现、可分发的产物。

## 核心理念

> DeepSeek Harness 让 Agent 可组合。  
> DSH Stack 让这些组合可复现、可分发。

一句话概括：**冻结一套能工作的 Harness Profile，在干净环境里证明它确实能跑。**

## 当前状态

`v0.1.0-reference-v10` 是**公开参考版本 / RC 预发布**，不是稳定版。arm64 原生 Freeze/Verify/Package 已通过，但 arm64 App/真实 Agent UAT 以及 Apple Developer ID 签名公证仍未完成。x86_64 非开发者 UAT 已 **PASS**。

产品需求文档：[PRD.md](PRD.md)  
实现计划：[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)

## 验证状态

### 打包端到端 — PASS（x86_64）

x86_64 打包验证于 2026-08-16 在 Intel 开发 Mac 上完成，覆盖了完整的标准路径：

```
官方 Profile → Freeze → Verify / Prove → Materialize → Package → DMG → Native Shell → 官方 Harness Web UI
```

- 运行时收据（Runtime Receipt）为 `PASS`，`cacheUsed: false`
- 生成了 `DSH-Stack-Reference-macos-x64.app` 和 `.dmg`，`hdiutil verify` 通过
- 打包应用在受限 `PATH` 下启动，使用内嵌的 Node 运行时，在自身窗口内打开官方 Harness UI，不会跳转到 Safari 或 Chrome
- 官方 Models 设置页面可编辑，`⌘V` / `Edit → Paste` 可粘贴 API Key
- 环境：macOS 26.5.2，6 核 Intel Core i7，16 GB RAM，x86_64；Node v26.5.0；pnpm 11.12.0
- 仓库检查：`pnpm typecheck` 通过；`pnpm test` 17/17 通过

### 实时 Agent 端到端 — PASS（x86_64）

- v10 Native Shell 使用持久化的官方凭据完成真实 DeepSeek 对话，返回 `E2E_PASS`
- 终止并重新启动后，UI 加载了已保存的模型，返回 `RESTART_PASS`
- 全新生成的 x86_64 发布 App 返回 `RELEASE_X64_PASS`
- 三次成功会话的元数据均记录 `turn/end: completed`

### 打包端到端 — PASS（arm64 原生 CI）

2026-08-16，GitHub Actions `31899143451` 在原生 `macos-14` arm64 runner 上完成了同一条标准路径：

```text
官方 Profile → Freeze → Verify / Prove → Materialize → Package → DMG
```

- 原生 runner 架构检查通过，Runtime receipt 为 `PASS`，`cacheUsed: false`，`environment.arch` 为 `arm64`
- `DSH-Stack-Reference-macos-arm64.dmg`、SHA-256 sidecar 和 verification receipt 已上传到公开 Reference Release
- 这证明的是原生 arm64 打包，不等于已经在 Apple Silicon 实机上手动启动 App 或完成真实 Agent 对话

### 非开发者 UAT — PASS（x86_64）

2026-08-16 在第二台非开发者 Intel Mac 上完成了完整的黑盒验证路径，无需终端或开发者干预：

- 从 Release 下载对应架构的 `.dmg`，打开后将 `.app` 拖入 `/Applications`
- 该机器未安装 Node、pnpm 或 DSH CLI
- 双击启动应用，官方 Harness Web UI 在 Native Shell 窗口内打开（未跳转浏览器）
- 官方 Models 编辑器可编辑，API Key 通过手动输入并保存
- `⌘V` / `Edit → Paste` 粘贴也验证通过
- 完成一次真实 Agent 对话
- 退出并重新启动，凭据持久保留，已保存模型加载正常，再次完成真实 Agent 对话

全程无需终端命令、手动 Profile 编辑、lockfile 修复或 PATH 修复。

### 发布就绪度 — RC / 非稳定版

| 项目 | 状态 |
|---|---|
| x86_64 打包 & Agent E2E | ✅ PASS |
| x86_64 非开发者 UAT | ✅ PASS |
| arm64 原生打包 | ✅ CI Freeze/Verify/Package/DMG PASS；App 启动和真实 Agent 仍待 Apple Silicon 实机 |
| Universal Binary | ❌ 未生产，采用分架构独立产出 |
| Apple Developer ID 签名 | ⏳ 仅 Apple Development 身份，无 Developer ID Application 身份 |
| Hardened Runtime + 公证 | ⏳ 外部凭据阻塞 |

## 开发

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm dsh-stack --help
```

查看当前官方 Web Profile（不修改）：

```sh
pnpm dsh-stack inspect --profile web --harness ../deepseek-harness
```

冻结为制品：

```sh
pnpm dsh-stack freeze --profile web --harness ../deepseek-harness --output examples/reference
```

在一次性 DSH 环境中验证冻结制品：

```sh
pnpm dsh-stack verify examples/reference --harness ../deepseek-harness
```

通过官方 Harness Web UI 运行已重建的制品：

```sh
pnpm dsh-stack run examples/reference --clean --harness ../deepseek-harness
```

在 Stack 拥有 Runtime PASS 收据后，构建 macOS 参考客户端：

```sh
pnpm dsh-stack package examples/reference --harness ../deepseek-harness
```

这会生成一个 ad-hoc 签名的 `.app`，内含嵌入式 Node 运行时、已部署的官方 Harness 闭包、冻结的 Profile，以及一个在自身窗口中托管官方 Web UI 的通用 AppKit/WebKit Native Shell。它不会将 URL 交给 Safari 或其他默认浏览器，也不会向 Harness 环境注入 API Key——官方凭据提供者拥有可编辑的凭据存储。

## 项目结构

```
dsh-stack/
├── packages/
│   ├── core/          # 核心库：类型、冻结、验证、重建、打包、适配器
│   └── cli/           # CLI 入口：参数解析、命令分发、诊断输出
├── docs/              # 文档（UAT 规范等）
├── examples/          # 示例冻结制品
├── fixtures/          # 测试夹具
├── scripts/           # 构建脚本（macOS 参考客户端构建）
├── dist/              # 构建输出
├── PRD.md             # 产品需求文档（权威来源）
└── IMPLEMENTATION_PLAN.md  # 实现计划（PRD 到工程任务的映射）
```

## CLI 命令

| 命令 | 说明 |
|---|---|
| `inspect` | 检查真实 Harness Profile，不冻结 |
| `freeze` | 预检并捕获 Profile 为 Stack 制品 |
| `verify <stack>` | 静态验证并重建 Stack |
| `run <stack> --clean` | 重建 Stack 并保持官方 Web UI 运行 |
| `package <stack>` | 将 Runtime-PASS 的 Stack 打包为 macOS .app |

## 安全边界

运行时验证会在 Stack 中执行 Harness 和插件代码。一次性 DSH 环境用于可复现性隔离，不是安全沙箱或恶意代码隔离边界。API Key 由官方凭据提供者管理，DSH Stack 不会读取、打印或注入凭据值。

## 许可证

本项目为公开项目。
