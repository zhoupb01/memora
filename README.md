# Memora

Memora 是给多个 AI 助手共用的 Markdown 记忆库。不用装宿主插件。助手按需读笔记，只改单条笔记；Bun 命令 `memora` 负责重建索引。

## 安装

先装 [Bun](https://bun.sh/)。在 Memora 仓库根目录运行：

```bash
bun install
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/bin/memora.ts" "$HOME/.local/bin/memora"
```

把 `$HOME/.local/bin` 加入 `PATH`。接入新助手时，将 [CONTRACT.md](CONTRACT.md) 原文贴进 `~/.agents/AGENTS.md`，再让该助手的规则文件引用它，并要求每次对话首次回答前按约定读取记忆。

## 记忆布局

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

一条事实写一个文件。`NOW.md` 记当前进度和下一步，也用相同格式。`archive/` 是冷库，不进索引。不要手改 `MEMORY.md`。

```markdown
---
name: 部署用 Bun
description: 新建后端服务默认用 Bun
type: feedback
section: 工作方式
---
正文
```

`type` 是 `user`、`feedback`、`project` 或 `reference`；`section` 仅用于全局笔记。`description` 是一行索引短句。

## 命令

- `memora sync`：从笔记重建全局和项目索引；索引内容没变就不写。
- `memora resolve [dir] [--json]`：查项目记忆目录。Git 工作树使用主仓库名；不在 Git 中则向上找已有的同名项目记忆目录。
- `memora dream`（尚未实现）：离线整理旧对话和笔记。

已实现的命令都支持 `--root <dir>`；未指定时读 `MEMORA_DIR`，再默认到 `~/.agents/memory`。

## 从 v1 迁移

停用旧版 pi 和 DSH 插件。先备份旧记忆，并在备份副本上试跑 `bun scripts/migrate-v2.ts <memory-root>`。检查报告和索引差异后，再对实际记忆目录运行一次。迁移脚本只接受本次迁移表里的旧项目目录名。

开发验证：`bun test`。

[MIT](LICENSE)
