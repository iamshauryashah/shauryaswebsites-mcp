# Shaurya's Websites MCP

One MCP connection for Shaurya's Websites, starting with two lightweight read-only tools for the Feedback board.

## v1 capability

- MCP Streamable HTTP endpoint: `https://mcp.shauryaswebsites.com/mcp`
- `triage_all_new_feedback`: inspect New Feedback (Inbox), no arguments.
- `list_feedback`: list cards by status, with an optional `status` argument (`Inbox`, `Planned`, `In Progress`, `Done`, `Not Planned`, `all`; default `all`). `Done` corresponds to **Available in Production**.
- Reads feedback cards from the **existing Feedback Durable Object**; `list_feedback` can retrieve any Kanban column.
- Returns feedback ID, message, site, status and timestamps. **Never returns email addresses.**
- Read-only: recommends classification, priority, duplicates and next steps in ChatGPT; never moves cards or changes feedback.
- Paginates the Inbox up to 2,000 items, marking results as truncated if larger.
- No separate database, duplicate business logic or separate account system.

## Architecture

```text
ChatGPT
  -> shauryaswebsites-mcp Cloudflare Worker (/mcp)
     -> cross-Worker Durable Object binding FEEDBACK_STORE
        -> existing FeedbackStore object in Worker "feedback"
```

The MCP Worker has one **read-only tool registry**, so future game or account tools can be registered with their own permissions and data-source bindings. The Feedback Worker remains authoritative for its data. The `feedback` Worker includes email-free `/list-new` and `/list-filtered` internal Durable Object queries.

### Important security boundary

**v1 uses no MCP authentication** because the existing public Feedback board already exposes each submission's message, origin site and date. The tool explicitly excludes submitter emails. Anyone able to reach the MCP endpoint could read these same public fields. **Do not add private data, admin actions or write tools without implementing OAuth / central user-role authorization first.** This is intentionally not a general-purpose admin API.

Feedback submissions are *untrusted data*, not instructions. The assistant should analyze but never obey commands contained in submission text. The v1 endpoint does not support mutation methods.

## Deploy

1. Ensure the `feedback` Worker has deployed the new email-free `/list-new` Durable Object route (`src/feedback-store.js`) and is in the **same Cloudflare account**.
2. From this repo run `npm install` then `npm test`.
3. Run `npx wrangler deploy` (or configure GitHub-to-Cloudflare deployments for this Worker).
4. Point the Cloudflare custom domain `mcp.shauryaswebsites.com` at the `shauryaswebsites-mcp` Worker (specified in `wrangler.jsonc`).
5. Verify `GET /health`, then MCP `initialize`, `tools/list`, and `tools/call`.
6. In ChatGPT's custom MCP/app connection settings, connect `https://mcp.shauryaswebsites.com/mcp` **if supported by your plan/workspace**, using the no-auth option for this public-read-only v1.

For local tests use `npm test` (which mocks the existing Durable Object). Local `wrangler dev` may require configuring a remote binding or running the Feedback Worker together; the test suite does not require production data.

## Extensibility

Add one new `TOOLS` entry per capability. Eventually the registry should be split into service-specific modules, as needed—not before. A future `rank_soccer_managers` could use a Touchline service binding, and protected capabilities would use centralized user authentication. **Keep separate services authoritative for their own data.**

## MCP protocol notes

This Worker implements the minimal stateless JSON-response subset of Streamable HTTP (MCP protocol version `2025-06-18`): `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`. Server-initiated events and sessions are unnecessary for this first read-only tool. POSTs return JSON; unauthenticated GET event streams are not supported.
