# El servidor

Cómo se instala, se levanta, se respalda y se arregla ControlHorario en la máquina de la
oficina de Fisterra.

Está escrito para leerse a las 11 de la noche con algo caído. Los comandos están completos:
se copian y se pegan. Lo que hay que reemplazar está en `MAYÚSCULAS`.

**Dónde se corre cada comando.** Hay dos consolas distintas y confundirlas es la mitad de
los problemas:

| Se ve así | Es | Cómo se abre |
|---|---|---|
| `PS>` | PowerShell de Windows | Menú Inicio → `PowerShell` |
| `$` | Ubuntu adentro de WSL | Menú Inicio → `Ubuntu`, o `wsl` desde PowerShell |

El proyecto vive **adentro de WSL**, en `/srv/controlhorario`. Desde el Explorador de
Windows se abre en `\\wsl.localhost\Ubuntu\srv\controlhorario`.

---

## 1. Si se cayó: cinco cosas, en este orden

No saltees pasos. Cada uno descarta una capa y el siguiente sólo tiene sentido si el
anterior dio bien.

### 1.1 ¿Contesta la aplicación desde la propia máquina?

```powershell
PS> curl.exe -s http://127.0.0.1:8080/health
```

- **Contesta con `"ok":true`** → la aplicación está bien. El problema está afuera: saltá
  al paso 4 (el túnel).
- **Contesta con `"ok":false`** → la API vive pero la base no. Paso 3.
- **No contesta nada** → paso 2.

### 1.2 ¿Están prendidos WSL y los contenedores?

```powershell
PS> wsl -l -v
PS> wsl -d Ubuntu -- docker compose -f /srv/controlhorario/docker-compose.yml ps
```

Si la distro dice `Stopped`, o `ps` no lista nada, levantá todo:

```powershell
PS> wsl -d Ubuntu -- /srv/controlhorario/docker/arranque/arrancar.sh
```

Ese script espera al demonio de Docker y después hace `docker compose up -d`. Es el mismo
que corre la tarea programada al encender la máquina.

Si dice que el demonio de Docker no responde:

```bash
$ sudo systemctl status docker
$ sudo systemctl start docker
```

### 1.3 ¿Está sana la base de datos?

```bash
$ cd /srv/controlhorario
$ docker compose ps postgres
$ docker compose logs --tail=80 postgres
```

- `unhealthy` o reiniciando en bucle → mirá los logs. Lo más común es **disco lleno**
  (paso 5) o un `.env` cambiado después de la primera vez (ver §9.2).
- `healthy` pero la API sigue diciendo `"ok":false` → reiniciá la API sola:
  ```bash
  $ docker compose restart api
  $ docker compose logs --tail=60 api
  ```

### 1.4 ¿Está arriba el túnel?

```bash
$ cd /srv/controlhorario
$ docker compose exec tailscale tailscale status
$ docker compose exec tailscale tailscale funnel status
```

`funnel status` tiene que mostrar `https://NOMBRE.TAILNET.ts.net` apuntando a
`http://api:8080`. Si no muestra nada:

```bash
$ docker compose restart tailscale
$ docker compose logs --tail=60 tailscale
```

Si dice que Funnel no está habilitado, falta el permiso en el tailnet: §6.3.

### 1.5 ¿Se llenó el disco?

Es la causa más frecuente de una caída sin explicación, y la que menos se sospecha.

```bash
$ df -h /
$ docker system df
$ du -sh /srv/controlhorario/respaldos
```

Para recuperar espacio rápido, sin tocar los datos ni los respaldos:

```bash
$ docker image prune -a -f
$ docker builder prune -a -f
```

`docker system prune --volumes` **NO**: eso borra volúmenes, y ahí está la base.

---

## 2. Preparar Windows: WSL2 y Docker Engine

> **Por qué no Docker Desktop.** Docker Desktop es una aplicación de usuario: no arranca
> hasta que alguien inicia sesión en Windows. Si la máquina se reinicia sola un domingo a
> las 3 de la mañana, el sistema queda caído hasta que alguien llega a la oficina el lunes.
> Docker Engine adentro de WSL2 arranca con la máquina, sin sesión iniciada.
>
> Si ya tenés Docker Desktop instalado, **desinstalalo** o al menos sacale el arranque
> automático: los dos peleando por el mismo `docker` en el PATH generan errores que no
> dicen la verdad.

### 2.1 Instalar WSL2

En PowerShell **como administrador**:

```powershell
PS> wsl --install -d Ubuntu-24.04
PS> wsl --set-default-version 2
PS> wsl --update
```

Reiniciá Windows. Al volver, se abre Ubuntu y pide crear un usuario y una contraseña.
**Anotá esa contraseña**: hace falta para todos los `sudo`.

Comprobá que quedó en versión 2:

```powershell
PS> wsl -l -v
```

### 2.2 Encender systemd adentro de Ubuntu

Sin systemd, Docker no arranca solo y la distro se apaga cuando no queda ningún proceso
adentro. Los dos problemas se resuelven con estas cuatro líneas.

```bash
$ sudo tee /etc/wsl.conf > /dev/null <<'EOF'
[boot]
systemd=true
EOF
```

Cerrá Ubuntu y apagá la máquina virtual desde PowerShell:

```powershell
PS> wsl --shutdown
```

Volvé a abrir Ubuntu y verificá:

```bash
$ systemctl is-system-running
```

Tiene que decir `running` (o `degraded`, que también sirve).

### 2.3 Que la máquina virtual no se apague sola

Windows apaga la VM de WSL cuando la ve ociosa. Con systemd prendido no debería pasar,
pero conviene asegurarlo. En PowerShell:

```powershell
PS> notepad $env:USERPROFILE\.wslconfig
```

Pegá esto y guardá:

```ini
[wsl2]
vmIdleTimeout=-1
```

```powershell
PS> wsl --shutdown
```

### 2.4 Instalar Docker Engine

Adentro de Ubuntu, del repositorio oficial de Docker:

```bash
$ sudo apt-get update
$ sudo apt-get install -y ca-certificates curl
$ sudo install -m 0755 -d /etc/apt/keyrings
$ sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
$ sudo chmod a+r /etc/apt/keyrings/docker.asc
$ echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
$ sudo apt-get update
$ sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Que arranque con la distro, y poder usarlo sin `sudo`:

```bash
$ sudo systemctl enable --now docker
$ sudo usermod -aG docker "$USER"
```

Cerrá Ubuntu, `wsl --shutdown` desde PowerShell, volvé a abrir, y comprobá:

```bash
$ docker version
$ docker compose version
$ docker run --rm hello-world
```

### 2.5 Traer el proyecto

**Adentro de WSL, no en `C:\`.** Si el proyecto vive en `/mnt/c/...`, cada build cruza la
frontera Windows/Linux y tarda varios minutos en vez de segundos.

```bash
$ sudo mkdir -p /srv/controlhorario
$ sudo chown "$USER":"$USER" /srv/controlhorario
$ git clone LA_URL_DEL_REPOSITORIO /srv/controlhorario
$ cd /srv/controlhorario
```

Directorio de respaldos:

```bash
$ sudo mkdir -p /srv/controlhorario/respaldos
$ sudo chown "$USER":"$USER" /srv/controlhorario/respaldos
```

---

## 3. Arranque automático al encender la máquina

Esto es lo que hace que el servidor vuelva solo después de un corte de luz, sin que nadie
inicie sesión en Windows.

### 3.1 Crear la tarea

1. Menú Inicio → **Programador de tareas** → *Crear tarea…* (no "Crear tarea básica":
   la básica no tiene las opciones que hacen falta).

2. Pestaña **General**:
   - Nombre: `ControlHorario - arranque`
   - **Ejecutar tanto si el usuario inició sesión como si no** ← imprescindible
   - **No almacenar la contraseña** ← marcalo; la tarea no necesita recursos de red
   - **Ejecutar con los privilegios más altos**
   - Configurar para: `Windows 10`
   - El usuario tiene que ser **tu cuenta**, no `SYSTEM`. Las distros de WSL están
     registradas por usuario: una tarea corriendo como `SYSTEM` no ve `Ubuntu` y falla con
     "no distribution found".

3. Pestaña **Desencadenadores** → *Nuevo…*:
   - Iniciar la tarea: **Al iniciar el sistema**
   - **Retrasar la tarea durante: 1 minuto** (deja que la red y el subsistema de WSL
     terminen de levantar)

4. Pestaña **Acciones** → *Nueva…*:
   - Acción: `Iniciar un programa`
   - Programa o script:
     ```
     C:\Windows\System32\wsl.exe
     ```
   - Agregar argumentos:
     ```
     -d Ubuntu --exec /bin/bash /srv/controlhorario/docker/arranque/arrancar.sh
     ```

5. Pestaña **Condiciones**: **destildá** *Iniciar la tarea solo si el equipo está conectado
   a la corriente alterna*. En una PC de escritorio no cambia nada; en una notebook, es la
   razón por la que un día no arrancó.

6. Pestaña **Configuración**:
   - Tildá *Ejecutar la tarea lo antes posible tras un inicio programado que no se realizó*
   - Tildá *Si la tarea falla, reiniciarla cada*: `5 minutos`, hasta `3` veces
   - Destildá *Detener la tarea si se ejecuta durante más de…*

### 3.2 Probarla sin reiniciar

```powershell
PS> Start-ScheduledTask -TaskName "ControlHorario - arranque"
PS> Start-Sleep -Seconds 90
PS> curl.exe -s http://127.0.0.1:8080/health
```

Y el registro de lo que hizo:

```bash
$ tail -40 /var/log/controlhorario-arranque.log
```

### 3.3 Probarla de verdad

Reiniciá la máquina, **no inicies sesión en Windows**, esperá tres minutos, y desde otra
computadora abrí la URL pública. Si contesta, el arranque automático funciona. Es la única
prueba que vale: todo lo demás confirma que anda con vos sentado adelante.

---

## 4. Primera puesta en marcha

### 4.1 El archivo `.env`

```bash
$ cd /srv/controlhorario
$ cp .env.example .env
$ nano .env
```

Lo mínimo que hay que completar:

| Variable | Qué poner |
|---|---|
| `PGPASSWORD` | Una contraseña larga y aleatoria. Generala, no la inventes. |
| `TS_HOSTNAME` | `controlhorario` sirve. Es la primera parte de la dirección pública. |
| `TS_AUTHKEY` | La clave de Tailscale (§6.2). Sólo la primera vez. |
| `APP_URL_PUBLICA` | Se completa en §6.5, cuando ya sepas el nombre real. |

Para generar la contraseña:

```bash
$ openssl rand -base64 32
```

`.env` está en `.gitignore` y nunca se sube al repositorio. Es el único archivo del
proyecto con secretos adentro.

### 4.2 Levantar todo

```bash
$ cd /srv/controlhorario
$ docker compose up -d --build
```

La primera vez tarda: baja las imágenes y compila el frontend y la API adentro de la imagen.

```bash
$ docker compose ps
```

Los cuatro servicios tienen que estar `Up`. `postgres` y `api` además dicen `(healthy)`.

### 4.3 Comprobar

```bash
$ curl -s http://127.0.0.1:8080/health
```

Esperado:

```json
{"ok":true,"servicio":"controlhorario-api","uptimeS":12,
 "urlPublica":"https://controlhorario.TAILNET.ts.net",
 "baseDeDatos":{"alcanzable":true,"latenciaMs":2,"host":"postgres",
                "base":"controlhorario","migracionesAplicadas":1}}
```

Y la aplicación, incluidos los enlaces profundos:

```bash
$ curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/
$ curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/ausencias
```

Las dos tienen que dar `200`. La segunda importa: `/ausencias` no es un archivo, es una
ruta del navegador. Si da `404`, el servidor está sirviendo los archivos pero perdió el
*fallback* de la SPA y cualquier enlace compartido o cualquier F5 adentro de la aplicación
va a romperse.

---

## 5. Migraciones

El esquema vive en `db/migrations/*.sql`. Se aplican **solas al arrancar la API**, antes de
que acepte la primera petición: `docker compose up -d` deja la base al día o el contenedor
no levanta, y el motivo sale en los logs.

> En todos los comandos de abajo, `-U controlhorario` y `-d controlhorario` son los valores
> por defecto de `PGUSER` y `PGDATABASE` en `.env.example`. Si los cambiaste, cambiá también
> los comandos.

Ver qué tiene aplicado la base:

```bash
$ docker compose exec -T postgres psql -U controlhorario -d controlhorario \
    -c "SELECT version, aplicada_at, duracion_ms FROM schema_migrations ORDER BY version"
```

Aplicarlas a mano (por ejemplo con `API_MIGRAR_AL_INICIAR=false`, o para agregar una nueva
sin reiniciar):

```bash
$ docker compose exec api node dist-api/api/migrar.js
```

Es idempotente: correrlo dos veces no hace nada la segunda.

### 5.1 Reglas para escribir una migración nueva

1. **Nunca edites un archivo ya aplicado.** El runner guarda el checksum de cada uno y se
   niega a arrancar si cambian. Si lo hiciera, la base de la oficina y el archivo del
   repositorio dejarían de describir el mismo esquema y nada te avisaría.
2. **El nombre empieza con tres dígitos**: `002_...sql`, `003_...sql`. El orden es
   alfabético, y `10_` iría antes que `2_`.
3. **Cada archivo abre y cierra su propia transacción**, con `BEGIN;` al principio y
   `COMMIT;` al final, igual que `001_initial.sql`. El runner no las envuelve.

### 5.2 Si una migración quedó aplicada pero sin registrar

Sólo pasa si el proceso muere en el instante exacto entre que la migración se confirma y
que se anota. Se ve como un error de "ya existe el tipo/tabla" al reintentar. Se arregla
anotándola a mano, con el checksum real del archivo.

Primero sacá el checksum. **Ojo con los saltos de línea**: el runner normaliza CRLF a LF
antes de hashear, así que hay que hacer lo mismo acá o el número no va a coincidir.

```bash
$ tr -d '\r' < db/migrations/002_ARCHIVO.sql | sha256sum
```

Después entrá a la base y anotala:

```bash
$ docker compose exec -it postgres psql -U controlhorario -d controlhorario
```

```sql
INSERT INTO schema_migrations (version, checksum, duracion_ms)
VALUES ('002_ARCHIVO.sql', 'PEGA_ACA_EL_SHA256', 0);
\q
```

Volvé a correr `docker compose exec api node dist-api/api/migrar.js`: tiene que decir
"ya estaba" y no aplicar nada.

---

## 6. Tailscale Funnel: la dirección pública

Funnel publica la aplicación en internet con HTTPS, sin comprar dominio, sin tocar el DNS,
sin abrir un puerto en el router de la oficina y sin IP fija. El certificado se emite y se
renueva solo.

La dirección es **estable entre reinicios**, y eso es lo que realmente importa acá: el
slice 3 manda enlaces por correo a los encargados de departamento y los abren días después.

> **El límite de 6 usuarios del plan gratuito cuenta cuentas del tailnet, no visitas.**
> Es decir: las personas que administran este servidor y tienen Tailscale instalado. Quien
> abre la URL pública desde afuera **no tiene Tailscale, no inicia sesión y no cuenta**.
> Los encargados de departamento entrando desde el teléfono son visitas: podés tener
> cientos sin pasarte del plan gratuito.

### 6.1 Crear la cuenta

Entrá a <https://tailscale.com> y creá una cuenta (plan Personal, gratuito). Anotá el nombre
del *tailnet* que te asigna: es algo como `tail1a2b3.ts.net`.

### 6.2 Generar la clave de alta

1. <https://login.tailscale.com/admin/settings/keys> → **Generate auth key**
2. Tildá **Ephemeral: no** y **Reusable: no**. Una sola máquina se va a dar de alta con ella.
3. Copiala a `TS_AUTHKEY` en `.env`.

Después de que el nodo se una, la identidad queda guardada en el volumen
`controlhorario_tailscale_estado`. **Vaciá `TS_AUTHKEY` en `.env` y borrá la clave desde el
panel**: si queda ahí, cualquiera que lea el `.env` puede meter una máquina en tu tailnet.

### 6.3 Habilitar HTTPS y Funnel en el tailnet

Los dos vienen apagados y los dos hacen falta.

1. **HTTPS**: <https://login.tailscale.com/admin/dns> → *HTTPS Certificates* → **Enable**.
2. **Funnel**: <https://login.tailscale.com/admin/acls> → agregá `nodeAttrs` al archivo de
   políticas:

   ```json
   {
     "nodeAttrs": [
       {
         "target": ["*"],
         "attr":   ["funnel"]
       }
     ]
   }
   ```

   Guardá. Sin esto, el contenedor levanta, se une al tailnet, y el sitio se ve **sólo desde
   adentro del tailnet** — que es exactamente lo que no queremos.

### 6.4 Levantar y averiguar la dirección

```bash
$ cd /srv/controlhorario
$ docker compose up -d tailscale
$ docker compose logs -f tailscale        # Ctrl+C cuando diga que se conectó
$ docker compose exec tailscale tailscale status
$ docker compose exec tailscale tailscale funnel status
```

`funnel status` imprime la dirección pública completa. Va a ser algo como:

```
https://controlhorario.tail1a2b3.ts.net (Funnel on)
|-- / proxy http://api:8080
```

### 6.5 Decirle a la aplicación cuál es su dirección

```bash
$ nano .env      # APP_URL_PUBLICA=https://controlhorario.tail1a2b3.ts.net
$ docker compose up -d api
$ curl -s http://127.0.0.1:8080/health
```

`urlPublica` en la respuesta tiene que coincidir exactamente con lo que dijo
`funnel status`. La aplicación **nunca** adivina su dirección del encabezado `Host`: los
enlaces mágicos del slice 3 se arman con este valor, y un enlace armado desde un encabezado
es un enlace que se puede falsificar.

### 6.6 Probarlo desde afuera

Desde el teléfono, **con los datos móviles, no con el WiFi de la oficina**:

```
https://controlhorario.TAILNET.ts.net/ausencias
```

Tiene que abrir la aplicación. Si abre desde la oficina pero no desde datos móviles, lo que
está funcionando es Serve, no Funnel: volvé a §6.3.

### 6.7 Un aviso sobre la dirección

`https://controlhorario.tail1a2b3.ts.net` es una dirección **rara de ver en un correo**. Un
encargado de departamento que recibe un enlace así en el teléfono, para una notificación
disciplinaria, tiene motivos razonables para desconfiar y no hacer clic — y la tasa de
respuesta es justamente de lo que depende el slice 3.

Funciona perfectamente y no cuesta nada, que es por qué es lo que está puesto hoy. Pero
**el día que Fisterra tenga un dominio propio, conviene mudarse**: un enlace a
`https://fichadas.fisterra.com.ar` lo abre cualquiera sin pensarlo. El camino está en §10 y
son cinco minutos.

---

## 7. Salud y logs

### Salud

```bash
$ curl -s http://127.0.0.1:8080/health
```

| Código | Qué significa | Dónde seguir |
|---|---|---|
| `200` + `"ok":true` | Todo bien | — |
| `503` + `"ok":false` | La API vive, la base no contesta | §1.3 |
| sin respuesta | La API no está corriendo | §1.2 |
| `"migracionesAplicadas": null` | La base nunca recibió el esquema | §5 |

### Logs

```bash
$ cd /srv/controlhorario
$ docker compose logs -f api                 # en vivo
$ docker compose logs --tail=200 api         # las últimas 200
$ docker compose logs --since=30m api        # la última media hora
$ docker compose logs --tail=100 postgres
$ docker compose logs --tail=100 tailscale
$ docker compose logs --tail=50 backup
```

Los logs de la API son JSON, una línea por evento. Para leerlos cómodo:

```bash
$ docker compose logs --tail=100 --no-log-prefix api | jq -r '"\(.time) \(.level) \(.msg) \(.evento // "")"'
```

**Los logs no contienen datos de nadie.** Una carga registra seis números (recibidas,
descartadas, nuevas, actualizadas, sin cambios, total) y nada más: ni DNI, ni nombre, ni
fecha, ni motivo. Es a propósito — estos datos incluyen documentos y ausencias por
enfermedad, y un archivo de log termina pegado en un chat el primer día que algo se rompe.
Los errores de base de datos se recortan al código de error y al nombre de la restricción,
porque Postgres escribe los valores de la fila en el mensaje.

Rotan solos: 10 MB por archivo, 5 archivos por servicio.

---

## 8. Respaldos y restauración

Esta base es el respaldo probatorio de cada notificación disciplinaria que manda la empresa.
Perderla significa no poder defender una sanción que alguien impugne.

### 8.1 Cómo funciona

El servicio `backup` corre `pg_dump` una vez por día a la hora de `RESPALDO_HORA` (03:30 por
defecto), en formato *custom* (comprimido, y restaurable tabla por tabla). Después de cada
dump lo verifica con `pg_restore --list`: si el archivo no se puede ni listar, no se va a
poder restaurar, y es mejor enterarse esa noche.

- Diarios: se conservan `RESPALDO_DIARIOS` (14).
- Mensuales: el del día 1 de cada mes se guarda aparte, `RESPALDO_MENSUALES` (12).
- Se escriben con extensión `.parcial` y se renombran al terminar, así un dump cortado a la
  mitad nunca parece uno bueno.

### 8.2 Dónde están

Desde WSL:

```bash
$ ls -lh /srv/controlhorario/respaldos
$ cat /srv/controlhorario/respaldos/ESTADO.txt
```

Desde el Explorador de Windows:

```
\\wsl.localhost\Ubuntu\srv\controlhorario\respaldos
```

Se copian a un pendrive arrastrándolos, como cualquier carpeta.

### 8.3 Hacer uno ahora mismo

```bash
$ cd /srv/controlhorario
$ docker compose exec -T backup bash -c 'pg_dump --format=custom --compress=9 --no-owner --no-privileges --file=/respaldos/manual-$(date +%Y%m%d-%H%M%S).dump'
$ ls -lh respaldos/
```

(El contenedor `backup` ya tiene `PGHOST`, `PGUSER`, `PGPASSWORD` y `PGDATABASE` en su
entorno, así que `pg_dump` y `pg_restore` no necesitan que le pases la conexión.)

### 8.4 Ver qué hay adentro de un dump (no restaura nada)

```bash
$ docker compose exec -T backup pg_restore --list /respaldos/ARCHIVO.dump | head -40
```

### 8.5 Restaurar — camino seguro (recomendado)

Restaura sobre una base **nueva**, te deja verificarla, y recién después la pone en su lugar.
La base rota no se borra: queda a un lado por si hacía falta.

```bash
$ cd /srv/controlhorario

# 1. Parar la aplicación para que nadie escriba mientras tanto.
$ docker compose stop api

# 2. Crear una base vacía al lado.
$ docker compose exec -T postgres createdb -U controlhorario controlhorario_restaurada

# 3. Restaurar el dump adentro de esa base.
$ docker compose exec -T backup pg_restore --dbname=controlhorario_restaurada \
    --no-owner --no-privileges --exit-on-error /respaldos/ARCHIVO.dump

# 4. VERIFICAR antes de tocar nada. Estos números tienen que tener sentido.
$ docker compose exec -T postgres psql -U controlhorario -d controlhorario_restaurada -c \
  "SELECT (SELECT count(*) FROM fichadas) AS fichadas, (SELECT count(*) FROM ausencias) AS ausencias, (SELECT count(*) FROM cargas) AS cargas, (SELECT max(fecha) FROM fichadas) AS ultimo_dia"

# 5. Recién ahora, intercambiar. Primero cortar cualquier conexión que quede abierta.
$ docker compose exec -T postgres psql -U controlhorario -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname LIKE 'controlhorario%' AND pid <> pg_backend_pid()"
$ docker compose exec -T postgres psql -U controlhorario -d postgres -c \
  "ALTER DATABASE controlhorario RENAME TO controlhorario_rota"
$ docker compose exec -T postgres psql -U controlhorario -d postgres -c \
  "ALTER DATABASE controlhorario_restaurada RENAME TO controlhorario"

# 6. Levantar la aplicación y comprobar.
$ docker compose start api
$ sleep 10 && curl -s http://127.0.0.1:8080/health
```

Cuando estés seguro de que todo anda, y no antes:

```bash
$ docker compose exec -T postgres dropdb -U controlhorario controlhorario_rota
```

### 8.6 Restaurar — camino rápido (destructivo)

Sólo si la base actual no sirve para nada y no querés conservarla. **Borra la base actual
sin vuelta atrás.**

```bash
$ cd /srv/controlhorario
$ docker compose stop api
$ docker compose exec -T postgres dropdb -U controlhorario --force controlhorario
$ docker compose exec -T postgres createdb -U controlhorario controlhorario
$ docker compose exec -T backup pg_restore --dbname=controlhorario \
    --no-owner --no-privileges --exit-on-error /respaldos/ARCHIVO.dump
$ docker compose start api
$ sleep 10 && curl -s http://127.0.0.1:8080/health
```

### 8.7 Dos cosas que faltan, y son tuyas

**Hacé una restauración de prueba. Una vez, ahora, con todo funcionando.** Seguí §8.5 hasta
el paso 4 y después borrá `controlhorario_restaurada` sin intercambiar nada:

```bash
$ docker compose exec -T postgres dropdb -U controlhorario controlhorario_restaurada
$ docker compose start api
```

Tarda diez minutos y es la única forma de saber que los respaldos sirven. Un respaldo que
nadie restauró nunca no es un respaldo: es un archivo que suponemos que sirve. La noche que
haga falta no es el momento de averiguarlo.

**La copia fuera de la máquina es una decisión que todavía tenés que tomar, y no la tomé
por vos.** Hoy los respaldos están en el mismo disco de la misma máquina que la base. Eso
cubre "borré algo sin querer" y "la base se corrompió". No cubre nada de esto:

- se rompe el disco;
- se incendia o se inunda la oficina;
- se roban la máquina;
- un ransomware cifra el disco entero, respaldos incluidos.

Cualquiera de esas cuatro y no queda nada. Las opciones razonables, de menor a mayor
esfuerzo: copiar la carpeta a un pendrive una vez por semana y guardarlo en otro edificio;
sincronizarla a OneDrive o Google Drive con la cuenta de la empresa; o `rclone` a un bucket
de object storage, cifrado, desde el mismo contenedor. **Tiene que ser una copia que el
ransomware no pueda alcanzar desde esta máquina**, así que un disco externo conectado
siempre no cuenta.

Cualquiera de las tres es infinitamente mejor que ninguna. Elegí una.

### 8.8 Los adjuntos se respaldan aparte

**`pg_dump` no los copia.** El dump nocturno trae la base entera — incluido, de cada
adjunto, el nombre original, el tamaño, el tipo y quién lo subió — pero **no los archivos**.
Los archivos están en el volumen `controlhorario_adjuntos`, que Docker maneja aparte.

Restaurar sólo la base deja la pantalla de Ausencias mostrando certificados que existen en
el registro y no se pueden descargar. Es la clase de cosa que se descubre el día que hace
falta el certificado.

Copiar el volumen a la misma carpeta que los dumps:

```bash
$ cd /srv/controlhorario
$ docker run --rm \
    -v controlhorario_adjuntos:/datos:ro \
    -v /srv/controlhorario/respaldos:/salida \
    postgres:17.11-bookworm \
    tar czf /salida/adjuntos-$(date +%%Y%%m%%d).tar.gz -C /datos .
```

Y restaurarlo:

```bash
$ docker compose stop api
$ docker run --rm \
    -v controlhorario_adjuntos:/datos \
    -v /srv/controlhorario/respaldos:/entrada:ro \
    postgres:17.11-bookworm \
    tar xzf /entrada/ARCHIVO.tar.gz -C /datos
$ docker compose start api
```

**Ese `.tar.gz` son certificados médicos.** Va a la misma copia fuera de la máquina que los
dumps y con el mismo cuidado: no a una carpeta compartida, no a un pendrive que anda dando
vueltas. `respaldos/` ya está en `.gitignore` y en `.dockerignore`.

---

## 9. Tareas comunes

### 9.1 Actualizar la aplicación

```bash
$ cd /srv/controlhorario
$ git pull
$ docker compose up -d --build
$ curl -s http://127.0.0.1:8080/health
```

Las migraciones nuevas se aplican solas al arrancar la API. Antes de una actualización
grande, hacete un respaldo a mano (§8.3).

### 9.2 Cambiar la contraseña de la base

Cambiar `PGPASSWORD` en `.env` **no** cambia la contraseña real: `POSTGRES_PASSWORD` sólo se
usa la primera vez que Postgres inicializa el volumen. Si cambiás sólo el `.env`, la API
deja de poder conectarse. Hay que cambiar las dos:

```bash
$ cd /srv/controlhorario
$ docker compose exec -it postgres psql -U controlhorario -d controlhorario
```

```sql
ALTER USER controlhorario WITH PASSWORD 'LA_NUEVA';
\q
```

```bash
$ nano .env        # PGPASSWORD=LA_NUEVA
$ docker compose up -d
$ curl -s http://127.0.0.1:8080/health
```

### 9.3 Entrar a la base con psql

```bash
$ docker compose exec -it postgres psql -U controlhorario -d controlhorario
```

Desde Windows, con una herramienta gráfica: `127.0.0.1:5432`. El puerto está publicado
**sólo en localhost**, así que no es alcanzable desde la red de la oficina.

### 9.4 Parar y levantar

```bash
$ docker compose stop        # para todo, no borra nada
$ docker compose up -d       # vuelve a levantar
$ docker compose restart api # sólo la API
```

`docker compose down` también borra la red y los contenedores (los datos siguen en el
volumen). **`docker compose down -v` borra los volúmenes: eso borra la base. No lo corras.**

### 9.5 Ver cuánto ocupa la base

```bash
$ docker compose exec -T postgres psql -U controlhorario -d controlhorario -c \
  "SELECT pg_size_pretty(pg_database_size(current_database()))"
```

---

## 10. Mudarse a un dominio propio (Cloudflare Tunnel)

El día que Fisterra tenga dominio. El servicio ya está escrito y comentado en
`docker-compose.yml`.

1. En Cloudflare Zero Trust → *Networks* → *Tunnels* → crear un túnel, y adentro un
   *public hostname* (`fichadas.fisterra.com.ar`) apuntando al servicio
   `http://api:8080`.
2. Copiar el token del túnel a `CLOUDFLARE_TUNNEL_TOKEN` en `.env`.
3. Cambiar `APP_URL_PUBLICA` a la dirección nueva.
4. En `docker-compose.yml`: descomentar el bloque `cloudflared`, comentar el bloque
   `tailscale`.
5. `docker compose up -d`
6. Comprobar la dirección nueva desde afuera, con datos móviles.
7. **Recién cuando la nueva ande**, dar de baja el nodo de Tailscale desde el panel.

Nada de la aplicación cambia. No sabe cuál de los dos túneles tiene adelante, y ése era el
punto: la dirección pública sale de una variable de entorno, igual que la persistencia sale
de un adaptador.

Alternativa: `cloudflared` también se instala como **servicio nativo de Windows**
(`cloudflared service install TOKEN`), que arranca con la máquina sin sesión iniciada y sin
depender de Docker. Tiene una ventaja concreta: si el stack se cae, el sitio devuelve un
502 que se ve, en vez de un nombre que desaparece de internet. Si vas por ahí, apuntá el
túnel a `http://127.0.0.1:8080` y dejá el bloque de Compose comentado.

---

## 11. Lo que todavía no está resuelto

Cosas que conviene tener en la cabeza y que este slice no cierra:

1. **Los adjuntos no entran en el respaldo nocturno.** `pg_dump` copia la base, y en la
   base están el nombre, el tamaño y quién subió cada archivo — no los bytes. Los bytes
   están en el volumen `controlhorario_adjuntos`. Un restore deja la pantalla mostrando
   certificados que no se pueden descargar. Cómo copiarlo está en §8.8.

2. **El límite de intentos de acceso vive en memoria.** Reiniciar la API lo borra. Con un
   solo proceso y sin forma de que alguien de afuera lo reinicie, es un riesgo aceptado a
   conciencia; el día que corran dos instancias, hay que moverlo a la base
   (`src/api/limitador.ts` lo dice en su encabezado).

3. **No hay recuperación de contraseña por correo, y no la va a haber.** Son tres o cuatro
   cuentas y el servidor está en la oficina: si alguien se olvida la contraseña, se la
   cambiás con `--reiniciar-contrasena` (§12.3). Un flujo de "olvidé mi contraseña" es una
   superficie de ataque más para resolver algo que se resuelve caminando.

4. **`cargas.archivo` no guarda el nombre del Excel.** El puerto `RepositorioFichadas` no lo
   transporta: `upsert(filas)` recibe filas y nada más. Se registra
   `(no informado por el cliente)`. Arreglarlo es ensanchar el puerto, que es un cambio de
   otro slice.

5. **Las filas con `Fecha` ilegible no se guardan.** La columna `fecha` de `fichadas` es un
   `DATE` y es media clave primaria, así que una fila cuyo `Fecha` no sea `DD/MM/YYYY` no
   entra: se cuenta como *descartada* en el resumen de la carga. El adaptador de
   localStorage sí las guardaba. Si aparecen exportaciones con otro formato de fecha, se va
   a notar como una diferencia entre "filas en el archivo" y "filas guardadas".

6. **Nadie te avisa si el respaldo falla.** Queda en `respaldos/ESTADO.txt` y en
   `docker compose logs backup`, pero nada te manda un correo. Miralo de vez en cuando, o
   armá algo que lo mire por vos.

7. **Sos la única persona de guardia.** Está aceptado, pero conviene que alguien más sepa
   dónde está este documento.

---

## 12. Acceso: usuarios y sesiones

Desde este slice **la API no contesta nada sin sesión**, salvo `/health` y el propio inicio
de sesión. Antes el túnel era todo el perímetro y cualquiera con la URL leía el DNI, el
legajo y las ausencias por enfermedad de toda la empresa.

### 12.1 Crear el primer usuario

No hay pantalla de registro y no la va a haber: las cuentas las crea quien administra el
servidor, en el servidor.

```bash
$ cd /srv/controlhorario
$ docker compose exec api npm run crear-usuario -- --email TU@CORREO --nombre "Nombre Apellido"
```

Pide la contraseña por teclado, dos veces, sin mostrarla. Mínimo 12 caracteres.

Si `npm` se queja adentro del contenedor, el script es el mismo por la vía directa:

```bash
$ docker compose exec api node dist-api/api/crearUsuario.js --email TU@CORREO --nombre "Nombre Apellido"
```

> **La contraseña nunca se pasa como argumento.** Ni con `--contrasena`, ni "sólo esta vez".
> Un argumento queda escrito en `~/.bash_history` apenas termina el comando y lo ve
> cualquier otro usuario de la máquina en `ps aux` mientras corre. El script lo rechaza a
> propósito y te dice por qué.
>
> Para una instalación desatendida, la otra puerta es la variable de entorno `CH_CONTRASENA`:
>
> ```bash
> $ docker compose exec -e CH_CONTRASENA='...' api npm run crear-usuario -- --email TU@CORREO --nombre "Nombre"
> ```
>
> Y ojo: **ese comando también queda en el historial del shell.** Si lo usás, borrá la línea
> después (`history -d`).

Si te dice que la base no tiene el esquema aplicado, corré primero las migraciones (§5).

### 12.2 Entrar

Abrí la dirección pública y usá el correo y la contraseña. La sesión dura 12 horas
(`API_SESION_HORAS`) y se renueva sola cuando pasó la mitad, así que nadie se queda afuera a
media tarde.

**«Salir» borra la sesión del servidor**, no sólo de ese navegador: la cookie deja de servir
en el instante en que se usa de nuevo, aunque alguien se la haya copiado.

### 12.3 Alguien se olvidó la contraseña

```bash
$ docker compose exec api npm run crear-usuario -- --email SU@CORREO --reiniciar-contrasena
```

Pide la contraseña nueva igual que antes. No hace falta el nombre: la cuenta ya existe.

### 12.4 Dar de baja a una persona

No se borra la cuenta — `auditoria` referencia lo que hizo y esa historia tiene que seguir
siendo legible. Se desactiva:

```bash
$ docker compose exec -T postgres psql -U controlhorario -d controlhorario \
    -c "UPDATE usuarios SET activo = FALSE WHERE email = 'SU@CORREO';"
```

Efecto inmediato: la sesión que tenga abierta deja de funcionar en la petición siguiente.

Para ver quién tiene cuenta:

```bash
$ docker compose exec -T postgres psql -U controlhorario -d controlhorario \
    -c "SELECT email, nombre, activo, creado_at FROM usuarios ORDER BY email;"
```

### 12.5 Cuando no se puede entrar

Andá en este orden.

**«El correo o la contraseña no son correctos».** Es la única respuesta que da el servidor
para cualquier falla de acceso: no existe el correo, la contraseña está mal, o la cuenta
está desactivada. **Es a propósito**: distinguirlas le diría a cualquiera de afuera quién
trabaja en RRHH de esta empresa. Comprobá con el `SELECT` de §12.4 si la cuenta existe y
está activa; si existe, reiniciá la contraseña (§12.3).

**«Hubo demasiados intentos de acceso».** El límite es de 8 intentos por cuenta cada 15
minutos, más un tope general para todo el servidor. Esperá los minutos que dice y volvé a
probar. Si hay que destrabarlo ya, reiniciar la API borra el contador — vive en memoria:

```bash
$ docker compose restart api
```

**Entra y se cae de la sesión sola.** Casi siempre es `API_COOKIE_SEGURA=true` con una
dirección `http://` sin `s`. El navegador se niega a guardar una cookie `Secure` que no
viajó por HTTPS, así que el login «funciona» y la sesión no queda. Por la dirección pública
del túnel (que es HTTPS) tiene que estar en `true`; sólo un `npm run dev` local sobre
`http://localhost` necesita `false`.

**Nadie puede entrar y `/health` contesta `ok:true`.** Fijate si hay algún usuario activo:
un `UPDATE usuarios SET activo = FALSE` de más deja a todo el mundo afuera. Se arregla con
el `SELECT` y el `UPDATE` de §12.4, o creando una cuenta nueva con §12.1.

### 12.6 Qué queda registrado

En `auditoria`, y sin datos de más:

| Acción | Qué guarda |
|---|---|
| `login` | el correo de quien entró |
| `login_fallido` | sólo que hubo un intento fallido. **Nunca el correo probado**: "alguien intentó entrar como ana@" es una frase sobre Ana |
| `logout` | el correo |
| `motivo_asignado` / `motivo_quitado` | quién, qué día (`DNI\|AAAA-MM-DD`) y los ids del motivo nuevo y del anterior. **Nunca la etiqueta**: una etiqueta es «Enfermedad» |
| `adjunto_subido` / `adjunto_descargado` / `adjunto_eliminado` | quién, qué día y el id del archivo. **Nunca el nombre del archivo** |
| `config_actualizada`, `exclusion_agregada`, `exclusion_quitada`, `motivo_creado`… | quién y qué cambió |

Los logs del contenedor no llevan nada de esto: una línea de log tiene contadores y códigos,
nunca una fila. Ver el encabezado de `src/api/servidor.ts`.

### 12.7 Los adjuntos no son archivos estáticos

Son certificados médicos. No hay ninguna URL bajo la que un servidor web los entregue: se
bajan por `GET /api/adjuntos/:id/archivo`, que verifica la sesión, responde
`Content-Disposition: attachment` (el navegador lo guarda, no lo abre en pantalla) y
`Cache-Control: no-store`.

En el disco están con un nombre generado (un UUID y una extensión sacada del tipo
validado), nunca con el nombre que traía el archivo de la computadora de quien lo subió: ese
nombre es un dato, vive en la base y se muestra en pantalla, y no toca jamás una ruta.

Se aceptan PDF y fotos (JPG, PNG, WEBP, HEIC), hasta 10 MB por archivo
(`API_ADJUNTO_MAX_BYTES`).
