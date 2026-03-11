# Monad.ai

Monad.ai is the daemon host for the `me://` runtime.

This package exposes:

- ledger persistence
- claim/open flows
- namespace routing
- semantic path resolution
- remote exchange metadata for `me://` targets

## Entry Points

- [Routing Spec](./nrp-routing-spec.md)
- [Remote Exchange Spec](./nrp-remote-exchange-spec.md)
- [API Docs](./api/README.md)

## Package

- Runtime entry: `server.ts`
- Source tree: `src/`
- Tests: `tests/`

## Commands

```bash
npm run start
npm run docs:api
npm run docs:build
```
