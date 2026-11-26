# A real Quarkus project from the Quarkus generator (code.quarkus.io: Maven, REST + SmallRye Health, no database),
# downloaded at build time.
FROM maven:3-eclipse-temurin-21@sha256:3e18d95a0a49d18aa5b075e5ee3c30a98078c382850467dcd4caa49bb7dc4038 AS build
WORKDIR /work
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends curl unzip >/dev/null \
 && curl -fsSL "https://code.quarkus.io/d?g=dev.flisk&a=app&b=MAVEN&e=rest&e=smallrye-health&nc=true" -o starter.zip \
 && unzip -q starter.zip && rm starter.zip && ls
WORKDIR /work/app
RUN mvn -q -B -DskipTests package && ls target/quarkus-app

FROM eclipse-temurin:21-jre@sha256:d77e090ae1f6970c047b443c6f0a6c1358b0426d44432bb5a7753408cd43de0d
WORKDIR /app
COPY --from=build /work/app/target/quarkus-app/ /app/
# Ubuntu-based Temurin images already have an `ubuntu` user at uid 1000, so use 1001.
RUN groupadd --gid 1001 app && useradd --uid 1001 --gid app --no-create-home app
USER app
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD bash -c "exec 3<>/dev/tcp/127.0.0.1/${PORT:-8080}" || exit 1
# Quarkus listens on 0.0.0.0 by default in a packaged jar; the port comes from QUARKUS_HTTP_PORT, set from Flisk's PORT.
CMD ["sh", "-c", "QUARKUS_HTTP_PORT=${PORT:-8080} exec java -jar /app/quarkus-run.jar"]
