# Entorno local

## Interfaz sin servidor

```powershell
npm.cmd install
npm.cmd run dev
```

Este modo usa almacenamiento local y sirve para recorrer la interfaz sin tocar Azure.

## API conectada a Azure SQL

Copiar `.env.example` como `.env` y completar `DB_SERVER`, `DB_NAME`, `DB_USER` y
`DB_PASSWORD`. El archivo `.env` está ignorado por Git. No compartirlo. Para instalar el
esquema se usa temporalmente una identidad administradora; para ejecutar la API se usan las
credenciales limitadas del rol `controlhorario_app`.

```powershell
npm.cmd run build:api
npm.cmd run db:preflight
npm.cmd run db:bootstrap
npm.cmd run db:verify
npm.cmd run db:migrate
npm.cmd run api
```

`db:verify` valida el T-SQL real y revierte la transacción. `db:migrate` es la acción que
confirma los cambios. La API escucha en `http://127.0.0.1:8080` por defecto (`API_PUERTO`).

## Docker

El contenedor incluye SPA y API, pero no una base: utiliza Azure SQL. Los adjuntos se
montan en `/datos/adjuntos`.

```powershell
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 api
```

Las migraciones no se ejecutan al arrancar:

```powershell
docker compose run --rm api node dist-api/api/migrar.js --dry-run
docker compose run --rm api node dist-api/api/migrar.js
```

No activar `trustServerCertificate` ante un error TLS. Corregir el host, certificado o
firewall. Si el esquema ya existe sin ledger, detenerse y revisar su origen.
