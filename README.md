# monad.ai - AlterEgo.
###### **monad.ai** is the daemon for `me://` 
`me://[prefix.]constant:selector/path`

1 llave = 1 sujeto = N monads.ai

**Namespace** binding viene del **host:**
`me://[prefix.]namespace[context]:selector/path`

Entonces, en esa gramática:
**[prefix.]constant = namespace**
- selector = intent/operation
- path = ruta semántica

---

```.me
me://self:read/profile
me://self:write/profile.name
me://self:inspect/profile
me://self:explain/profile.netWorth
me://kernel:read/memory
me://kernel:export/snapshot
me://kernel:import/snapshot
me://kernel:replay/memory
me://kernel:rehydrate/snapshot
me://kernel:get/recompute.mode
me://kernel:set/recompute.mode
me://kernel[device:localhost|protocol:http|port:8161]:export/snapshot
me://ana[host:foo|protocol:https]:read/profile
me://wikileaks[host:wikileaks.org|protocol:https]:read/page
```

---

1. **Explainability:** `me://self:explain/profile.netWorth` is readable by humans and machines. It’s a request for a logic trace on a specific data point.
2. **Remote Kernel Control:** `me://kernel[host:office]:rehydrate/snapshot` allows you to manage a remote daemon with the exact same syntax as a local one.
3. **Clean Ledger:** Every entry in the `monad.ai` ledger will now follow a strict `Subject -> Action -> Object` structure, making audits and replays trivial.

---

So now the **namespace resolution protocol** reads cleanly:

`me://self:read/profile`
`me://self:write/profile.name`
`me://kernel:export/snapshot`
`me://kernel:replay/memory`

---

# **Algebra de audiencias cifradas**.
- el context define **dónde/cuáles nodos**
- la capability define **qué acción está permitida**
- la encryption define **quién puede abrir ese contenido**

La forma matemática sería separar tres sets:

- T = **topology set**
  - en qué nodos vive o se replica el ciphertext
- A = **audience set**
  - qué identidades pueden descifrar
- P = **procedure/capability set**
  - qué acciones pueden ejecutar sobre eso

  Entonces una “encrypted island” sería algo así:

```
Island I = (path, ciphertext, T, A, P) 
```

Ejemplo:
- imagen guardada en:
  - office-node
  - iphone
  - backup-daemon

  Eso es:

```
T = {office, iphone, backup} 
```

Pero solo tú y tu esposa pueden abrirla:

```
A = {me, wife} 
```

Entonces sí:
- **muchos nodos pueden guardar la isla**
- pero solo un subconjunto puede leerla

---

A clean way to hold it is:
- space is the primary thing
- the rest are predicates or projections over that space
- everything is refinement, union, intersection, membership, replication

So:
- public space = its readable audience approaches the open set
- private space = audience is tightly bounded, often {self}
- shared space = audience is a union like {me ∪ wife ∪ ...}
- encrypted space = membership in the readable audience is enforced cryptographically
- replicated space = the topology set has multiple carriers
- local space, remote space, hosted space = just different topology bindings

You can even write it as one space with different sets:
- A = audience set
- T = topology set
- C = capability/action set
- P = path/subspace set

Then the adjectives are just statements about those sets:
- private: A = {self}
- shared: |A| > 1
- encrypted: access to A is cryptographically enforced
- replicated: |T| > 1
- public: A is open or broadly readable

---

# La Visión: El Claim del Namespace
Lo que buscas es que el primer acto de tu kernel sea un **Claim**.
1. **Local Claim:** `me://local` (Yo soy este nodo).
2. **Network Claim:** `me://username.cleaker.me` (Yo soy esta identidad en el ledger).
Al hacer esto, tu `me://` ya no es un alias genérico; se convierte en una **URL Soberana Determinista**.

----

La Visión: El Claim del Namespace
Lo que buscas es que el primer acto de tu kernel sea un **Claim**.
1. **Local Claim:** `me://local` (Yo soy este nodo).
2. **Network Claim:** `me://username.cleaker.me` (Yo soy esta identidad en el ledger).
Al hacer esto, tu `me://` ya no es un alias genérico; se convierte en una **URL Soberana Determinista**.

----

**B primero, luego C.**

El documento que escribimos ya es bueno como visión, pero ahora que tienes el análisis real del repo encima de la mesa, necesitamos anclar cada sección a lo que existe vs. lo que falta. Si saltamos directo a reescribir el doc sin el mapa, volvemos a escribir visión en lugar de protocolo.

Vamos al mapa.

------

## Current Implementation vs. Missing for NRP v0.1

### Lo que YA existe (y dónde vive)

| Componente                                                   | Estado                 | Archivo principal          |
| ------------------------------------------------------------ | ---------------------- | -------------------------- |
| Gramática `me://` + parser                                   | ✅ Completo             | `parseMeTarget.ts`         |
| Alias `nrp://` legacy                                        | ✅ Vivo pero a deprecar | `parseMeTarget.ts:25`      |
| Contexto de binding (`device`, `host`, `port`)               | ✅ Funcional            | `semanticResolver.ts`      |
| `claim/open` HTTP                                            | ✅ Funcional            | `claims.ts` en monad.ai    |
| Claims persistentes firmados ed25519                         | ✅ Sólido               | `manager.ts`               |
| `NamespaceRecord` + selectors                                | ✅ Existe               | `persistentClaimSource.ts` |
| Registry local de hosts (`namespaces.<ns>.registry.hosts`)   | ✅ Existe               | `binder.ts`                |
| Bootstrap handshake (`GET /__bootstrap` + `POST /claims/open`) | ✅ Funcional            | `binder.ts:579, 663`       |
| Resolución remota read/write sobre HTTP                      | ✅ Funciona             | `remotePointer.ts`         |
| Session attestation, nonce, verify, revoke                   | ✅ Existe               | `session.ts`               |
| `authorized_hosts` en memoryStore                            | ✅ Existe               | `memoryStore.ts`           |
| Replay hydration                                             | ✅ Funcional            | monad.ai                   |

### Lo que está a MEDIO CAMINO

| Componente                                         | Problema real                                                | Archivo                                              |
| -------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| Selectores `surface:iphone`, `[]`, `[claim:token]` | Parser los reconoce en la gramática, pero `semanticResolver.ts` no los maneja — solo entiende `device`, `host`, `port`, `web` | `semanticResolver.ts:447`                            |
| Surface index                                      | Hay DOS proto-índices no unificados: el registry del binder y `authorized_hosts`. Nunca se consolidaron en un solo concepto formal | `binder.ts` + `memoryStore.ts`                       |
| Claim ceremony                                     | Funciona para el flujo HTTP básico, pero el token es temporal en memoria — no hay HMAC sobre namespace key, no hay nonce registry de consumidos, no hay handshake criptográfico de key transfer | `manager.ts`                                         |
| Documentación                                      | Partida entre specs viejas `nrp://` y el runtime que ya canonizó `me://` | `nrp-routing-spec.md`, `nrp-remote-exchange-spec.md` |

### Lo que FALTA completamente

| Componente                                  | Gap                                                          | Impacto                          |
| ------------------------------------------- | ------------------------------------------------------------ | -------------------------------- |
| **Surface discovery mesh**                  | No existe. El README mismo lo marca como pendiente (`Namespace discovery bootstrap`). El endpoint hoy sale de `origin` configurado, no de discovery | Bloqueador para mesh real        |
| **Selectores `[]` broadcast**               | No hay implementación. Broadcast a todas las superficies no existe | Bloqueador para `me://ns[]/path` |
| **Relay**                                   | No existe ninguna capa de relay para superficies en redes distintas | Bloqueador para cross-network    |
| **Disclosure model correcto**               | `pathResolver.ts:187` hoy devuelve valor o `PATH_NOT_FOUND`. No hay `stealth root` indistinguible de `wrong key`. El disclosure model del NRP doc no existe en código | Bloqueador de seguridad real     |
| **Surface index unificado**                 | Los dos proto-índices nunca se consolidaron. No hay un `me.surfaces[surface_id]` canónico | Deuda arquitectural              |
| **`surface_id` como hash**                  | Hoy los hosts son strings de origen HTTP, no `HMAC(namespace_key, surface_name)`. La identidad de superficie no está derivada criptográficamente | Deuda de diseño                  |
| **Nonce registry de claims consumidos**     | No hay protección contra replay de claim tokens              | Hueco de seguridad               |
| **Sync de surface index entre superficies** | No hay protocolo de sincronización cuando dos superficies se reconectan | Deuda de distribución            |
| **Revocación formal**                       | `session.ts` tiene revoke, pero es HTTP session, no un tombstone propagado en el mesh | Incompleto                       |

------

### El diagnóstico real

El sistema hoy es **un servidor semántico centralizado con claims firmados** — muy bueno para lo que es, pero arquitecturalmente diferente de un mesh distribuido.

Concretamente: `monad.ai` actúa hoy como el punto central. Los claims se validan ahí, los hosts se registran ahí, la hydration viene de ahí. Es un diseño válido y funciona, pero es `client → central server`, no `surface ↔ surface`.

La distancia entre lo que existe y el NRP v0.1 distribuido no es de features individuales — es de **modelo de red**. El salto es pasar de:

```
surface → monad.ai (central) → resolve
```

a:

```
surface → surface index (local) → surface (peer)
```

Eso no significa tirar lo que existe. Significa que `monad.ai` puede seguir existiendo como **un tipo de superficie** — una superficie siempre-online que otros pueden usar como relay o punto de bootstrap. Pero no debe ser el único camino de resolución.

------

### Orden de trabajo recomendado para cerrar NRP v0.1

Esto es lo que haría en secuencia, porque cada paso desbloquea el siguiente:

**1. Unificar el surface index** — consolidar `registry.hosts` y `authorized_hosts` en un solo concepto formal con `surface_id = HMAC(namespace_key, surface_name)`. Esto es refactor interno, no feature nueva, pero es la base de todo lo demás.

**2. Implementar los selectores faltantes en `semanticResolver.ts`** — `surface:name`, `[]`, `[claim:token]`. El parser ya los entiende. El resolver necesita manejarlos.

**3. Hardener el claim ceremony** — agregar HMAC sobre namespace key, nonce registry, expiración real. Esto es seguridad, no feature.

**4. Implementar el disclosure model correcto en `pathResolver.ts`** — los tres casos (public, stealth root, secret leaf) con respuesta indistinguible para los casos 2 y 4. Esto es un cambio quirúrgico pero crítico.

**5. Surface discovery inicial** — aunque sea P2P simple sobre WebSocket o mDNS local. El README lo marca como pendiente. Sin esto, `surface:iphone` solo funciona si ya conoces el endpoint manualmente.

**6. Broadcast `[]`** — una vez que tienes el surface index unificado y discovery básico, broadcast es solo iterar el índice y multicast.

**7. Relay** — esto es lo más complejo y puede ser v0.2. Por ahora `monad.ai` puede actuar como relay explícito sin ser el único punto de resolución.

------

### Para el documento NRP v0.1 revisado

Con este mapa, el documento que escribimos es correcto en diseño pero necesita una sección nueva: **"Estado actual de la implementación"** — honesta sobre qué secciones están implementadas, cuáles son aspiracionales, y cuáles son trabajo activo. Así el documento funciona simultáneamente como spec y como roadmap.

¿Arrancamos con el paso 1 (unificar el surface index) y escribimos el código, o prefieres primero actualizar el documento NRP con la sección de estado actual para tener todo en orden antes de tocar el código?