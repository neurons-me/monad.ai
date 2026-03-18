# monad.ai
Monad.ai is the daemon host for the `me://` runtime.
The root `index.html` is the HTML landing page for this repository, mirroring the pattern used in `.me`.

Namespace binding
El namespace viene del Host:

username.cleaker.me -> cleaker.me/users/username
cleaker.me/@a+b      -> cleaker.me/relations/a+b

“Claim activo” significa:
Que para ese namespace existe un registro de claim válido en el ledger (normalmente creado en /claims).
Ese claim amarra:

identidad (identityHash)
clave pública (o prueba)
y un noise/secret asociado
Entonces:

Si hay claim: no cualquiera puede escribir a ese namespace.
Si no hay claim: se permite escritura “open”.
Es una capa de protección por namespace, no por usuario individual necesariamente.