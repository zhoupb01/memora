# Memora core

Host-independent memory context, backed by ordinary Markdown files. This module owns the memory policy, project discovery, index limits, archive counts, date rendering, and `/tidy` text. It has no dependencies on pi, DSH, a model provider, or a database.

## Interface

```js
import { buildMemoryPrompt, readTidyTemplate } from "./index.js";

const section = buildMemoryPrompt({
  root: "/absolute/path/to/memory",
  cwd: "/absolute/path/to/project",
  // Optional deterministic clock; default is the host's current local date.
  today: new Date(),
});

const { description, text } = readTidyTemplate();
```

The adapter supplies its resolved memory root and the receiving session's actual working directory. Every call reads the guide, both indexes, and archive names again. The module returns text and performs no writes, registration, command dispatch, or model calls. Missing indexes or archive folders are empty; other I/O errors propagate.

`buildMemoryPrompt()` finds the nearest ancestor containing a `.git` directory or file, falling back to the supplied cwd. It includes at most 200 lines from each index, with the original overflow notice. Memory bodies and archive contents are loaded only by the agent's normal tools when needed. `today` uses local calendar fields.

The two prompt files beside this module are the only authored prompt sources. The repository build copies this module and its resources into both adapter packages. Those copies are generated and byte-checked, so each package can run independently without a registry dependency on this private workspace.

## Deliberately outside the core

- Host-specific default memory roots, environment variables and configuration.
- Which interactive sessions or agents receive memory.
- Prompt registration, slash-command discovery, and durable message delivery.
- Permissions and model decisions to save, merge, delete, or archive files.

The on-disk path encoding retains the original POSIX slash replacement; Windows also replaces backslashes and drive colons. This is not a collision-free project identifier. Concurrent memory writes and archive naming are still handled by host tools and the model, as in the original implementation.
