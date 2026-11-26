# A real Spring Initializr project (Maven, Java, Spring Web + Actuator, no database), downloaded at build time.
FROM maven:3-eclipse-temurin-21@sha256:3e18d95a0a49d18aa5b075e5ee3c30a98078c382850467dcd4caa49bb7dc4038 AS build
WORKDIR /work
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends curl unzip >/dev/null \
 && curl -fsSL https://start.spring.io/starter.zip \
      -d type=maven-project -d language=java -d name=app -d artifactId=app -d groupId=dev.flisk \
      -d dependencies=web,actuator -o starter.zip \
 && unzip -q starter.zip && rm starter.zip
RUN mvn -q -B -DskipTests package && ls target/*.jar

FROM eclipse-temurin:21-jre@sha256:d77e090ae1f6970c047b443c6f0a6c1358b0426d44432bb5a7753408cd43de0d
WORKDIR /app
COPY --from=build /work/target/app-*.jar /app/app.jar
# Ubuntu-based Temurin images already have an `ubuntu` user at uid 1000, so use 1001.
RUN groupadd --gid 1001 app && useradd --uid 1001 --gid app --no-create-home app
USER app
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD bash -c "exec 3<>/dev/tcp/127.0.0.1/${PORT:-8080}" || exit 1
# Spring binds all interfaces by default; the port comes from SERVER_PORT, which we set from Flisk's PORT.
CMD ["sh", "-c", "SERVER_PORT=${PORT:-8080} exec java -jar /app/app.jar"]
