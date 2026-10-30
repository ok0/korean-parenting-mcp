# 직접 설정하기(AI 앱별)

> 이 문서는 정부·공공기관과 관계없는 비공식 개인 프로젝트의 안내입니다. 의료·법률 자문이 아니며, 건강 상태는 의료진에게, 제도·신청 기한은 관할 기관에 확인하세요.

[← 설치 방법 고르기](../install.md) — 다른 설치 방법은 여기서 골라요.

Claude 데스크톱 앱이면 [파일 하나로 설치하는 편이 쉬워요](../mcpb.md).

쓰는 AI 앱의 설정에 이 서버를 직접 추가하는 방법이에요.
어느 앱이든 같은 이름(`korean-parenting`)과 같은 실행 명령(`npx -y korean-parenting-mcp`)을 써요.
아래 표에서 내 앱을 찾으세요(예: VS Code, Cursor 등).

같은 서버를 여러 방법으로 등록하면 두 번 등록될 수 있어요. 한 방법만 쓰세요.

| 앱 | 설정 위치 | 형식 | 문서 |
| --- | --- | --- | --- |
| VS Code | 명령 팔레트 "MCP: Open User Configuration" 또는 `.vscode/mcp.json` | JSON(`servers`) | [VS Code 연결 안내](vscode.md) |
| Cursor | `~/.cursor/mcp.json` 또는 `.cursor/mcp.json` | JSON(`mcpServers`) | [Cursor 연결 안내](cursor.md) |
| Gemini CLI·Gemini Code Assist | `~/.gemini/settings.json` | JSON(`mcpServers`) | [Gemini CLI·Gemini Code Assist 연결 안내](gemini.md) |
| Antigravity | `~/.gemini/config/mcp_config.json` | JSON(`mcpServers`, `type` 없이) | [Antigravity 연결 안내](antigravity.md) |
| Codex | `~/.codex/config.toml` | TOML(`[mcp_servers.korean-parenting]`) | [Codex 연결 안내](codex.md) |
| Claude 데스크톱 앱 | `claude_desktop_config.json` | JSON(`mcpServers`) | [Claude 데스크톱 앱 연결 안내](claude-desktop.md) |
| Claude Code | `claude mcp add` 명령 | 명령 한 줄 | [Claude Code 연결 안내](claude-code.md) |
| 그 밖의 AI 앱 | Windsurf·Zed·JetBrains 각 앱 설정 | JSON(앱마다 다름) | [그 밖의 AI 앱 안내](others.md) |

ChatGPT 등 원격 MCP만 받는 앱은 로컬 서버를 직접 추가할 수 없어요. 원격 모드를 제공한 뒤 안내할 예정이에요.
