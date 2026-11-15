# Isolated runtime integration

[runtime.test.js](./runtime.test.js) uses Node's built-in test runner and an explicitly selected, already installed DSH runtime. It adds no project devDependencies and never installs a bundle into a profile or starts a server.

Run from the package directory:

```sh
DSH_TEST_RUNTIME=/path/to/extracted/dsh/node_modules node --test test/runtime.test.js
```

`DSH_TEST_RUNTIME` also accepts the containing `dsh` directory. The runtime must have usable exports and transitive dependencies for:

- `@deepseek-ai/cordis`
- `@deepseek-ai/dsh-system-prompt`
- `@deepseek-ai/dsh-commands`
- `@deepseek-ai/dsh-session`
- `@deepseek-ai/dsh-agent`
- `@deepseek-ai/dsh-session-projection`

The plugin's normal `@deepseek-ai/schemastery` dependency must also be installed in the project. Missing `DSH_TEST_RUNTIME` reports an explicit **skip**, without importing the plugin or runtime. An explicitly configured missing or incomplete runtime fails; the test does not download dependencies or search the current profile.

## Coverage

The tests mount the actual plugin through real Cordis and exercise the real `AgentRegistry`, `SessionProjectionRegistry`, `SystemPrompt` and `CommandRuntime` services:

- Each assembly uses the receiving agent's current cwd, including cwd changes and separate agents. Updated memory is read on the next assembly; template-like memory text remains literal.
- Agentless calls, delegated children, resumed subagents, unregistered agents and removed agents contribute no memory. A removed instance stays ineligible when the same ID is registered again; the replacement and a top-level resumed fork remain eligible.
- `/tidy` is listed, found and executed through the registry. It sends a distinct, identified `UserMessage` with the original tidy prompt. Command lifecycle events pair correctly.
- Message shape is checked through the real Session import boundary. A synthetic Session log is written to JSONL, reloaded, and replayed as user messages.
- Children, arguments, attachments and pre-cancelled execution send no followup.
- Disposing the plugin's Cordis fiber removes its section and command while preserving unrelated registrations. Remounting works without duplicates.
- A composition without Commands leaves the plugin inactive.

## Isolation and limits

Every test creates a temporary directory containing synthetic project roots, memory indexes and, where needed, a synthetic Session log. The plugin always receives that explicit memory directory. No real memory or profile data is read or written. Contexts and temporary directories are removed after each test.

Agent registration, lookup and disposal use the real host registry with synthetic agents; working-directory lookup is a controlled service adapter. `followup` validates the message and writes the standard durable inbox event to a real independent Session; it does not start the complete AgentLoop, a model request, or a persistence backend. The tests establish compatibility at these plugin boundaries, not live UI behavior or an end-to-end model run.

Verified with Node 24.22.1, DSH 0.2.2-rc.2 and Cordis 4.1.0: six integration cases pass (Node reports seven passing tests including the parent). Replacing the former mock registry with the installed host registry reproduced `ctx.agents.roots is not a function` before the fix. The plugin now uses the host registry lookup and durable subagent origin instead.
