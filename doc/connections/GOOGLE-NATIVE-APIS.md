# Separate Google API connections

The standard Google API adapters run behind Paperclip's existing MCP gateway.
Agents receive typed tools, while OAuth tokens and API keys remain in the vault.
Each service is a separate connection, authorization grant, install, action
profile and audit boundary. A Calendar, Meet, Maps or Translate connection cannot
invoke Gmail tools even if an upstream OAuth grant contains broader permissions.
The older combined Workspace connection and Google-hosted MCP methods remain
supported for existing installations.

| Connection | Native method | Actions | Credentials |
| --- | --- | --- | --- |
| Gmail | customer-workspace-api | Search/read messages and threads, drafts, labels, change history; create unsent drafts | Gmail OAuth grant |
| Google Calendar | customer-workspace-api | Calendar/event reads; create/update/delete events without guest notifications | Calendar OAuth grant |
| Google Drive | customer-workspace-api | Search, metadata/content reads, create empty files/folders, copy files | Drive OAuth grant |
| Google Docs | customer-workspace-api | Read documents; revision-bound text edits | Docs OAuth grant |
| Google Contacts | native-api | Prefix search of contacts; contacts do not establish client status | contacts.readonly OAuth grant |
| Google Sheets | native-api | Spreadsheet metadata, bounded cell reads and literal value writes | Sheets OAuth grant |
| Google Slides | native-api | Read/create presentations; revision-bound template text replacement | Slides OAuth grant |
| Google Meet | native-api | Conference records, participants, transcript entries, recording references | meetings.space.readonly OAuth grant |
| Workspace Search | native-api | Parallel bounded Gmail, Drive and Calendar search, with source results and explicit partial failures | Dedicated read-only OAuth grant |
| Google Routes | native-api | Routes, distances and traffic-aware travel times | Restricted Routes API key |
| Google Places | native-api | Text search, addresses, websites and opening hours | Restricted Places API key |
| Google Translate | native-api | Translate text, detect language, list languages | Restricted Cloud Translation API key |

Meet reads only artifacts that Google generated and the signed-in account may
access. It does not start recording or transcription. Recording references do
not grant Drive access to download recordings. Maps and Translate use API keys,
not a Google mailbox identity. Enable the selected API and billing and restrict
keys to that API and the server's IP where supported. These requests can incur
Google charges. The application bounds request size and selected result fields;
it does not claim to enforce a Google billing cap.

Workspace Search is deliberately its own data-bearing connection. Give it only
to agents allowed to search those sources. It never borrows another connection's
credentials or unions grants belonging to different identities. Search pages
are bounded; `complete: false` and each source's status distinguish missing
consent/provider failure from an empty successful search. Gmail search returns
message references for a separately authorized message read. Pagination tokens
are source-specific and can be used with the individual service tools.

The existing Client Operations routines restrict processing to verified client
correspondence. That workflow instruction is not an OAuth mailbox partition:
Gmail's readonly scope grants account-level reads. Do not describe it as a
server-enforced client-only access boundary. Agents without mail responsibilities
must not be installed on Gmail or Workspace Search connections.

## OAuth and setup

Enable the Gmail, Calendar, Drive, Docs or Meet API in the Google Cloud project
owning the OAuth client. Register the callback shown in Paperclip's setup page.
Reuse a company-owned OAuth **client registration** when appropriate; each
connection still requires its own grant. Never copy access/refresh tokens from
another account/connection or use sign-in credentials as provider credentials.

Native API setup can save an inactive draft before a key or OAuth credential is entered; draft saving never probes the provider or fabricates a credential.

Install the connection only on its intended agents before consent. The existing
OAuth completion path preserves a nonempty agent install selection. Review
native actions on Permissions. Native catalogs reflect actual persisted consent;
requested scopes are not evidence of authorization. Scope checks run before
cached invocation replay and again at dispatch, including after token refresh.

Google consent and API enablement require account-bound verification. Unit tests,
configuration-only health probes, and a successful OAuth authorization URL do not
prove live provider access. Maps/Translate setup health deliberately makes no
billable request or test text upload. Verify a permitted request after a key is
installed.

## Gmail and Calendar push

Notification ownership is `connectors/google-workspace-api/push.ts`. Setup is
board-only and requires connection configuration permission:

`POST /api/tool-connections/:connectionId/google-push`

Calendar body:

```json
{"enabled":true,"triggerId":"<same-company webhook trigger UUID>","calendarId":"primary"}
```

Gmail body:

```json
{
  "enabled":true,
  "triggerId":"<same-company webhook trigger UUID>",
  "topicName":"projects/<project>/topics/<topic>",
  "subscription":"projects/<project>/subscriptions/<subscription>",
  "serviceAccountEmail":"<push-identity>@<project>.iam.gserviceaccount.com",
  "mailboxEmail":"<authorized mailbox>"
}
```

Choose an active bearer-authenticated routine webhook in the same company.
Configure `PAPERCLIP_WEBHOOK_PUBLIC_URL` with the public HTTPS origin. Setup
returns the complete callback URL; callers never supply an arbitrary callback.
Notification configuration currently supports organization-owned service grants.
Personal grants are intentionally rejected for autonomous watch ownership.

For Gmail, provision a Pub/Sub topic in the OAuth client's Cloud project. Grant
`gmail-api-push@system.gserviceaccount.com` permission to publish to it. Configure
an authenticated push subscription with the exact returned callback as its
endpoint and OIDC audience and the selected push service-account identity.
Gmail watches must be renewed before their reported expiration; the worker
renews daily or one hour before expiration, whichever comes first.

Calendar watches use the routine's vault-owned random secret as the channel
verification token. The worker stores channel/resource identities and expiration
in connection metadata, retaining limited overlap while the old channel expires.
It renews one hour before expiration. The first `sync` callback is authenticated
but does not start a routine.

The public ingress is `POST /api/google-push/:connectionId`. Gmail callbacks must
pass Google's RSA signature, issuer, audience, verified service-account identity,
expiry, subscription and mailbox checks. Calendar callbacks require a matching
unexpired channel token and resource identity. Public callback data cannot select
a company, agent, routine or destination. The server selects its persisted routine
and rechecks the current organization grant, company and connection state.
Only change references become routine input; provider extras are discarded.
The existing routine delivery ledger owns deduplication and dispatch. Duplicate
Pub/Sub message IDs or Calendar channel/message pairs have the same receipt key.

Gmail change notifications carry a history cursor, not message contents. Consumers
retain the last successfully processed history cursor, use `gmail__list_history`,
then fetch permitted client messages. An expired history cursor requires a bounded
resync. Calendar consumers fetch changed events using their own authorized Calendar
connection. A notification receipt alone does not establish that an important
client message was read or that CoS received a useful report.

Watches persist in `tool_connections.config.googlePush`; no new table or schema
migration is needed. The shared delivery coordinator reconstructs actual renewal
and retry deadlines after restart. Setup, OAuth completion, configuration changes,
removal and company status changes notify the worker transactionally. No configured
watch means no recurring SQL/network polling. Gmail renewal failures retry with
bounded exponential delays. An uncertain Calendar create pauses with
`needs_attention` rather than creating duplicate channels. Reapplying setup is an
explicit retry. Disablement/revocation stops accepting notifications immediately;
existing Google leases expire provider-side if not renewed.

## Provider references

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/gmail/api/guides/push
- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list
- https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions
- https://developers.google.com/workspace/calendar/api/guides/push
- https://developers.google.com/workspace/meet/api/reference/rest/v2
- https://developers.google.com/maps/documentation/routes
- https://developers.google.com/maps/documentation/places/web-service/overview
- https://cloud.google.com/translate/docs/reference/rest/v2/translate
