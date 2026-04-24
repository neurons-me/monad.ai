# monad.ai
###### Serve `me://` 
### **Namespace**:

Canonical resource grammar:

`me://namespace[selector]/path`

Implementation-specific daemon command surface:

`me://namespace:operation/path`

**1 key = 1 subject = N monads.ai**

**namespace** = canonical resource namespace
**selector** = canonical NRP selector when using the resource grammar
**operation** = daemon/kernel command intent when using the command surface
**path** = semantic route or command target

El claim ahora está anclado al identity hash del kernel en lugar de derivarlo de `namespace + secret`.

The recommended canonical resource form is the one specified by the [Namespace Resolution Protocol](../../docs/en/Namespace%20Resolution%20Protocol.md). Command-style `me://namespace:operation/path` targets remain part of the current daemon implementation surface, but they do not replace the canonical NRP grammar.

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

So now the current **daemon command surface** reads cleanly:

`me://self:read/profile`
`me://self:write/profile.name`
`me://kernel:export/snapshot`
`me://kernel:replay/memory`

---

# **Algebra of Encrypted Audiences**

In this algebra, access and visibility are determined by the interplay of three sets:

- **Context** defines *where* and *on which nodes* data resides.
- **Capability** defines *which actions* are permitted on the data.
- **Encryption** defines *who can decrypt* and read the content.

Mathematically, we express these properties as three sets:

- **T** = *Topology set*
  - On which nodes does the ciphertext exist or replicate?
- **A** = *Audience set*
  - Which identities are authorized to decrypt?
- **P** = *Procedure/Capability set*
  - What actions can be performed on this content?

Thus, an **“encrypted island”** can be formally represented as:

```
Island I = (path, ciphertext, T, A, P)
```

**Example:**  
Suppose an image is saved and replicated across:

- `office-node`
- `iphone`
- `backup-daemon`

Topology set:

```
T = {office, iphone, backup}
```

But only you and your spouse can decrypt it:

```
A = {me, wife}
```

In other words:

- **Multiple nodes may store the island**, but only a specific subset of users can read it.

---

A clean way to conceptualize this is:

- **“Space” is the primary entity:** all other properties are predicates or projections over that space.
- Everything else—membership, replication, visibility, or capabilities—is expressed as refinements, unions, intersections, or other set operations.

Common cases, then, are simple statements about the sets:

| Property        | Predicate                                   |
| --------------- | ------------------------------------------- |
| **private**     | `A = {self}`                                |
| **shared**      | `|A| > 1`                                   |
| **public**      | `A` is open or broadly readable             |
| **encrypted**   | Access to `A` is enforced cryptographically |
| **replicated**  | `|T| > 1`                                   |
| **local**       | `T` includes only the local node            |
| **distributed** | `T` includes remote or multiple nodes       |

**You can formalize any “space” as:**

- **A**: The audience set (who can read)
- **T**: The topology set (where it lives)
- **C**: The capability/action set (what can be done)
- **P**: The path/subspace (context or semantic location)

**Adjectives** like “private”, “shared”, “replicated”, or “encrypted” are then just properties over those sets. For example:

- **private**: Only the owner can read (`A = {self}`)
- **shared**: More than one party can read (`|A| > 1`)
- **public**: Anyone can read (`A` is open)
- **replicated**: The content exists on multiple nodes (`|T| > 1`)
- **encrypted**: Only members of `A` can decrypt, enforced cryptographically

This algebra enables rigorous, composable modeling of trust, replication, and control in distributed, encrypted systems.

---

# The Vision: Namespace Claims

The very first act your kernel performs should be to make a **Claim**.

1. **Local Claim:** `me://local`

   > “I am this node.”

2. **Network Claim:** `me://username.cleaker.me`

   > “I am this identity in the ledger.”

By doing this, your `me://` identifier is no longer a generic alias—it becomes a **Sovereign Deterministic URL**.

------

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

### Review

| Componente                                         | Problema real                                                | Archivo                                              |
| -------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| Selectores `surface:iphone`, `[]`, `[claim:token]` | Parser los reconoce en la gramática, pero `semanticResolver.ts` no los maneja — solo entiende `device`, `host`, `port`, `web` | `semanticResolver.ts:447`                            |
| Surface index                                      | Hay DOS proto-índices no unificados: el registry del binder y `authorized_hosts`. Nunca se consolidaron en un solo concepto formal | `binder.ts` + `memoryStore.ts`                       |
| Claim ceremony                                     | Funciona para el flujo HTTP básico, pero el token es temporal en memoria — no hay HMAC sobre namespace key, no hay nonce registry de consumidos, no hay handshake criptográfico de key transfer | `manager.ts`                                         |
| Documentación                                      | Partida entre specs viejas `nrp://` y el runtime que ya canonizó `me://` | `nrp-routing-spec.md`, `nrp-remote-exchange-spec.md` |

### Missing

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
