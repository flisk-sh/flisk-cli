# A real Slim skeleton from `composer create-project` (PHP, no external database).
FROM composer:2@sha256:50ea4d33fdcde1adb0f045547295faa1548b33872e5f789dae5b02ce2fb5de93 AS build
WORKDIR /work
RUN composer create-project slim/slim-skeleton app --no-interaction --prefer-dist

FROM php:8.4-cli@sha256:6b13a8678b38ca38e4e3950be57b664ed8c8706131a0586111f68792aede4c58
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends unzip git >/dev/null && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /work/app /app
RUN groupadd --gid 1000 app && useradd --uid 1000 --gid app --no-create-home app && chown -R app:app .
USER app
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD php -r "exit(@fsockopen('127.0.0.1', ${PORT:-8080}) ? 0 : 1);"
# The skeleton's front controller is public/index.php. The built-in server must listen beyond loopback and on Flisk's port.
CMD ["sh", "-c", "php -S 0.0.0.0:${PORT:-8080} -t public"]
