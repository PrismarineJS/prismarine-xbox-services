# Protocol references

The implementation is organized around this package's API and Node.js event emitters.
These resources informed protocol behavior and service boundaries:

- Microsoft's [MPSD overview](https://learn.microsoft.com/en-us/gaming/gdk/docs/services/multiplayer/mpsd/live-mpsd-overview): session notifications require fetching and comparing snapshots; reconnect requires writing the new connection ID. Session templates must enable the relevant connection/notification behavior.
- Microsoft's [RTA best practices](https://learn.microsoft.com/en-us/gaming/gdk/docs/services/fundamentals/rta/concepts/live-rta-best-practices): connection renewal and subscription restoration.
- Microsoft's [profile schema](https://learn.microsoft.com/en-us/gaming/gdk/docs/reference/live/rest/json/json-profile): profile setting names.
- PlayFab [GetTitleData](https://learn.microsoft.com/en-us/rest/api/playfab/client/title-wide-data-management/get-title-data?view=playfab-rest), [GetUserInventory](https://learn.microsoft.com/en-us/rest/api/playfab/client/player-item-management/get-user-inventory?view=playfab-rest) and [ExecuteCloudScript](https://learn.microsoft.com/en-us/rest/api/playfab/client/server-side-cloud-script/execute-cloud-script?view=playfab-rest): request fields and session-ticket authentication.
- [LucienHH/xbox-rta](https://github.com/LucienHH/xbox-rta): a reference used during earlier investigation of RTA v2 framing and nonce-based connection establishment. The previous adapted transport has been replaced with the Node event-based implementation in this package.
- PrismarineJS [bedrock-protocol](https://github.com/PrismarineJS/bedrock-protocol) and [prismarine-auth](https://github.com/PrismarineJS/prismarine-auth): existing service use cases and authentication boundaries.

Tests use local sockets and service fixtures. They do not establish live service access,
Minecraft title behavior, or additional permissions for other titles.
