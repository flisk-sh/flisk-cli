# A real cookiecutter-django project (no Docker, no Celery, no mail catcher): the generator runs at build time.
FROM python:3.12@sha256:5411fa1b302c43f510324381162b5f5d0d93b9ee2af538f09d944f0d290ee3cb
ENV PYTHONUNBUFFERED=1
COPY --from=ghcr.io/astral-sh/uv:0.9.26 /uv /uvx /bin/
COPY requirements.txt ./
RUN pip install --no-cache-dir --require-hashes -r requirements.txt
WORKDIR /work
RUN cookiecutter gh:cookiecutter/cookiecutter-django --no-input project_name="Flisk Demo" project_slug=app \
    use_docker=n use_celery=n use_mailpit=n frontend_pipeline=None
WORKDIR /work/app
RUN uv sync --frozen
ENV PATH="/work/app/.venv/bin:$PATH"
COPY flisk_settings.py config/settings/flisk.py
COPY ensure_db.py entrypoint.sh /
RUN groupadd --gid 1000 app && useradd --uid 1000 --gid app --no-create-home app
RUN chown -R app:app /work
USER app
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD python -c "import os,socket; socket.create_connection(('127.0.0.1', int(os.environ.get('PORT','8000'))), 3)"
CMD ["sh", "/entrypoint.sh"]
