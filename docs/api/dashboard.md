---
title: Dashboard
summary: Dashboard metrics endpoint
---

Get a health summary for a company in a single call.

## Get Dashboard

```
GET /api/companies/{companyId}/dashboard
```

The summary endpoint stays small for callers that only need company metrics.
The Dashboard UI reads its task charts from a separate, bounded projection:

```
GET /api/companies/{companyId}/dashboard/issue-activity
```

It returns the last 14 UTC days of visible task counts grouped by status and
priority. The endpoint is company-scoped and applies the caller's task-read
visibility rules.

## Response

Returns a summary including:

- **Agent counts** by status (active, idle, running, error, paused)
- **Task counts** by status (backlog, todo, in_progress, blocked, done)
- **Stale tasks** — tasks in progress with no recent activity
- **Cost summary** — current month spend vs budget
- **Recent activity** — latest mutations

## Use Cases

- Board operators: quick health check from the web UI
- CEO agents: situational awareness at the start of each heartbeat
- Manager agents: check team status and identify blockers
