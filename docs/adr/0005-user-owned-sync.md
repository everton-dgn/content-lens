# ADR 0005: User-owned synchronization

Status: Accepted

Amended by: [ADR 0009](0009-sync-conflict-model.md) and [ADR 0010](0010-credential-handling.md)

## Context

Users may want the same rules on multiple devices. Operating a ContentLens backend would add cost and custody of sensitive preference data.

## Considered options

1. No synchronization.
2. ContentLens-hosted account and database.
3. Optional adapters for storage selected by the user.

## Decision

Network synchronization remains optional, provider-neutral and user-owned.
Versioned local JSON import and export are profile portability, separate from
the selected network transport. The accepted merge and encryption contracts
are defined by ADR 0009 and the synchronization contract. A concrete public provider and its
authentication policy still require separate release evidence.

## Tradeoffs

- A safe provider may prove too complex for public release.
- Authentication and conflict behavior differ by provider.
- ContentLens avoids mandatory hosting cost.
- Users retain storage choice and data custody.

## Consequences

- The serialized profile has no provider-specific core fields.
- Provider selection requires experimental evidence and an accepted ADR.
- Automatic merge is limited to changes proven independent by ADR 0009.
- Model-provider credential modes follow accepted ADR 0010.
- A public sync provider still requires a reviewed authentication flow,
  retention policy, revocation method and conditional-write evidence.

## Revisit trigger

Revisit after the synchronization experiment produces evidence or if provider complexity prevents reliable sync for nontechnical users.
