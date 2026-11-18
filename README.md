# Memora

**一套记忆核心，多个原生适配器。**

Memora 用 Markdown 保存值得长期记住的偏好和项目背景。短索引随请求进入上下文，正文按需读取，过期记忆进入冷存储。由模型使用宿主的普通文件工具维护记忆，不增加数据库、专用记忆工具或后台模型请求。

pi 和 DeepSeek Harness 是平级适配器。记忆策略和提示词只在共享核心中维护。

## 架构

```text
memora/
├── packages/
│   ├── core/          # 记忆策略、提示词、索引、项目识别和上下文组装
│   ├── pi-memory/     # pi 生命周期和目录适配
│   └── dsh-memory/    # DSH 配置、提示词注册和命令适配
├── scripts/          # 构建与发行
└── test/             # 跨适配器与分发契约测试
```

| 模块 | 职责 |
| --- | --- |
| [Core](packages/core/README.md) | `buildMemoryPrompt()` 与 `readDreamTemplate()`；不依赖任何宿主 |
| [pi-memory](packages/pi-memory/README.md) | 接入 `before_agent_start`，使用 pi 的工作目录与记忆根 |
| [dsh-memory](packages/dsh-memory/README.md) | 接入 Cordis 提示词、会话目录与 `/dream` 命令 |

核心统一处理：最近的 Git/worktree 项目根、全局与项目索引、每份索引 200 行上限、冷库计数、当地日期和完整提示词。文件缺失按空记忆处理，其他读取错误向宿主报告。

## 开始使用

开发环境需要 Node.js 22.18 或更新版本：

```bash
git clone https://github.com/zhoupb01/memora.git
cd memora
npm ci --ignore-scripts
npm run build
```

构建把同一份核心和提示词放入两个插件的 `lib/core/`。这些是生成文件，插件运行时无需访问仓库外部的核心包。

**pi：**

```bash
pi install /absolute/path/to/memora/packages/pi-memory
```

**DSH：** 在插件管理器中添加 npm 包 `@zhoupb01/dsh-memory`，或调用 `plugin_manager`：

```json
{
  "action": "install_bundle",
  "target": "@zhoupb01/dsh-memory"
}
```

本地开发时，`target` 也可以使用构建后的 `/absolute/path/to/memora/packages/dsh-memory` 目录。npm 上未加 scope 的 `dsh-memory` 是另一个项目。

根目录是私有 workspace，不是插件安装目标。旧 pi-memory 的已发布 tag 保持原样；新的本地安装使用上面的适配器目录。

安装后正常聊天即可。输入 `/dream` 或要求整理记忆，会按共享指南检查、归档、合并和清理记忆。

## 记忆数据

| 宿主 | 默认根目录 | 覆盖方式 |
| --- | --- | --- |
| pi | `~/.pi/agent/memory/` | `PI_MEMORY_DIR` |
| DSH | `~/.dsh/memory/` | 插件 `directory`、`DSH_MEMORY_DIR` 或 `DSH_HOME` |

两个宿主默认各自存储。共用核心不会自动合并记忆数据；需要共用时，将它们指向同一个根目录。数据格式是 `global/` 和 `projects/<项目路径编码>/`，每个目录有 `MEMORY.md`、记忆正文和 `archive/`。路径编码继承原版，某些含连字符的项目路径可能重名。

文件读写继续遵守宿主的权限规则。pi 的非交互运行和 DSH 子代理不主动加载记忆；具体生命周期范围见各适配器说明。

## 修改一次，两边生效

提示词的唯一源文件是 [`packages/core/GUIDE.md`](packages/core/GUIDE.md) 和 [`packages/core/dream.md`](packages/core/dream.md)。共享指南放宽了保存条件：有真实信号、拿不准时也保存；用户随口提到的个人信息也算。未完成的工作和约定的下一步保存在项目记忆目录唯一的 `open-threads.md` 中，完成后移除对应事项。指南还要求模型在结束每次回答前回看交流，保存符合条件的内容，不增加模型请求。

修改核心源码或提示词后：

```bash
npm run build
npm test
```

构建同时更新两个适配器，校验会拒绝过期产物。宿主接口变更只改对应适配器，共享行为变更通过核心和两端契约测试。不要直接编辑生成的 `lib/core/`。

核心和适配器测试不调用模型。真实 Pi 模板加载和 DSH Cordis 集成测试需要指定已安装的运行时；没有指定时明确跳过：

```bash
PI_TEST_RUNTIME=/absolute/path/to/node_modules/@earendil-works/pi-coding-agent \
DSH_TEST_RUNTIME=/absolute/path/to/dsh/node_modules \
npm test
```

`PI_TEST_RUNTIME` 指向 Pi coding agent 包目录，用实际模板加载器验证 `/dream` 的 YAML 元数据；`DSH_TEST_RUNTIME` 指向完整 DSH 运行时或其 `node_modules`。两项可以单独设置。

模型是否正确保存、纠错、遗忘或归档，仍需要实际模型会话验证。pi 的原始会话样例保留在其适配器的 `test/` 中。

## 分发与版本

```bash
npm run pack:adapters
```

生成独立的 `pi-memory-<version>.tgz` 和 `zhoupb01-dsh-memory-<version>.tgz`。两者包含相同核心和提示词，不依赖尚未发布的 `@memora/core` npm 包。DSH 适配器以 `@zhoupb01/dsh-memory` 发布到 npm。

版本和 [CHANGELOG](CHANGELOG.md) 由仓库统一维护。`scripts/release.sh <version>` 会检查两端、同步版本、创建 tag，并通过配置的 `origin` 发布 GitHub release 及两个插件包；只在准备发布时运行。发布目标从 `origin` 明确解析，不依赖 GitHub CLI 的默认仓库。Memora 的远端地址是 `https://github.com/zhoupb01/memora.git`。

## License

[MIT](LICENSE)。保留 pi-memory 的原始历史和版权；DSH 图标为原创，同样采用 MIT 许可证。
