# `funnel.json`

Configuración de Tailscale Serve/Funnel que monta el servicio `tailscale` de
`docker-compose.yml`. No lleva comentarios adentro porque es JSON estricto: Tailscale lo
parsea tal cual y una clave de más lo rompe.

Qué hace cada parte:

- **`${TS_CERT_DOMAIN}`** — lo reemplaza el propio contenedor, al arrancar, por el nombre
  `.ts.net` real de este nodo. **No escribas el hostname a mano.** Si lo hacés, el día que
  el nodo se renombre —o que se vuelva a unir al tailnet y Tailscale le agregue un `-1`—
  el Funnel deja de responder y el log no dice por qué.

- **`TCP.443.HTTPS: true`** — escucha en 443 con certificado TLS de Tailscale, emitido y
  renovado solo.

- **`Web[...].Handlers["/"].Proxy`** — todo lo que llega va a `http://api:8080`, por la red
  privada de Compose. El contenedor `api` no publica ese puerto hacia afuera: el único
  camino desde internet es este proxy.

- **`AllowFunnel`** — es la diferencia entre Serve y Funnel. Sin esa clave el sitio se ve
  **solo desde adentro del tailnet**, que es exactamente lo que no queremos: los encargados
  de departamento no tienen Tailscale ni cuenta, y tienen que poder abrir el enlace desde
  el teléfono.

Si algún día cambia el puerto interno de la API, se cambia acá y en `API_PUERTO`.
