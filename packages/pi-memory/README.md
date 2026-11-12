# pi-memory

Memora 的 pi 原生适配器，与 DSH 适配器平级，共用 `packages/core` 中的记忆策略和提示词。此包只处理 pi 生命周期、工作目录和默认记忆根；索引读取、项目识别、冷库计数和提示词组装都由核心完成。

## 安装

在 Memora 仓库根目录准备构建：

```bash
npm ci --ignore-scripts
npm run build
```

然后安装此适配器目录：

```bash
pi install /absolute/path/to/memora/packages/pi-memory
```

不要同时安装旧 Git 来源和新的本地适配器，以免重复加载。Memora 根目录是中立 workspace，不再作为 pi 插件入口。原 pi-memory 仓库的既有版本 tag 不受这次本地重构影响。

安装包含记忆扩展和 `/tidy` 模板。可直接要求记住偏好、回忆项目背景，或输入 `/tidy` 整理记忆。

## 行为

- `before_agent_start` 在 TUI/RPC 交互运行时更新同一 memory section。
- pi 的 print/JSON 等 `hasUI` 为 false 的运行不注入记忆。
- 默认根目录为 pi agent home 下的 `memory/`，通常是 `~/.pi/agent/memory/`；`PI_MEMORY_DIR` 可覆盖。
- 使用 `ctx.cwd` 识别项目，按最近 `.git` 目录或文件确定项目根。
- 每次运行重读共享指南和两份索引，每份索引最多 200 行。
- 模型使用 pi 的普通文件工具维护 Markdown，插件没有自动写入逻辑。

## 开发与测试

在 Memora 根目录运行 `npm test`，其中包括 pi 回调、核心和 DSH 的契约测试。修改提示词或记忆行为时，编辑共享核心，再执行 `npm run build`；本包的 `lib/core/` 是生成产物。

原来的模型驱动样例仍在本包的 `test/` 中。这些样例只打印模型与工具行为，需要人工检查结果，不是自动断言测试。以下命令从本包目录执行，驱动需要 Bun：

```bash
trial=$(mktemp -d)
mkdir -p "$trial/project/.git"
PI_MEMORY_DIR="$trial/mem" bun test/rpc-drive.ts \
  "$trial/project" '<provider/model>' test/sessions.json \
  -ne -np -e "$PWD" --prompt-template "$PWD/lib/core/tidy.md"
```

冷库样例：

```bash
cold_trial=$(mktemp -d)
bash test/seed-cold.sh "$cold_trial"
PI_MEMORY_DIR="$cold_trial/mem" bun test/rpc-drive.ts \
  "$cold_trial/proj" '<provider/model>' test/sessions-cold.json \
  -ne -np -e "$PWD" --prompt-template "$PWD/lib/core/tidy.md"
```

seed 脚本会删除并重建目标目录，仅使用专用临时目录；样例日期固定在 2026 年 11 月，需要结合运行日期判断过期行为。

## 分发

从仓库根目录运行 `npm run pack:adapters`。pi 安装包包含入口、核心 JavaScript、完整指南和 `/tidy` 模板，可独立于仓库使用。MIT 许可证。
