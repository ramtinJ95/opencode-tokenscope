---
description: Analyze token usage. Usage: /tokenscope [sessionID] [limitMessages=3] [includeSubagents=true]
---

Call the tokenscope tool directly without delegating to other agents.

Usage:
- `/tokenscope` -> current session, limitMessages=3, includeSubagents=true
- `/tokenscope <sessionID>` -> specific session, limitMessages=3, includeSubagents=true
- `/tokenscope <sessionID> <limitMessages>` -> limitMessages must be 1-10
- `/tokenscope <sessionID> <limitMessages> <includeSubagents>` -> includeSubagents must be true or false

Parse arguments positionally:
1. First arg = sessionID. If missing, leave sessionID unset/empty for the current session.
2. Second arg = limitMessages. If missing, use 3. Valid range: 1-10.
3. Third arg = includeSubagents. If missing, use true. Valid values: true|false.

After the tool finishes, read `token-usage-output.txt` and respond with only this concise summary:

Key metrics:
- Cache Hit Rate: <value>
- Session tokens: <value>
- Estimated API cost: <value>
- Cache savings: <Cost Savings value and percent>
- Effective Rate: <value>

Do not print the full report or raw box charts. If a value is missing, write `not found`.
