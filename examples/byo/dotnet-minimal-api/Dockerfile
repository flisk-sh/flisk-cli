# A real `dotnet new web` project (ASP.NET Core minimal API): the template is generated at build time.
FROM mcr.microsoft.com/dotnet/sdk:10.0@sha256:2b1e13a22e46b55117f9cdb4b38e73172de08a30370166c8227d06cdaff82473 AS build
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
WORKDIR /src
RUN dotnet new web --name App --output . --no-restore \
 && dotnet publish -c Release -o /out
FROM mcr.microsoft.com/dotnet/aspnet:10.0@sha256:0bfa6494dead26049c1e0d6c9dc890be79259cb7300f5f23ae1df1cdac3da7df
WORKDIR /app
COPY --from=build /out .
RUN groupadd --gid 1000 app && useradd --uid 1000 --gid app --no-create-home app
USER app
# Kestrel must listen beyond loopback (0.0.0.0) and on the port Flisk assigns.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 CMD bash -c "exec 3<>/dev/tcp/127.0.0.1/${PORT:-8080}" || exit 1
CMD ["sh", "-c", "ASPNETCORE_URLS=http://0.0.0.0:${PORT:-8080} exec dotnet App.dll"]
