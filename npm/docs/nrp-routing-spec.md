# NRP Routing Spec

## Purpose

This document defines the clear boundaries and contract between:

- **`.me`**: The local semantic kernel (in-process logic, expression evaluation, and memory).
- **NRP**: The semantic addressing and routing layer, responsible for creating canonical targets and transport-agnostic identity.
- **`cleaker` server**: The HTTP network surface for exposing, persisting, and resolving remote namespaces.

> **Note:**  
> In all runtime routing, logs, and response envelopes, canonical resource identities MUST use the `me://` URI scheme.  
> The term “NRP target” refers to the *logical* semantic identity; in all APIs, payloads, and client/server exchanges, **use only `me://` as the canonical format**.

---

## Layer Responsibilities

### `.me` (Semantic Kernel)
- Owns **local state, execution, and replay**
- Resolves path selectors and expressions (e.g. `profile.name`, `friends.ana.bio`, or `friends[age>18].name`)
- Handles purely local evaluation, never exposed as a network transport

### NRP (Semantic Routing & Addressing)
- Defines **canonical semantic target identity**
- Maps between local and remote (addressing, not transport)
- Provides transport-agnostic selectors

### `cleaker` HTTP server
- Exposes HTTP routes for remote (and sometimes local) namespace access
- Handles remote block persistence, replay, claims, and open flows
- Maps incoming host/path/method to canonical namespace and target
- Operates as a transport—**it NEVER resolves `nrp://local` or `nrp://self` targets**, which are always handled by `.me`/runtime.

---

## Layer Boundaries and Example Targets

| Layer     | Conceptual Target Example                                    | Resolved By                               |
| --------- | ------------------------------------------------------------ | ----------------------------------------- |
| **`.me`** | `profile.name`<br>`friends.ana.bio`                          | Local in-process (`.me` kernel)           |
| **NRP**   | `nrp://local/profile.name`<br>`nrp://cleaker.me/users/ana/read/profile.name` | Routing/binder (not HTTP server)          |
| **HTTP**  | `me://cleaker.me/users/ana/read/profile.name`<br>`https://cleaker.me/@ana/profile` | `cleaker` HTTP server (via normalization) |

---

## Canonical Target Structure

- **Canonical “resource identity”** (always use `me://...`):
  ```json
  {
    "me": "me://cleaker.me/users/ana/read/profile.name",
    "namespace": "cleaker.me",
    "path": "users/ana/read/profile.name"
  }
  ```

- *Rules:*
    - `namespace` is always the canonical root identity (`cleaker.me`, `localhost`).
    - `path` is always **everything after the namespace** (can include selectors).
    - `me` is the unique, canonical identifier for the resource, using all path segments.

---

## Mapping: HTTP → Namespace → Canonical Target

| HTTP Request Example                 | Canonical Namespace                    | Canonical Target/`me://`                     |
| ------------------------------------ | -------------------------------------- | -------------------------------------------- |
| `GET https://cleaker.me/`            | `cleaker.me`                           | `me://cleaker.me/read`                       |
| `GET https://ana.cleaker.me/`        | `cleaker.me`<br/>users/ana             | `me://cleaker.me/users/ana/read`             |
| `GET https://cleaker.me/@ana`        | `cleaker.me`<br/>users/ana             | `me://cleaker.me/users/ana/read`             |
| `GET https://cleaker.me/@ana+bella`  | `cleaker.me`<br/>relations/ana+bella   | `me://cleaker.me/relations/ana+bella/read`   |
| `GET https://cleaker.me/@ana/@bella` | `cleaker.me`<br/>users/ana/users/bella | `me://cleaker.me/users/ana/users/bella/read` |
| `GET http://localhost:8161/`         | `localhost`                            | `me://localhost/read`                        |
| `GET http://ana.localhost:8161/`     | `localhost`<br/>users/ana              | `me://localhost/users/ana/read`              |

---

## Write Mapping

- Write targets always resolve to the **current canonical namespace**.
    - Example: `POST https://cleaker.me/` with `Host: ana.cleaker.me` or `x-forwarded-host: ana.cleaker.me`
        - Canonical namespace: `cleaker.me`
        - Request path/selector: `users/ana`
        - Canonical target: `me://cleaker.me/users/ana/write/...`
    - Claim/open operations:
        - Always operate only on the `namespace`, not a path.

---

## Server Rules

1. The server may expose HTTP routes for remote namespaces only.
2. The server must **never** resolve or claim ownership of `nrp://local` or `nrp://self`—these are only for local/in-process.
3. Route normalization (`resolveNamespace(req)`) must always return:
    - canonical `namespace` string
    - canonical resource `me://` URI
    - extracted operation kind (e.g., `read`, `write`, `claim`, `open`)
4. A dedicated normalization utility (not http routes themselves) is responsible for host/path/method → canonical target.
5. Claims and open flows are always namespace operations, never path-specific.

---

## Immediate Implementation Priority

**Do not implement any explicit `nrp://` HTTP endpoint.**

Instead, focus on implementing and using the canonical normalization utility:

- **Input**: `{host, path, method}`
- **Output**:
    - canonical namespace
    - canonical `me://` target
    - operation kind (`read`, `write`, `claim`, `open`)

This utility **is** the contract between HTTP routing and the backend engine.  
All server-side audits, logging, and envelopes MUST use the canonical `me://` URI and namespace/path separation described above.

---

## Future Guidance

- When adding new transports or selectors, reference only the canonical normalization output (me://, namespace, path, operation).
- If alternate protocol support (e.g. JSON-LD, gRPC) is added later, maintain this canonical mapping for all core resource identity and access logic.
- For mesh, relay, or peer-to-peer surface, ensure every participant speaks and records canonical `me://` targets.

---

### In summary

- **`.me`** = local semantics, never networked.
- **NRP** = semantic routing, resolved by binder.
- **`cleaker` server** = HTTP/persistence/transport, always via normalized, canonical targets, never resolving `nrp://local`.
- **Canonical resource identity and all audits/envelopes use only `me://` URIs.**

