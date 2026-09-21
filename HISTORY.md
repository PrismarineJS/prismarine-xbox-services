# History

## Unreleased

- Use plain client factories and event emitters with closure-owned state; replace the adapted RTA transport.
- Add normalized profiles, named sessions and opt-in activity publication.
- Refresh session snapshots on RTA notifications/resync; emit observed member and property changes.
- Add PlayFab title data, inventory and CloudScript helpers.

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
