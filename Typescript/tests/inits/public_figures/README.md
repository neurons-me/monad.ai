# Public Figures Context Init
Semantic installer for initiating basic context:
- seeds root schema for `profile` and `parent`
- claims 34 public-figure namespaces under a root namespace
- enriches each claimed namespace with profile semantics
- marks each profile with `profile.type.public_figure = true`

## Run
```bash
cd monad.ai/npm
npm run init:public-figures
```

## Env
- `MONAD_ORIGIN` or `MONAD_API_ORIGIN`
  default: `http://localhost:8161`
- `ROOT_NAMESPACE`
  default: auto-detected from `monad.ai /__bootstrap` and falls back to `cleaker.me`
- `PUBLIC_FIGURES_DRY_RUN`
  set to `1` for preview mode

## Notes
- all figures are claimed with the shared secret `orwell1984`
- the installer writes `keys.password_hash`, never a raw password
- parent fields are included only when the seed contains them
