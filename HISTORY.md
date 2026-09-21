## Unreleased

- Rename XboxRTA to XboxRTASocket and expose socket lifecycle error classes.
- Require Node.js 24 or newer.

- Normalize Xbox profiles and allow caller-named sessions with explicit activity publication.
- Add managed session snapshots and document, member and property change events.
- Add session-ticket PlayFab title data, inventory and CloudScript helpers.
- Simplify HTTP group cancellation and fix Node 24 CI configuration.

# History

## Unreleased

- Replace SessionDirectory with ready XboxSession factories, explicit identities, and close().
- Return stable RTA subscriptions and separate request failures from background errors.
- Share operation deadlines and give managed sessions independent cancellation and bounded cleanup.
- Remove redundant session property writes and forced token refresh on RTA connection.
- Add ServiceError, consistent request options, and an API migration guide.

## 0.1.0

- Extract Xbox HTTP and managed-session clients with generic title configuration.
- Incorporate RTA with startup cancellation, per-connection request tracking and cleanup.
- Fix RTA unsubscribe tracking and JSON serialization; expose close and resync events.
- Add isolated PlayFab requests with session-ticket/entity-token credential providers.
- Include TypeScript declarations, service documentation, attribution and offline tests.
