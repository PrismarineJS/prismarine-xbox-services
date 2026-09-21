# Source provenance

This package incorporates MIT-licensed code and tests from:

- [PrismarineJS/prismarine-auth #184](https://github.com/PrismarineJS/prismarine-auth/pull/184),
  commit `8282e20669963460f2613c21cb3a8ad372fe3576`: Xbox HTTP/session extraction, deadlines,
  cancellation and lifecycle tests. Original notice: [prismarine-auth](../licenses/prismarine-auth.txt).
- [PrismarineJS/bedrock-protocol](https://github.com/PrismarineJS/bedrock-protocol): the original
  XSAPI client/session implementation from which that extraction was derived.
  Original notice: [bedrock-protocol](../licenses/bedrock-protocol.txt).
- [LucienHH/xbox-rta #5](https://github.com/LucienHH/xbox-rta/pull/5), patched fork commit
  `8fe305a18897b77b8e68b34ad42d8cd513c87bd0`: RTA implementation and connection lifecycle tests.
  Original notice: [xbox-rta](../licenses/xbox-rta.txt).

The RTA implementation is maintained here as CommonJS JavaScript with declarations, using
Node's EventEmitter. It includes the pending upstream lifecycle fixes and adds correct JSON
serialization, unsubscribe bookkeeping, late-response handling, and close/resync events.
There is no runtime dependency on xbox-rta, a fork, or an unreleased prismarine-auth branch.

All original license notices are included in the npm package. Authentication remains owned
by prismarine-auth; incorporating these service clients does not merge its experimental
services branch into its stable authentication API.
