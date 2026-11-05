#!/bin/sh
set -eu

# The web process owns migrations; workers retry until the schema is ready.
if [ "${1:-}" = "python" ] && [ "${2:-}" = "manage.py" ] && [ "${3:-}" = "run_route_notifications" ]; then
    exec "$@"
fi

python manage.py migrate --noinput
python manage.py import_maps
python manage.py bootstrap_superuser
python manage.py collectstatic --noinput

case "${RUN_ROUTE_NOTIFICATIONS:-False}" in
    True|true|1|yes|on)
        exec python /app/docker/run_web_with_notifications.py "$@"
        ;;
esac

exec "$@"
