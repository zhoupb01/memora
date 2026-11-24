# Memora

多个 AI 助手共用的本地 Markdown 长期记忆插件。不装全局命令、不依赖 Git、不修改用户的 `AGENTS.md`。

三家插件（`pi`、DeepSeek Harness、`agy`）共用同一份记忆核心：每次开新对话自动从笔记文件头同步 `MEMORY.md` 索引，只把两份精简索引（全局 + 当前项目，硬限 200 行 / 25 KB，不含 `NOW.md` 正文）注入上下文；首次使用时自动建好空目录。

## 安装

从源码目录安装前，先在仓库根目录执行一次构建：

```bash
npm install && npm run build
```

之后按需在对应工具里安装插件即可，无需额外初始化步骤：

### pi

```bash
pi install /path/to/memora/packages/pi-memory
```

### DeepSeek Harness (DSH)

从 npm 安装（无需本地构建）：

```bash
dsh plugin --profile desktop add @zhoupb01/dsh-memory
```

或从本地仓库链接：

```bash
dsh plugin --profile desktop add link:/path/to/memora/packages/dsh-memory
```

### Antigravity (`agy`)

```bash
agy plugin install /path/to/memora/packages/agy-memory
```

卸载时直接用对应工具自带的 `remove` / `uninstall` 命令即可，不会在 `AGENTS.md` 或 `PATH` 留下残留。

## 记忆布局

默认存储在 `~/.agents/memory`（可通过 `MEMORA_DIR` 环境变量覆盖，DSH 插件也可在插件设置里指定 `directory`）：

```text
~/.agents/memory/
├── global/
│   ├── MEMORY.md
│   ├── <笔记>.md
│   └── archive/
└── projects/<项目名>/
    ├── MEMORY.md
    ├── NOW.md
    ├── <笔记>.md
    └── archive/
```

- **一条事实一个文件**：助手只读写单条 `.md` 笔记；`MEMORY.md` 由插件根据笔记头部自动重建，不要手改。
- **项目识别**：通过向上查找 `.git` 目录或文件（支持 linked worktree 归并回主仓库名）自动定位 `projects/<项目名>/`；不在仓库内时向上匹配已有的同名项目记忆目录。
- **当前进度**：项目未完事项和下一步写在 `NOW.md`，插件只向开场上下文注入索引行，不注入 `NOW.md` 正文。
- **冷存储**：过时笔记移入 `archive/`，不进索引，需要历史背景时按需用 `rg` 搜索。

笔记格式：

```markdown
---
name: 部署用 Bun
description: 新建后端服务默认用 Bun
type: feedback
section: 工作方式
---
正文
```

`type` 为 `user`、`feedback`、`project` 或 `reference`；`section` 仅用于全局笔记分组。

## `/dream` 整理

在助手会话中运行 `/dream`（支持 `--dry-run`、`--since YYYY-MM-DD`、`--model <id>`；在 `agy` 中可直接说运行 `dream` 技能）：

- 自动扫描 `pi`、DeepSeek Harness 和 Claude Code 的本地会话记录（首次运行仅记录当前游标基线，不调用模型）。
- 补记遗漏偏好与项目进度，修正、合并或归档旧笔记（需要在 `PATH` 上可调用 `pi`，默认模型 `sub2api/gpt-6.2-sol`）。
- 摘要、报告、游标保存在 `<记忆目录>/.dream/`；被覆盖或删除的原笔记会自动备份在当次 `digest-*/backup/` 下。

## 从 v1 迁移

先备份旧记忆并在副本上试跑 `node scripts/migrate-v2.mjs <memory-root>`，核对无误后再对真实目录执行。

开发与验证：

```bash
npm test
```

[MIT](LICENSE)
