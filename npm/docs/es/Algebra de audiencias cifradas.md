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