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
- `memora dream [--since YYYY-MM-DD] [--dry-run] [--model <id>]`：手动回看 pi、DeepSeek Harness 和 Claude Code 的历史对话，补记遗漏，纠正、合并或归档旧笔记。需要在 `PATH` 上安装 pi，默认模型是 `sub2api/gpt-6.2-sol`。

所有命令都支持 `--root <dir>`；未指定时读 `MEMORA_DIR`，再默认到 `~/.agents/memory`。

第一次运行 `memora dream` 只记录当前进度，不调用模型。之后只处理新记录；用 `--since` 可从指定的本地日期重读。`--dry-run` 只生成摘要和统计，不调用模型，也不更新进度。摘要、报告和进度在 `<记忆目录>/.dream/`，该目录会自动排除在 Git 提交之外。成功后，`dream` 重建索引，并在 Git 仓库中只提交记忆目录内的改动。失败时保留摘要、已完成的报告和原进度，已写入的笔记不会自动回滚。

## 从 v1 迁移

停用旧版 pi 和 DSH 插件。先备份旧记忆，并在备份副本上试跑 `bun scripts/migrate-v2.ts <memory-root>`。检查报告和索引差异后，再对实际记忆目录运行一次。迁移脚本只接受本次迁移表里的旧项目目录名。

开发验证：`bun test`。

[MIT](LICENSE)
