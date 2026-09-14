#!/usr/bin/env bash
# =============================================================================
# ControlHorario — respaldos programados de Postgres.
#
# Corre en el servicio `backup`, que usa LA MISMA imagen que `postgres`, así pg_dump y el
# servidor son siempre la misma versión. Un pg_dump más viejo que el servidor se niega a
# correr, y ese es el tipo de cosa que se descubre el día que hay que restaurar.
#
# Qué hace, una vez por día a la hora de RESPALDO_HORA:
#
#   1. pg_dump en formato custom (-Fc): comprimido, y restaurable tabla por tabla con
#      pg_restore. Un .sql plano no se puede restaurar parcialmente sin editarlo a mano.
#   2. Verifica el archivo recién escrito con `pg_restore -l`. Un dump que no se puede
#      listar no se va a poder restaurar, y es mejor enterarse ahora que en la urgencia.
#   3. Rota: RESPALDO_DIARIOS diarios y RESPALDO_MENSUALES mensuales (el del día 1).
#   4. Escribe /respaldos/ESTADO.txt con el resultado del último intento.
#
# Sin cron: un bucle con `sleep` no necesita un demonio más adentro del contenedor, y
# `docker compose logs backup` muestra directamente lo que pasó.
#
# LA RESTAURACIÓN ESTÁ EN docs/servidor.md, con los comandos exactos. Un respaldo que
# nadie restauró nunca no es un respaldo.
# =============================================================================

set -euo pipefail

DESTINO=/respaldos
HORA="${RESPALDO_HORA:-03:30}"
DIARIOS="${RESPALDO_DIARIOS:-14}"
MENSUALES="${RESPALDO_MENSUALES:-12}"
BASE="${PGDATABASE:?falta PGDATABASE}"

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S%z')" "$*"; }

if ! [[ "$HORA" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]]; then
  log "ERROR: RESPALDO_HORA='$HORA' no tiene formato HH:MM (24 h). No arranco."
  exit 1
fi

mkdir -p "$DESTINO"

if ! touch "$DESTINO/.escritura" 2>/dev/null; then
  log "ERROR: no puedo escribir en $DESTINO."
  log "       Revisá RESPALDOS_DIR en .env y los permisos del directorio en el host."
  exit 1
fi
rm -f "$DESTINO/.escritura"

# Segundos hasta el próximo HORA. Se recalcula en cada vuelta, así que un cambio de horario
# de verano, un reloj que se ajusta por NTP o un contenedor que arranca a las 03:31 no
# desfasan la serie: siempre apunta al próximo instante real, no a "24 h desde la anterior".
segundos_hasta_la_hora() {
  local ahora objetivo
  ahora=$(date +%s)
  objetivo=$(date -d "today $HORA" +%s)
  if [ "$objetivo" -le "$ahora" ]; then
    objetivo=$(date -d "tomorrow $HORA" +%s)
  fi
  echo $((objetivo - ahora))
}

# Deja solo los N archivos más nuevos que coincidan con el patrón.
rotar() {
  local patron="$1" conservar="$2" etiqueta="$3"
  local sobrantes
  # `ls -1t` ordena por mtime descendente; los nombres son ASCII y sin espacios, los genera
  # este mismo script, así que no hay que pelearse con nombres raros.
  sobrantes=$(ls -1t "$DESTINO"/$patron 2>/dev/null | tail -n +"$((conservar + 1))" || true)
  if [ -n "$sobrantes" ]; then
    echo "$sobrantes" | while read -r viejo; do
      log "rotación: borro $etiqueta $(basename "$viejo")"
      rm -f "$viejo"
    done
  fi
}

respaldar() {
  local marca archivo parcial dia_del_mes tamano
  marca=$(date '+%Y%m%d-%H%M%S')
  dia_del_mes=$(date '+%d')

  if [ "$dia_del_mes" = "01" ]; then
    archivo="$DESTINO/controlhorario-mensual-$marca.dump"
  else
    archivo="$DESTINO/controlhorario-diario-$marca.dump"
  fi
  parcial="$archivo.parcial"

  log "pg_dump -> $(basename "$archivo")"

  # Se escribe con extensión .parcial y se renombra al final. Si el contenedor muere a la
  # mitad, lo que queda no parece un respaldo válido: la rotación no lo cuenta y nadie va a
  # intentar restaurar medio archivo creyendo que está entero.
  if ! pg_dump --format=custom --compress=9 --no-owner --no-privileges \
        --dbname="$BASE" --file="$parcial"; then
    rm -f "$parcial"
    log "ERROR: pg_dump falló."
    printf 'ULTIMO_INTENTO=%s\nRESULTADO=ERROR_PG_DUMP\n' "$(date -Iseconds)" > "$DESTINO/ESTADO.txt"
    return 1
  fi

  # Un dump que pg_restore no puede ni listar no se va a poder restaurar. Cuesta un
  # segundo y convierte "tenemos respaldos" en "tenemos respaldos que abren".
  if ! pg_restore --list "$parcial" > /dev/null 2>&1; then
    log "ERROR: el dump se escribió pero pg_restore --list no lo puede leer. Lo descarto."
    mv "$parcial" "$archivo.CORRUPTO"
    printf 'ULTIMO_INTENTO=%s\nRESULTADO=ERROR_VERIFICACION\n' "$(date -Iseconds)" > "$DESTINO/ESTADO.txt"
    return 1
  fi

  mv "$parcial" "$archivo"
  tamano=$(stat -c %s "$archivo")
  log "OK: $(basename "$archivo") ($tamano bytes), verificado con pg_restore --list"

  rotar 'controlhorario-diario-*.dump' "$DIARIOS" diario
  rotar 'controlhorario-mensual-*.dump' "$MENSUALES" mensual

  {
    printf 'ULTIMO_INTENTO=%s\n' "$(date -Iseconds)"
    printf 'RESULTADO=OK\n'
    printf 'ARCHIVO=%s\n' "$(basename "$archivo")"
    printf 'BYTES=%s\n' "$tamano"
    printf 'CONSERVA_DIARIOS=%s\n' "$DIARIOS"
    printf 'CONSERVA_MENSUALES=%s\n' "$MENSUALES"
    printf '\n'
    printf '# La restauracion esta en docs/servidor.md, seccion "Restaurar".\n'
    printf '# Hace una restauracion de prueba UNA VEZ. Un respaldo que nadie restauro no es un respaldo.\n'
  } > "$DESTINO/ESTADO.txt"
}

log "servicio de respaldo iniciado — base=$BASE hora=$HORA diarios=$DIARIOS mensuales=$MENSUALES"
log "destino: $DESTINO (montado desde RESPALDOS_DIR en el host)"

# Uno al arrancar, para no dejar la primera noche sin respaldo y para que un error de
# permisos o de credenciales aparezca ahora y no dentro de doce horas.
respaldar || log "el respaldo inicial falló; sigo esperando la hora programada"

while true; do
  espera=$(segundos_hasta_la_hora)
  log "próximo respaldo en ${espera}s (a las $HORA)"
  sleep "$espera"
  respaldar || log "el respaldo falló; reintento en la próxima ventana"
done
