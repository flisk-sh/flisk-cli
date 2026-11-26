# A real Micronaut project from Micronaut Launch (launch.micronaut.io: Maven, Java 25, Management), downloaded at build time.
# Java 25 is needed both to build and to run: the current Micronaut libraries and Maven plugin are compiled for Java 25
# (class file version 69), and a Java 21 JRE fails with UnsupportedClassVersionError.
FROM eclipse-temurin:25-jdk@sha256:ce2ef9d2d67a68de5e196d4de9d743327c44a10b57fe02ec39f572c652cacfd3 AS build
WORKDIR /work
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends curl unzip >/dev/null \
 && curl -fsSL "https://launch.micronaut.io/create/default/dev.flisk.app?lang=JAVA&build=MAVEN&test=JUNIT&javaVersion=JDK_25&features=management" -o starter.zip \
 && unzip -q starter.zip && rm starter.zip
WORKDIR /work/app
# The project's own Maven wrapper (the generator pins the Maven version).
RUN ./mvnw -q -B -DskipTests package && ls target/*.jar

FROM eclipse-temurin:25-jre@sha256:4ed132f6832e9804b123e89a849a7b4502756ae64a4ee08ebab939d9d5d0a9fa
WORKDIR /app
COPY --from=build /work/app/target/app-*.jar /app/app.jar
# Ubuntu-based Temurin images already have an `ubuntu` user at uid 1000, so use 1001.
RUN groupadd --gid 1001 app && useradd --uid 1001 --gid app --no-create-home app
USER app
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD bash -c "exec 3<>/dev/tcp/127.0.0.1/${PORT:-8080}" || exit 1
# Micronaut's Netty server listens on all interfaces; the port comes from MICRONAUT_SERVER_PORT, set from Flisk's PORT.
CMD ["sh", "-c", "MICRONAUT_SERVER_PORT=${PORT:-8080} exec java -jar /app/app.jar"]
