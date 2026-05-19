# Taphelu

**Language:** [English](#english) | [Tiếng Việt](#tieng-viet)

<a id="english"></a>

## English

Taphelu is a local-first workflow substrate for long-running AI-agent work.

It gives Claude, Kiro, Codex, Gemini, and humans one shared workflow for project onboarding, lifecycle state, compact context, local memory, runtime adapters, and polyrepo service contracts.

Taphelu is not a hosted agent platform. It runs locally and lets the AI runtime you already use continue work with better context, roles, checks, and memory.

### Requirements

- Node.js `>=22.16.0`
- pnpm
- Optional runtime CLIs:
  - Claude Code: `claude`
  - Kiro: `kiro-cli`
  - Codex CLI
  - Gemini CLI

### Install

```bash
pnpm add -g @luongdev/taphelu
dl commands
```

Check installed binaries:

```bash
which dl
which taphelu-mcp
dl doctor instructions
```

`taphelu-mcp` is a stdio MCP server. If you run it directly, it waits silently for JSON-RPC input. Use `Ctrl+C` to exit.

### Recommended First Prompt

After installing a runtime adapter, open a project repo and ask the AI:

```text
Use Taphelu to onboard this repo. Start the Taphelu lifecycle, run a quick scan first, ask me only missing domain/business questions, then create a scan plan. Preview before writing .projects.
```

For polyrepo or microservice work:

```text
Use Taphelu contracts before planning. Check the registry, identify the current service, load inbound and outbound dependencies, then plan the change.
```

### Claude Code Setup

Install the Claude adapter globally:

```bash
dl install --runtime claude --scope global --profile full-auto --hooks strict --statusline on --write
dl doctor --runtime claude --scope global --live
```

Restart Claude Code after install.

Taphelu generates for Claude:

- MCP config for `taphelu`
- skills under `~/.claude/skills`
- specialist agents under `~/.claude/agents`
- slash commands under `~/.claude/commands`
- hooks and statusline script under `~/.claude/hooks`
- Claude settings with hooks and `statusLine`

Expected Claude commands:

- `/dl-init`
- `/dl-resume`
- `/dl-scan`
- `/dl-contracts`
- `/dl-plan`
- `/dl-close`
- `/dl-status`

Expected behavior:

- `taphelu` MCP connects.
- `taphelu-lead` stays in the main session.
- Specialist roles such as planner, dev, QA, UX, and visual QA are delegated when useful.
- The statusline shows runtime facts first: model, context percentage when Claude provides it, Taphelu state, next action, and git state.

If Claude is stuck at `connecting...`:

```bash
dl doctor --runtime claude --scope global --live
dl runtime status --runtime claude --scope global --live
```

Common causes:

- stale project-local MCP config shadowing the global config
- generated MCP path points to an old package install
- MCP command uses `node` instead of an absolute Node path
- Claude Code was not restarted after config changes

Manual Claude MCP registration, if needed:

```bash
NODE_BIN="$(command -v node)"
MCP_BIN="$(pnpm root -g)/@luongdev/taphelu/bin/taphelu-mcp.mjs"
claude mcp add -e TAPHELU_MANAGED=1 --transport stdio --scope user taphelu -- "$NODE_BIN" "$MCP_BIN"
dl doctor --runtime claude --scope global --live
```

Claude MCP config is separate from Claude settings. MCP entries use Claude MCP config; hooks and statusline use Claude settings.

### Kiro Setup

Use `kiro-cli`, not `kiro`.

Install the Kiro CLI adapter globally:

```bash
dl install --runtime kiro --scope global --profile full-auto --hooks strict --statusline on --write
dl doctor --runtime kiro --scope global --live
```

Taphelu generates globally for Kiro:

- MCP config under `~/.kiro/settings/mcp.json`
- skills under `~/.kiro/skills`
- specialist CLI agents under `~/.kiro/agents`
- CLI hook script under `~/.kiro/hooks`
- steering under `~/.kiro/steering`
- skill-based `/dl-*` commands

Start a Kiro CLI session:

```bash
kiro-cli chat --require-mcp-startup
```

Use a specific model:

```bash
kiro-cli chat --model qwen3-coder-next --require-mcp-startup
```

Kiro app hooks are workspace-local. To make Taphelu hooks appear in the Kiro app Agent Hooks panel, run this inside the repo opened in Kiro:

```bash
cd <your-repo>
dl install --runtime kiro --scope local --profile full-auto --hooks strict --statusline on --write
dl doctor --runtime kiro --scope local --live
```

Then reload Kiro. Generated hook files live under:

```text
.kiro/hooks/
```

Kiro does not use the same custom statusline surface as Claude. Taphelu-specific state is exposed through `/dl-status`; Kiro keeps its own native UI status.

### Codex and Gemini

Install all adapters:

```bash
dl install --runtime all --scope global --profile full-auto --hooks strict --statusline on --write
dl doctor --runtime all --scope global --live
```

Install one runtime:

```bash
dl install --runtime codex --scope global --write
dl install --runtime gemini --scope global --write
```

Codex gets skills, MCP config, `/dl-*` commands, and compact instruction pointers. Gemini gets an extension layout with commands, skills, context, and MCP config.

### Project Onboarding

Agent-native flow is preferred. Ask the AI to use Taphelu.

CLI fallback:

```bash
dl scan --path . --mode quick
dl scan interview --path . --mode quick
dl scan plan --path . --mode standard
dl scan map --path . --mode standard
```

Write project context only after preview:

```bash
dl scan --path . --mode standard --write
dl context index --write
```

`dl scan interview --domain ... --user ... --core-flow ... --objective ... --write` is mainly for automation and scripted onboarding. In normal use, let the AI ask the domain questions and call the MCP/CLI tools.

### Polyrepo Contracts

For microservices and polyrepo systems, Taphelu can use one shared contract registry.

Default layout:

```text
.projects/contracts/
  registry.json
  services/
  interactions/
  proto/
  openapi/
  asyncapi/
  graphql/
  schemas/
  channels/
  graphs/
```

Initialize or link a registry:

```bash
dl contracts init --path .projects/contracts --remote git@github.com:org/contracts.git --write
dl contracts link --path .projects/contracts --write
```

Scan the current service and update the registry:

```bash
dl contracts scan --path . --write
dl contracts check --strict
dl contracts current --path .
dl contracts deps --direction all
dl contracts map --write
```

The registry tracks APIs, events, queues, topics, pub/sub channels, Redis channels/streams, service metadata, and dependencies.

For polyrepo planning, agents should run:

```text
dl_contracts action=check strict=true
dl_contracts action=current
dl_contracts action=deps direction=all
```

If registry data conflicts with service implementation, Taphelu should stop and ask for resolution.

### Memory and Context

Taphelu uses two separate local stores:

- `.projects/`: project-local context, ignored by git by default
- `~/.taphelu/`: user-local SQLite memory

Raw logs, raw browser content, PII, and secrets should not be promoted to durable memory by default.

Useful commands:

```bash
dl context index --write
dl context search "testing"
dl context get <artifact-id>
dl compact milestone --id M30 --write
dl compact runs --keep 5 --write
```

### Verification

```bash
dl doctor --runtime claude --scope global --live
dl doctor --runtime kiro --scope global --live
dl doctor instructions
pnpm view @luongdev/taphelu version
```

Package/runtime E2E from source:

```bash
pnpm run check
pnpm test
pnpm run test:cli
pnpm run test:runtime-install
```

### Uninstall

```bash
pnpm remove -g @luongdev/taphelu
```

Project-local generated files:

```bash
rm -rf .projects .taphelu .kiro .claude .codex .gemini .mcp.json
```

Global runtime adapters are under each runtime config root:

- Claude: `~/.claude`, plus Claude MCP config
- Kiro: `~/.kiro`
- Codex: `~/.codex`
- Gemini: `~/.gemini`

Prefer reinstalling with `dl install ... --write` or removing Taphelu-managed files only.

### Documentation

- [Install](docs/INSTALL.md)
- [Usage Guide](docs/USAGE.md)
- [MCP Integration](docs/MCP-INTEGRATION.md)
- [Agent Pack](docs/AGENT-PACK.md)
- [Project Scan](docs/PROJECT-SCAN.md)
- [Context Store](docs/CONTEXT-STORE.md)
- [Roadmap](docs/ROADMAP.md)
- [Release Checklist](docs/RELEASE.md)

<a id="tieng-viet"></a>

## Tiếng Việt

Taphelu là workflow substrate chạy local cho các phiên làm việc dài với AI agent.

Nó giúp Claude, Kiro, Codex, Gemini và con người dùng chung một workflow cho onboarding project, lifecycle state, context gọn, memory local, runtime adapter, và registry giao tiếp service cho polyrepo.

Taphelu không phải hosted agent platform. Nó chạy trên máy bạn và giúp runtime AI đang dùng tiếp tục công việc với context, role, kiểm tra, và memory tốt hơn.

### Yêu cầu

- Node.js `>=22.16.0`
- pnpm
- CLI runtime nếu dùng:
  - Claude Code: `claude`
  - Kiro: `kiro-cli`
  - Codex CLI
  - Gemini CLI

### Cài đặt

```bash
pnpm add -g @luongdev/taphelu
dl commands
```

Kiểm tra binary:

```bash
which dl
which taphelu-mcp
dl doctor instructions
```

`taphelu-mcp` là stdio MCP server. Chạy trực tiếp thì nó sẽ đứng im chờ JSON-RPC input. Thoát bằng `Ctrl+C`.

### Prompt khởi đầu nên dùng

Sau khi cài adapter cho runtime, mở repo cần làm và nói với AI:

```text
Use Taphelu to onboard this repo. Start the Taphelu lifecycle, run a quick scan first, ask me only missing domain/business questions, then create a scan plan. Preview before writing .projects.
```

Với polyrepo hoặc microservices:

```text
Use Taphelu contracts before planning. Check the registry, identify the current service, load inbound and outbound dependencies, then plan the change.
```

### Cài cho Claude Code

Cài adapter Claude global:

```bash
dl install --runtime claude --scope global --profile full-auto --hooks strict --statusline on --write
dl doctor --runtime claude --scope global --live
```

Restart Claude Code sau khi cài.

Taphelu tạo cho Claude:

- MCP config cho `taphelu`
- skills trong `~/.claude/skills`
- specialist agents trong `~/.claude/agents`
- slash commands trong `~/.claude/commands`
- hooks và statusline script trong `~/.claude/hooks`
- Claude settings có hooks và `statusLine`

Các lệnh Claude mong đợi:

- `/dl-init`
- `/dl-resume`
- `/dl-scan`
- `/dl-contracts`
- `/dl-plan`
- `/dl-close`
- `/dl-status`

Hành vi mong đợi:

- MCP `taphelu` connect được.
- `taphelu-lead` nằm ở main session.
- Các role planner, dev, QA, UX, visual QA được delegate khi cần.
- Statusline ưu tiên thông tin runtime: model, context percentage nếu Claude cung cấp, Taphelu state, next action, git state.

Nếu Claude bị kẹt `connecting...`:

```bash
dl doctor --runtime claude --scope global --live
dl runtime status --runtime claude --scope global --live
```

Nguyên nhân thường gặp:

- config MCP local của project đang shadow config global
- path MCP cũ, trỏ tới package đã mất
- MCP command dùng `node` thay vì absolute Node path
- chưa restart Claude Code sau khi đổi config

Đăng ký MCP thủ công nếu cần:

```bash
NODE_BIN="$(command -v node)"
MCP_BIN="$(pnpm root -g)/@luongdev/taphelu/bin/taphelu-mcp.mjs"
claude mcp add -e TAPHELU_MANAGED=1 --transport stdio --scope user taphelu -- "$NODE_BIN" "$MCP_BIN"
dl doctor --runtime claude --scope global --live
```

Claude MCP config tách riêng với Claude settings. MCP dùng config MCP của Claude; hooks và statusline dùng Claude settings.

### Cài cho Kiro

Dùng `kiro-cli`, không phải `kiro`.

Cài adapter Kiro CLI global:

```bash
dl install --runtime kiro --scope global --profile full-auto --hooks strict --statusline on --write
dl doctor --runtime kiro --scope global --live
```

Taphelu tạo global cho Kiro:

- MCP config trong `~/.kiro/settings/mcp.json`
- skills trong `~/.kiro/skills`
- specialist CLI agents trong `~/.kiro/agents`
- CLI hook script trong `~/.kiro/hooks`
- steering trong `~/.kiro/steering`
- skill-based `/dl-*` commands

Mở Kiro CLI session:

```bash
kiro-cli chat --require-mcp-startup
```

Dùng model cụ thể:

```bash
kiro-cli chat --model qwen3-coder-next --require-mcp-startup
```

Kiro app hooks là workspace-local. Muốn thấy Taphelu hooks trong Kiro app Agent Hooks panel, chạy trong repo đang mở bằng Kiro:

```bash
cd <your-repo>
dl install --runtime kiro --scope local --profile full-auto --hooks strict --statusline on --write
dl doctor --runtime kiro --scope local --live
```

Sau đó reload Kiro. Hook files nằm ở:

```text
.kiro/hooks/
```

Kiro không có custom statusline giống Claude. Taphelu state xem qua `/dl-status`; Kiro vẫn giữ UI status riêng của nó.

### Codex và Gemini

Cài tất cả adapter:

```bash
dl install --runtime all --scope global --profile full-auto --hooks strict --statusline on --write
dl doctor --runtime all --scope global --live
```

Cài từng runtime:

```bash
dl install --runtime codex --scope global --write
dl install --runtime gemini --scope global --write
```

Codex nhận skills, MCP config, `/dl-*` commands, và instruction pointer gọn. Gemini nhận extension layout có commands, skills, context, và MCP config.

### Onboard project

Flow chính là agent-native. Hãy yêu cầu AI dùng Taphelu.

CLI fallback:

```bash
dl scan --path . --mode quick
dl scan interview --path . --mode quick
dl scan plan --path . --mode standard
dl scan map --path . --mode standard
```

Chỉ ghi project context sau khi preview:

```bash
dl scan --path . --mode standard --write
dl context index --write
```

`dl scan interview --domain ... --user ... --core-flow ... --objective ... --write` chủ yếu dành cho automation/scripted onboarding. Dùng bình thường thì để AI hỏi domain questions và gọi MCP/CLI tools.

### Polyrepo contracts

Với microservices và polyrepo, Taphelu có thể dùng một shared contract registry.

Layout mặc định:

```text
.projects/contracts/
  registry.json
  services/
  interactions/
  proto/
  openapi/
  asyncapi/
  graphql/
  schemas/
  channels/
  graphs/
```

Init hoặc link registry:

```bash
dl contracts init --path .projects/contracts --remote git@github.com:org/contracts.git --write
dl contracts link --path .projects/contracts --write
```

Scan service hiện tại và cập nhật registry:

```bash
dl contracts scan --path . --write
dl contracts check --strict
dl contracts current --path .
dl contracts deps --direction all
dl contracts map --write
```

Registry theo dõi API, event, queue, topic, pub/sub channel, Redis channel/stream, service metadata, và dependencies.

Với polyrepo planning, agent nên chạy:

```text
dl_contracts action=check strict=true
dl_contracts action=current
dl_contracts action=deps direction=all
```

Nếu registry mâu thuẫn với implementation trong service repo, Taphelu phải dừng và hỏi cách xử lý.

### Memory và context

Taphelu dùng hai store local tách nhau:

- `.projects/`: context theo project, mặc định ignore git
- `~/.taphelu/`: SQLite memory theo user

Raw logs, browser content thô, PII, và secrets không được promote vào durable memory theo mặc định.

Lệnh hữu ích:

```bash
dl context index --write
dl context search "testing"
dl context get <artifact-id>
dl compact milestone --id M30 --write
dl compact runs --keep 5 --write
```

### Kiểm tra

```bash
dl doctor --runtime claude --scope global --live
dl doctor --runtime kiro --scope global --live
dl doctor instructions
pnpm view @luongdev/taphelu version
```

Test package/runtime từ source:

```bash
pnpm run check
pnpm test
pnpm run test:cli
pnpm run test:runtime-install
```

### Gỡ cài đặt

```bash
pnpm remove -g @luongdev/taphelu
```

File generated theo project:

```bash
rm -rf .projects .taphelu .kiro .claude .codex .gemini .mcp.json
```

Global runtime adapters nằm trong config root của từng runtime:

- Claude: `~/.claude`, cộng với Claude MCP config
- Kiro: `~/.kiro`
- Codex: `~/.codex`
- Gemini: `~/.gemini`

Nên reinstall bằng `dl install ... --write` hoặc chỉ xóa file có Taphelu managed marker.

### Tài liệu

- [Install](docs/INSTALL.md)
- [Usage Guide](docs/USAGE.md)
- [MCP Integration](docs/MCP-INTEGRATION.md)
- [Agent Pack](docs/AGENT-PACK.md)
- [Project Scan](docs/PROJECT-SCAN.md)
- [Context Store](docs/CONTEXT-STORE.md)
- [Roadmap](docs/ROADMAP.md)
- [Release Checklist](docs/RELEASE.md)

## License

AGPL-3.0-or-later
