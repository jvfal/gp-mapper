FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN --mount=type=secret,id=pip_ca \
    --mount=type=secret,id=pip_config \
    if [ -f /run/secrets/pip_config ]; then \
        export PIP_CONFIG_FILE=/run/secrets/pip_config; \
    fi; \
    if [ -f /run/secrets/pip_ca ]; then \
        export PIP_CERT=/run/secrets/pip_ca; \
    fi; \
    pip install --no-cache-dir -r requirements.txt

RUN groupadd --system app && useradd --system --gid app --home-dir /app app
COPY --chown=app:app . .
RUN mkdir -p /app/staticfiles && chown app:app /app/staticfiles

USER app
EXPOSE 8000

ENTRYPOINT ["/bin/sh", "/app/docker/entrypoint.sh"]
CMD ["uvicorn", "config.asgi:application", "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"]
