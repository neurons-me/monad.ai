# Monad.ai NPM — Daemon Runtime & Engine
Monad.ai is the Node daemon package that exposes a universal ledger, semantic path resolution, and identity primitives over HTTP.

This package currently hosts the **Monad daemon server**: the authoritative engine where namespaces, blocks, identities, and relations live.

This README intentionally documents **where the project is now** and **where it is going**, so the architecture can evolve without confusion.

---

## Where We Are Now (Current State)

At present, this project is a **single Express server entrypoint** (`server.ts`) that performs several responsibilities:

### 1. Entry Point / Runtime
- Starts an Express server (default port `8161`)
- Enables CORS and JSON parsing
- Serves a SPA shell when `Accept: text/html` is detected
- Serves static assets (GUI) under `/gui`

### 2. Namespace Resolution (Core Concept)
Every incoming request is resolved into a **namespace**, derived from:
- `Host` header (domain / subdomain)
- Optional path selectors (`/@username`, `@a+b`, etc.)

This means:
- Each host or subdomain maps to an independent logical namespace
- Namespaces are **independent of users or sessions**
- Reality exists before identity

### 3. Universal Ledger
Monad.ai stores facts as immutable blocks in local state files plus the `.me` kernel:

- `POST /` → append a block to the ledger
- `GET /` / `GET /blocks` → read blocks (filterable by namespace, identityHash, limit)
- `GET /@*` → same as above, but with explicit selector in the path

Each block is stored as JSON and scoped to a namespace.

### 4. Semantic Path Resolution
A catch‑all route (`GET /*`) resolves semantic paths such as:

```
/profile/displayName
/wallet/eth/net
```

This works by:
1. Reading blocks in the resolved namespace
2. Folding them into a state tree (newest value wins)
3. Returning the value at the requested path

This is what turns the daemon from “just a ledger” into a **language**.

### 5. Identity & Biometrics
The server also exposes identity primitives:
- `POST /users` — claim a username
- `GET /users/:username` — query user data
- `POST /faces/enroll` — store face embeddings
- `POST /faces/match` — cosine similarity matching

### 6. Data Layer
- `.me` kernel + `DiskStore` for semantic state
- Snapshot + local JSON state files under `me-state/`
- Persistent claim bundles on disk
- No SQLite dependency in the runtime path

---

## What This Is Not (Yet)

- This is **not** yet a cleanly separated engine
- This is **not** yet a documented Node library
- This is **not** yet an SDK or fluent client API

All logic currently lives close to the runtime for speed of iteration.

---

## Where We Are Going (Intended Direction)

The goal is to evolve the runtime into **three clear layers**:

### 1. Engine (Pure Logic)
A reusable, documented engine that contains:
- Namespace algebra
- Ledger rules
- Semantic resolution
- Deterministic folding

This will live in `src/engine/*` and be exportable as a library.

### 2. Server (Transport)
The Express server becomes:
- A thin HTTP transport
- A host for local kernel-backed persistence
- A gateway that maps HTTP → engine calls

Minimal logic. Mostly wiring.

### 3. SDK (Language / Client)
A future SDK will expose the runtime as a **navigable language**:

```js
cleaker.me(username, password).wallet.eth.net()
```

This SDK will:
- Talk to the server
- Reflect namespaces dynamically
- Allow inspection (`.tree()`, `.ls()`, `.blocks()`)

## Routing Spec

The current routing direction for `.me`, `nrp`, and the HTTP server is documented here:

- [docs/nrp-routing-spec.md](/Users/suign/Desktop/Neuroverse/neurons.me/core/monad.ai/npm/docs/nrp-routing-spec.md)
- [docs/nrp-remote-exchange-spec.md](/Users/suign/Desktop/Neuroverse/neurons.me/core/monad.ai/npm/docs/nrp-remote-exchange-spec.md)

---

## Guiding Principles

- **Reality exists without the observer**
- Namespaces are regions, not users
- Identity is optional and layered
- Semantics emerge from blocks, not schemas
- Transport (HTTP) is replaceable; algebra is not

---

## Monad vs Cleaker

This package is the daemon host. It is not the same thing as `cleaker`, even though they overlap in practice.

- `.me` is the semantic kernel
- `monad.ai` is the daemon that runs it
- `cleaker` is the ledger interface and public semantic network layer
- `cleaker.me` is the canonical public root running that role

In short:

- `.me` thinks in spaces
- `cleaker` ledgerizes and hydrates spaces
- `monad.ai` hosts and serves spaces

See the architecture note here:

- [docs/Monad-vs-Cleaker.md](/Users/suign/Desktop/Neuroverse/neurons.me/core/monad.ai/npm/docs/Monad-vs-Cleaker.md)

---

## Next Concrete Steps

1. Extract the engine into explicit modules:
   - `engine/namespace`
   - `engine/ledger`
   - `engine/semantic`
2. Freeze the block contract
3. Add tests at the engine layer
4. Generate API documentation (TypeDoc)
5. Build the SDK on top of the stable engine

---

## Commands

### Start Development Server
```bash
npm run dev
```

---

## Domains & Namespaces

- `cleaker.me` → global namespace
- `username.cleaker.me` → user namespace
- `localhost:8161` → local namespace
- `username.localhost:8161` → local user namespace

A namespace is defined as:
```
(domain, port?, path?, subdomain?, …)
```

More specific namespaces are subsets of less specific ones.

---

## License
MIT

https://neurons.me
