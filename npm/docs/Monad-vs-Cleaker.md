# Monad, Cleaker, and Public Roots

This page fixes a common confusion in the stack:

- `.me` is the semantic kernel
- `monad.ai` is the daemon that runs it
- `cleaker` is the ledger interface and public semantic network layer
- `cleaker.me` is the canonical public root that adopts that layer

These are related, but they are not the same thing.

## Core Roles

### `.me`

`.me` owns:

- identity
- keys
- spaces
- secrets
- snapshots
- semantic execution

It is the local sovereign kernel.

Examples:

- `me://self:read/profile`
- `me://self:write/profile.name`
- `me://self:explain/profile.netWorth`

### `monad.ai`

`monad.ai` is the daemon host.

It owns:

- serving
- persistence
- remote execution
- transport entrypoints
- hosting one or more namespace surfaces

A monad can run only for you on localhost, or it can be exposed publicly on the WAN.

### `cleaker`

`cleaker` is the ledger interface between `.me` and the network.

It owns:

- namespace binding
- parsing and resolution
- attaching `.me` statements to a ledger
- hydrating a `.me` back from ledger memories
- public semantic order

`cleaker` is also the first organized semantic dictionary for `.me`.

It gives public structure to things like:

- users
- profiles
- wallets
- devices
- claims

### `cleaker.me`

`cleaker.me` is not a different protocol.

It is a public domain running a monad that adopts the `cleaker` role as a canonical public root.

That means:

- infrastructure-wise, it is a public `monad.ai`
- semantically, it acts as a clearing root for public namespaces

## Deployment Roles

### Local-only monad

A local-only monad:

- runs `monad.ai` only for you
- uses `.me`, keys, spaces, and snapshots locally
- does not need to publish a public namespace

Example:

- `me://self:read/profile`

### Application domain

An application domain, such as `netget.site` or `orgboat`, can:

- ask for your `.me`
- ask for keys or capabilities
- read or write permitted spaces
- run business logic on top of your sovereign identity

It does **not** need to become a public namespace root.

### Public root

A public root is a domain that chooses to expose namespace and ledger behavior publicly.

Examples:

- `cleaker.me`
- `otherdomainname.com`

Any domain running a public `monad.ai` could adopt this role.

## Canonical Address vs Web Projection

`me://` is the canonical semantic address.

`https://` is one possible public projection of that semantic address.

Examples:

- `me://ana.cleaker:read/profile`
- `https://ana.cleaker.me/profile`

- `me://ana.otherdomainname.com:read/profile`
- `https://ana.otherdomainname.com/profile`

The semantic target is primary. The web URL is a projection chosen by the host.

## Key Spaces and Privacy

A key can live under your sovereign space:

- `me://self:read/keys/orgboat.keysCustomName`

That usually resolves against your active `.me`, often on localhost or on your own devices.

But topology does not imply publicity.

If a space is replicated to:

- laptop
- iphone
- `cleaker.me`

that does **not** make it public.

The distinction is:

- topology decides where ciphertext exists
- audience decides who can open it

So a key space may be hosted on `cleaker.me` and still remain private if its audience is cryptographically closed.

## One-line Model

- `.me` thinks in spaces
- `cleaker` ledgerizes and hydrates spaces
- `monad.ai` hosts and serves spaces

## Rule

- Every app can use `.me`
- Not every app needs `cleaker`
- Every public root can run `monad.ai`
- `cleaker.me` is only the canonical public root, not the only possible one
