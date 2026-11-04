#!/bin/sh
set -eu

python manage.py migrate --noinput
python manage.py import_maps
python manage.py bootstrap_superuser
python manage.py collectstatic --noinput

exec "$@"
