#!/usr/bin/env bash
# =============================================================================
# Arranque del stack. Lo llama la tarea del Programador de tareas de Windows al
# encender la máquina, y sirve igual para levantarlo a mano.
#
# El problema que resuelve: el Programador dispara la tarea muy temprano en el arranque.
# La distro de WSL recién se está prendiendo y el demonio de Docker todavía no acepta
# conexiones, así que un `docker compose up -d` a secas falla y el servidor se queda abajo
# hasta que alguien lo nota. Este script espera a que el demonio conteste antes de intentar.
#
# Uso:
#   /srv/controlhorario/docker/arranque/arrancar.sh
#
# Deja el registro en /var/log/controlhorario-arranque.log (y en stdout).
# =============================================================================

set -uo pipefail

PROYECTO="${PROYECTO:-/srv/controlhorario}"
ESPERA_MAX="${ESPERA_MAX:-180}"
REGISTRO="${REGISTRO:-/var/log/controlhorario-arranque.log}"

log() {
  local linea
  linea="$(date '+%Y-%m-%d %H:%M:%S%z')  $*"
  echo "$linea"
  echo "$linea" >> "$REGISTRO" 2>/dev/null || true
}

log "=== arranque de ControlHorario ==="

if [ ! -f "$PROYECTO/docker-compose.yml" ]; then
  log "ERROR: no encuentro $PROYECTO/docker-compose.yml. Revisá la variable PROYECTO."
  exit 1
fi

# systemd tarda un poco en llegar a docker.service. Si systemd no está habilitado en
# /etc/wsl.conf esto no existe, y el arranque manual de abajo es el que salva la situación.
if command -v systemctl > /dev/null 2>&1; then
  systemctl start docker 2>/dev/null || true
fi

log "esperando al demonio de Docker (hasta ${ESPERA_MAX}s)..."
esperado=0
until docker info > /dev/null 2>&1; do
  if [ "$esperado" -ge "$ESPERA_MAX" ]; then
    log "ERROR: el demonio de Docker no respondió en ${ESPERA_MAX}s."
    log "       Probá a mano:  sudo systemctl status docker"
    exit 1
  fi
  # Un empujón por si systemd no lo levantó solo.
  if [ "$esperado" -eq 30 ] || [ "$esperado" -eq 90 ]; then
    log "sigue sin responder; reintento arrancar docker.service"
    sudo systemctl start docker 2>/dev/null || sudo service docker start 2>/dev/null || true
  fi
  sleep 3
  esperado=$((esperado + 3))
done
log "el demonio respondió después de ${esperado}s"

cd "$PROYECTO" || exit 1

if [ ! -f .env ]; then
  log "ERROR: falta $PROYECTO/.env. Copiá .env.example y completalo (docs/stack-local.md)."
  exit 1
fi

log "docker compose up -d"
if docker compose up -d 2>&1 | tee -a "$REGISTRO"; then
  log "stack levantado"
else
  log "ERROR: docker compose up -d falló. Mirá 'docker compose logs'."
  exit 1
fi

# No es un healthcheck completo: es la confirmación de que hay algo escuchando antes de
# dar el arranque por bueno. El healthcheck real lo hace Docker cada 30 s.
log "esperando a que la API conteste..."
for _ in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8080/health > /dev/null 2>&1; then
    log "OK: /health contesta. ControlHorario está arriba."
    exit 0
  fi
  sleep 3
done

log "AVISO: el stack está levantado pero /health todavía no contesta."
log "       Revisá:  docker compose ps  y  docker compose logs --tail=100 api"
exit 0
