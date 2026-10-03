#!/bin/sh
# Zero-touch production deploy, run on the VPS by CI after every push to `main`.
# Pulls the new images, migrates, restarts, health-checks, and rolls back to the
# previous images automatically if the new release doesn't come up healthy.
#
# Usage: infra/deploy.sh <image-tag>     (run from the app directory, e.g. /srv/edu)
set -eu

TAG="${1:?image tag required}"
COMPOSE="docker compose -f infra/docker-compose.yml --env-file .env"
STATE=.deploy
mkdir -p "$STATE"
PREVIOUS="$(cat "$STATE/current" 2>/dev/null || true)"
DOMAIN="$(grep -E '^APP_DOMAIN=' .env | cut -d= -f2- || true)"
HEALTH_URL="https://${DOMAIN:-edu.vishnugandarapu.in}/api/health"

release() {
  export EDU_IMAGE_TAG="$1"
  $COMPOSE pull web realtime worker
  # Migrations are forward-only and run before the new code starts serving.
  $COMPOSE run --rm worker pnpm db:migrate
  $COMPOSE up -d --remove-orphans
}

# Healthy = the public health endpoint answers and no container is unhealthy or still starting.
healthy() {
  i=0
  while [ "$i" -lt 36 ]; do
    if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1 &&
      ! $COMPOSE ps --format '{{.Health}}' | grep -Eq 'unhealthy|starting'; then
      return 0
    fi
    i=$((i + 1))
    sleep 5
  done
  return 1
}

echo "Deploying $TAG (previous: ${PREVIOUS:-none})"
release "$TAG"
if healthy; then
  echo "$TAG" >"$STATE/current"
  [ -n "$PREVIOUS" ] && echo "$PREVIOUS" >"$STATE/previous"
  docker image prune -f >/dev/null
  echo "Deployed $TAG"
  exit 0
fi

echo "Release $TAG is unhealthy" >&2
if [ -n "$PREVIOUS" ]; then
  echo "Rolling back to $PREVIOUS" >&2
  export EDU_IMAGE_TAG="$PREVIOUS"
  $COMPOSE pull web realtime worker
  $COMPOSE up -d --remove-orphans
  healthy && echo "Rolled back to $PREVIOUS" >&2
fi
exit 1
