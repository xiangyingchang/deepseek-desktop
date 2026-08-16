# DeepSeek Desktop (Unofficial)

中文版 | [English](README.md)

> 面向 DeepSeek Harness 的非官方社区桌面客户端，不是 DeepSeek 官方产品。

DeepSeek Desktop 可以把一套现有的 DeepSeek Harness Profile 打包成普通用户可直接安装的 macOS 应用。技术项目和 CLI 名称仍然是 **DSH Stack** / `dsh-stack`。

DSH Stack 不重新实现 Harness 运行时、插件系统、pnpm、依赖解析、Agent Loop 或官方 Web UI；它负责冻结、验证、重建并打包官方 Harness 环境。

## 下载

打开[当前公开的 Reference / RC Release](https://github.com/xiangyingchang/dsh-stack/releases/tag/v0.1.0-reference-v10)，根据你的 Mac 选择对应 DMG：

| Mac 类型 | 下载 | 芯片架构 | 当前验证状态 |
|---|---|---|---|
| Intel Mac | [DeepSeek-Desktop-Unofficial-macOS-Intel-x86_64.dmg](https://github.com/xiangyingchang/dsh-stack/releases/download/v0.1.0-reference-v10/DeepSeek-Desktop-Unofficial-macOS-Intel-x86_64.dmg) | x86_64 | 打包、Live Agent、非开发者 UAT：PASS |
| Apple Silicon Mac | [DeepSeek-Desktop-Unofficial-macOS-Apple-Silicon-arm64.dmg](https://github.com/xiangyingchang/dsh-stack/releases/download/v0.1.0-reference-v10/DeepSeek-Desktop-Unofficial-macOS-Apple-Silicon-arm64.dmg) | arm64 | 原生打包：PASS；实机 App 和 Live Agent UAT：待验证 |

Release 页面同时提供对应的 SHA-256 文件、verification receipt 和 package-size report。公开资产名称会明确包含 `Intel` 或 `Apple-Silicon`。

当前版本是 **Reference / RC 预发布版**，不是 Stable。公开 App 目前是 ad-hoc 签名且未公证，第一次打开时 macOS 可能显示安全提示。

## 安装和使用

普通用户不需要安装 Node、pnpm、`dsh-stack` CLI，也不需要预先安装 Profile 或打开 Terminal。

1. 下载与你的 Mac 匹配的 DMG。
2. 打开 DMG，把 App 拖到 `Applications` 文件夹。
3. 双击 App。如果 macOS 显示安全提示，按住 Control 点击 App，选择**打开**并确认。
4. 进入官方 Harness 的 **Models** 设置页面。
5. 编辑 **DeepSeek** 提供方，输入 API Key 并保存。支持 `⌘V` / **Edit → Paste** 粘贴。
6. 创建一个 Web session，发送一条消息。
7. 如果 Key 不正确，回到同一个 Models 页面替换并保存，然后重试，不需要重启 App。

API Key 由官方 Harness 凭据提供方保存。DSH Stack 不会打印或把 Key 写进 App。

## App 截图

以下截图来自真实的 `DeepSeek Desktop (Unofficial)` App 界面，只包含 App 内容，不包含桌面、菜单栏、浏览器界面或其他应用。

<p align="center">
  <img src="docs/images/deepseek-desktop-home.png" alt="DeepSeek Desktop 主界面" width="32%">
  <img src="docs/images/deepseek-desktop-models.png" alt="DeepSeek Desktop Models 设置页" width="32%">
  <img src="docs/images/deepseek-desktop-session.png" alt="DeepSeek Desktop 真实 Agent 会话" width="32%">
</p>

## 定制、升级和分享

DeepSeek Desktop 将两类状态分开：

```text
Base Distribution（不可变）
+ 你的 Profile 修改 / 标准 DSH Bundle
= Derived Working Profile
```

通过官方 Harness 安装标准 Bundle 后，就会形成 Derived Working Profile。之后 DeepSeek Desktop 更新必须把这个 Profile Rebase 到新 Base，不能直接替换整个 Profile，更不能静默删除你的 Bundle。DSH Stack 会先验证候选环境，再原子切换；如果变化无法确定合并，升级会被阻止，原来可用的 Profile 保留不动。

普通用户分享配置的默认方式是无状态的 `.dshstack`，而不是再次生成一个完整 App：

```text
Share This Setup → Preflight → Secret Scan → Freeze → Verify → Pack
```

产物包含精确的 Profile 定义、Bundle 图、依赖版本、Integrity 和 Receipt；排除 API Key、Credentials、Sessions、Prompt、Response、个人文件、缓存和含有 Secret 的日志。接收方导入后仍走标准 Verify → Materialize → Run，并使用自己的用户数据。完整 `.app/.dmg` 仍是高级分享方式。

这套生命周期不新增 Marketplace、Registry、评分系统、共享运行时或第二份 Plugin Manifest。Harness Profile-owned 文件仍然是唯一 Composition Source of Truth。

## 我应该下载哪个文件？

在 Mac 上打开**苹果菜单 → 关于本机**：

- 如果显示 **处理器：Intel**，下载 x64 DMG。
- 如果显示 **芯片：Apple M1/M2/M3/M4……**，下载 arm64 DMG。

除非你是开发者，否则不要下载 source ZIP；普通用户的安装入口是 DMG。

## 当前状态

| 项目 | 状态 |
|---|---|
| x86_64 Freeze → Verify → Package → DMG | PASS |
| x86_64 App 启动和官方 Harness UI | PASS |
| x86_64 真实 Agent Session 和重启 | PASS |
| x86_64 非开发者 UAT | 当前 Reference 产物 PASS |
| arm64 原生 Freeze → Verify → Package → DMG | CI PASS |
| arm64 App 启动、Live Agent、非开发者 UAT | 等待 Apple Silicon 实机验证 |
| Developer ID 签名、Hardened Runtime、公证、Stapling | 等待 Apple 外部凭据 |
| Stable `v0.1.0` | 尚未发布 |

### Phase 2 生命周期证据

| 项目 | 状态 |
|---|---|
| 官方 Base Freeze → Runtime Verify | 2026-08-16 PASS（`0.1.0-rc.5`，commit `47f9438`） |
| Maintainer Promote → Candidate Verify | 官方 Web Profile PASS |
| `.dshstack` Pack → Import → Runtime Verify | 官方 Web Profile PASS |
| 三方 Rebase、冲突阻断、原子切换 | 自动化回归测试和隔离 App runtime E2E PASS |
| 用户 Bundle 添加后经 Rebase 保留 | 通用 Fixture PASS；真实第三方安装仍受上游 Harness 源码安装问题阻塞 |
| 完整外部 clean-machine 生命周期 UAT | Pending |

## 开发者使用

安装依赖并运行自动化检查：

```sh
pnpm install
pnpm typecheck
pnpm test
```

标准 Pipeline：

```text
Official Harness Profile
        ↓
      Freeze
        ↓
 Verify / Prove
        ↓
    Reproduce
        ↓
      Package
        ↓
 Reference Client
```

查看 Profile，但不修改它：

```sh
pnpm dsh-stack inspect --profile web --harness ../deepseek-harness
```

冻结并验证 Profile：

```sh
pnpm dsh-stack freeze --profile web --harness ../deepseek-harness --output examples/reference
pnpm dsh-stack verify examples/reference --harness ../deepseek-harness
```

通过官方 Web UI 运行已验证的制品：

```sh
pnpm dsh-stack run examples/reference --clean --harness ../deepseek-harness
```

把 Runtime-PASS Stack 打包成 macOS App：

```sh
pnpm dsh-stack package examples/reference --harness ../deepseek-harness --size-report
```

Phase 2 生命周期命令：

```sh
# 检测用户 Profile 漂移，不修改任何一方
pnpm dsh-stack drift <old-base-profile> <current-profile> --json

# 生成三方 Rebase 候选；冲突返回 UPDATE_REBASE_CONFLICT
pnpm dsh-stack rebase <old-base-profile> <current-profile> <new-base-profile> \
  --output ./artifacts/rebase-candidate-profile --report ./artifacts/rebase-report.json

# 将已 Verify 的 Working Profile 手工 Promote 为新的 Candidate
pnpm dsh-stack promote <verified-derived-stack> --output ./artifacts/base-candidate \
  --distribution-version 0.2.0-rc

# 默认分享/导入无状态 Stack
pnpm dsh-stack pack <verified-derived-stack> --output ./setup.dshstack
pnpm dsh-stack import ./setup.dshstack --output ./artifacts/imported
pnpm dsh-stack verify ./artifacts/imported --harness ../deepseek-harness

# 用明确的 Harness checkout 验证升级候选
pnpm dsh-stack upgrade-verify <current-stack> ../deepseek-harness --json
```

`update` 是受保护的维护者/桌面升级原语：它先 Rebase、再真实 Runtime Verify，最后才切换 `--active <profile-directory>`；验证前不会覆盖当前 Profile。

每个 App 只包含该 Stack 所需的精确 Harness 和 Profile 闭包，不包含其他 Profile、插件或共享运行时仓库。

## 文档

- [PRD](PRD.md) —— 产品 Contract 和验收标准
- [实施计划](IMPLEMENTATION_PLAN.md) —— Milestone 历史和工程决策
- [Reference Distribution UAT](docs/reference-distribution-uat.md) —— 手工安装和用户测试
- [Phase 2 Generalization](docs/phase-2-generalization.md) —— 外部 Profile 兼容性研究
- [Phase 2 Lifecycle](docs/phase-2-lifecycle.md) —— Base/Derived/Rebase/Share 模型和证据边界
- [Phase 2 Review](PHASE_2_REVIEW.md) —— PASS / FAIL / UNSUPPORTED 结论

## 安全边界

验证和打包会执行 Harness 与插件代码。一次性运行时目录提供的是可复现性隔离，不是安全沙箱或恶意代码隔离边界。API Key 始终由官方 Harness 凭据提供方管理。
