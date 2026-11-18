# @zhoupb01/dsh-memory

Memora 的 DeepSeek Harness 原生适配器，与 pi 适配器平级，共用 `packages/core` 中的记忆策略和提示词。此包负责 DSH 配置、会话筛选、提示词注册与 `/dream` 投递；核心模块负责记忆上下文。

## 安装

在 DSH 插件管理器中添加 npm 包 `@zhoupb01/dsh-memory`，或调用 `plugin_manager`：

```json
{
  "action": "install_bundle",
  "target": "@zhoupb01/dsh-memory"
}
```

npm 上未加 scope 的 `dsh-memory` 是另一个项目；Memora 的包名为 `@zhoupb01/dsh-memory`。

### 从源码安装

先在 Memora 仓库根目录构建：

```bash
npm ci --ignore-scripts
npm run build
```

然后让 DSH 的 `plugin_manager` 安装此适配器目录：

```json
{
  "action": "install_bundle",
  "target": "/absolute/path/to/memora/packages/dsh-memory"
}
```

也可以通过插件管理器安装打包后的 DSH 插件。安装影响当前 profile 的所有会话，是否即时生效以返回的 `application` 和 `nextStep` 为准；更新已加载的 JavaScript 模块可能要求重启 DSH。

安装后正常聊天即可。`/dream` 或自然语言“整理一下记忆”使用共享指南。命令不接收参数，原始整理模板正文会通过 `agent.followup()` 作为普通用户消息入队，随后由模型执行。插件不直接改写、删除或归档记忆。

## 存储

根目录优先级：

1. 插件配置 `directory`，非空时生效。
2. Host 进程环境变量 `MEMORA_DIR`，非空时生效。
3. `~/.agents/memory/`。

支持 `~` 和 `~/`。相对路径在插件加载时相对于 Host 工作目录解析，建议使用绝对路径。Desktop 环境变量应在启动应用前设置；已启动应用可通过插件配置编辑器设置：

```json
{ "directory": "/absolute/path/to/memory" }
```

记忆包含 `global/` 与 `projects/<项目路径编码>/`，各有 `MEMORY.md`、正文和 `archive/`。项目识别使用当前会话的 `workingDirectory`；切换目录后，下次提示词组装会读取对应项目记忆。

DSH 和 pi 默认共用记忆。从旧版升级时，请按[迁移说明](https://github.com/zhoupb01/memora#从旧版迁移)移动旧记忆并手动合并重叠的索引。DSH 的文件权限和审批规则照常生效，默认根目录通常在工作区外，使用普通文件工具保存时可能需要审批。

## 生命周期

通过 `systemPrompt.section()` 注册 `dsh-memory:memory`，每个模型步骤重新读取指南和索引。核心统一提供项目识别、200 行截断、冷库计数和日期格式。正文和冷库内容不自动注入。

插件依赖交互命令服务 `commands`。仅运行时顶层会话接收新的记忆 section；运行时子代理和 `origin: subagent` 的恢复会话跳过。普通顶层 fork 可以使用记忆，继承历史仍由 DSH 自己处理。没有 `commands` 的 minimal/headless composition 不激活此插件；主动配置该服务的自动化顶层 agent 也会生效。

卸载由 Cordis 撤销提示词和命令注册，记忆文件保留。模型负责记忆内容与写入决策，插件不会绕过宿主文件权限。

## 开发与验证

当前已用 DSH `0.2.2-rc.2` 的真实代理注册、提示词和命令服务验证；安装包声明 `>=0.2.2-rc.1 <0.3.0`，其他版本需单独验证。会话筛选使用 `agents.get(id)` 检查当前实例，并通过会话头的 `origin: subagent` 排除子代理。

在 Memora 根目录执行：

```bash
npm test
DSH_TEST_RUNTIME=/absolute/path/to/dsh/node_modules npm test
npm run pack:adapters
```

不设置 `DSH_TEST_RUNTIME` 时真实 Cordis 集成测试明确跳过。测试覆盖核心行为、pi/DSH 输出一致性、真实提示词与命令注册、UserMessage 存储重放及卸载清理；使用隔离目录，不写真实记忆。完整模型循环和 GUI 行为不由这些测试保证，具体边界见源码中的 `test/README.md`。

修改共享核心和提示词后运行 `npm run build`，两个适配器会同时得到更新的 `lib/core/`。这些生成文件随包分发，运行时无需工作区外部的核心模块或未发布的 npm 包。

## License

MIT，保留原记忆提示词版权。图标为原创 SVG，同样使用 MIT。
