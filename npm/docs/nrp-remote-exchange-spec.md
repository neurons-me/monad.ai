# NRP Remote Exchange Spec

## Purpose

This document defines the wire contract for remote NRP resolution over HTTP.

Goal:

- keep the exchange compatible with the current `cleaker` pointer runtime
- avoid coupling the kernel to HTTP route quirks
- leave room for future transport formats without changing `.me`

## Decision

Use plain JSON as the canonical exchange format for now.

Do not require JSON-LD yet.

Reason:

- current client code already consumes plain JSON
- the system still needs routing and normalization to stabilize
- JSON-LD can be added later as an alternate representation, not as the first contract

## Exchange Layers

### Semantic request
The client conceptually asks for:

- a canonical NRP target
- an operation kind
- optional authorization context

Example semantic target:

`nrp://cleaker.me/users/ana/read/profile.name`

### Transport request
The **HTTP transport** maps that target into:

- method
- host
- path
- headers
- query

Example:

- `GET /profile/name`
- `Host: ana.cleaker.me`

## Canonical Operations

### `read`
Read a resolved semantic value from a remote namespace.

### `write`
Append a thought or memory event into a remote namespace.

### `claim`
Forge or reserve namespace identity.

### `open`
Verify the namespace trinity and recover replay state.



Here’s your updated spec, revised to use only the canonical `me://` syntax and clarify the meaning of `namespace` versus `path`, following your latest semantic conventions.  
**Highlights:**
- Uses `me://` everywhere (“nrp” removed).
- `namespace` is always just the canonical root (e.g., `"cleaker.me"`).
- The path covers everything after the namespace.
- Examples and rules revised for clarity and uniformity.

---

## Response Envelope

All remote HTTP responses must use a common envelope:

```json
{
  "ok": true,
  "operation": "read",
  "transport": {
    "protocol": "https",
    "method": "GET"
  },
  "target": {
    "me": "me://cleaker.me/users/ana/read/profile.name",
    "namespace": "cleaker.me",
    "path": "users/ana/read/profile.name"
  },
  "result": {
    "value": "Ana"
  },
  "meta": {
    "resolvedAt": 1773200000000
  }
}
```

**Rules:**
- `ok` (boolean) is always present.
- `operation` (string) is always present.
- `target.namespace` is always the canonical *namespace root* (e.g., `"cleaker.me"`).
- `target.me` is always the canonical identity URI for the resolved request.
- `target.path` covers the relative path within the namespace.
- The operation-specific result goes in `result`.
- Operational metadata (timestamps, etc.) goes in `meta`.

---

## Read Contract

### Request

```http
GET /users/ana/read/profile.name HTTP/1.1
Host: cleaker.me
Accept: application/json
```

### Successful response

```json
{
  "ok": true,
  "operation": "read",
  "target": {
    "me": "me://cleaker.me/users/ana/read/profile.name",
    "namespace": "cleaker.me",
    "path": "users/ana/read/profile.name"
  },
  "result": {
    "value": "Ana"
  },
  "meta": {
    "resolvedAt": 1773200000000,
    "namespaceRecordVerified": false
  }
}
```

### Not found

```json
{
  "ok": false,
  "operation": "read",
  "target": {
    "me": "me://cleaker.me/users/ana/read/profile.unknown",
    "namespace": "cleaker.me",
    "path": "users/ana/read/profile.unknown"
  },
  "error": {
    "code": "PATH_NOT_FOUND",
    "message": "No value was resolved for the requested path."
  },
  "meta": {
    "resolvedAt": 1773200000000
  }
}
```

---

## Write Contract

### Request

```http
POST /users/ana/write/profile.name HTTP/1.1
Host: cleaker.me
Content-Type: application/json
```

```json
{
  "identityHash": "claim-hash",
  "expression": "users/ana/write/profile.name",
  "value": "Ana",
  "payload": {
    "path": "users/ana/write/profile.name",
    "value": "Ana"
  }
}
```

### Successful response

```json
{
  "ok": true,
  "operation": "write",
  "target": {
    "me": "me://cleaker.me/users/ana/write/profile.name",
    "namespace": "cleaker.me",
    "path": "users/ana/write/profile.name"
  },
  "result": {
    "blockId": "uuid",
    "timestamp": 1773200000000
  }
}
```

---

## Claim Contract

### Request

```json
{
  "namespace": "cleaker.me",
  "identity": "ana",
  "secret": "luna"
}
```

### Successful response

```json
{
  "ok": true,
  "operation": "claim",
  "target": {
    "me": "me://cleaker.me/claim/ana",
    "namespace": "cleaker.me"
  },
  "result": {
    "identityHash": "derived-hash"
  },
  "meta": {
    "createdAt": 1773200000000
  }
}
```

---

## Open Contract

### Successful response

```json
{
  "ok": true,
  "operation": "open",
  "target": {
    "me": "me://cleaker.me/open/ana",
    "namespace": "cleaker.me"
  },
  "result": {
    "identityHash": "derived-hash",
    "noise": "seeded-noise",
    "memories": [],
    "openedAt": 1773200000000
  },
  "meta": {
    "namespaceRecordVerified": true
  }
}
```

---

## Error Contract

All failures must use this shape:

```json
{
  "ok": false,
  "operation": "read",
  "target": {
    "me": "me://cleaker.me/users/ana/read/profile.name",
    "namespace": "cleaker.me",
    "path": "users/ana/read/profile.name"
  },
  "error": {
    "code": "PATH_NOT_FOUND",
    "message": "No value was resolved for the requested path."
  },
  "meta": {
    "resolvedAt": 1773200000000
  }
}
```

**Rules:**
- `error.code` is stable and machine-readable.
- `error.message` is human-readable.
- HTTP status and `error.code` should agree.

Recommended mappings:

- `400` → `BAD_REQUEST`
- `401` → `UNAUTHORIZED`
- `403` → `NAMESPACE_WRITE_FORBIDDEN`
- `404` → `PATH_NOT_FOUND` or `CLAIM_NOT_FOUND`
- `409` → `NAMESPACE_TAKEN`
- `422` → `CLAIM_VERIFICATION_FAILED`
- `500` → `INTERNAL_ERROR`

---

## Compatibility Rule

During migration, the server MAY continue returning the legacy minimal read shape:

```json
{
  "ok": true,
  "namespace": "cleaker.me",
  "path": "users/ana/read/profile.name",
  "value": "Ana"
}
```

Clients **MUST** accept both:
- The legacy minimal shape
- The full response envelope

---

## Client Normalization
The `remotePointer` client should normalize read responses as follows:
1. If `result.value` exists, use that.
2. Else if top-level `value` exists, use that.
3. Else return the full payload as raw data.

This preserves compatibility with the current server while allowing a richer contract.

## Future Extension
After the envelope stabilizes, add optional:

- `@context`
- signed namespace records
- response signatures
- content negotiation for `application/ld+json`
But those should be additive, not required for the first remote contract.
