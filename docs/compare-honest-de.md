# Flisk und Ihre vorhandenen Werkzeuge

> Diese Seite ist eine deutsche Übersetzung von [compare-honest.md](compare-honest.md). <!-- spellchecker:disable-line -->

Die Flisk CLI verwandelt eine `service.json` pro Dienst in einen lokalen Docker-Stack, wobei Tilt (das lokale Entwicklungswerkzeug) die Dienste beobachtet und Container live aktualisiert, während Sie programmieren. Es ist weder ein Deploy-Tool noch ein Compose-Ersatz. Die Produktion bleibt bei Helm. Einen ausführlichen technischen Vergleich mit Docker Compose, reinem Tilt, Skaffold, DevSpace und kind/minikube finden Sie unter [Flisk im Vergleich mit alternativen Entwicklungswerkzeugen](comparison.md). <!-- spellchecker:disable-line -->

## Compose

Compose ist besser für 2–3 Dienste, die Sie bereits geschrieben haben. Flisk lohnt sich, wenn Sie Scaffolding, ein selektives `flisk up <stack>` und ein erzeugtes Tiltfile für eine größere Dienstmenge möchten. <!-- spellchecker:disable-line -->

## Tilt

Flisk schreibt das Tiltfile, das Tilts Service-Watcher und die Live-Update-Schleife konfiguriert. Wenn Sie bereits ein Tiltfile pflegen und es Ihrem Workflow dient, bleiben Sie bei Tilt. <!-- spellchecker:disable-line -->

## Skaffold, Garden und DevSpace

Diese Werkzeuge zielen auf ein Cluster. Flisk nicht; es führt eine lokale Docker + Tilt-Entwicklungsschleife aus. Das Produktions-Deployment bleibt in Ihrem Helm- oder Kubernetes-Workflow. <!-- spellchecker:disable-line -->

## KI-Agenten-Frameworks und Workflow-Engines (libfx, LangGraph, Mastra, Vercel Workflows, Temporal)

Wenn Entwickler fragen, wie Flisk im Vergleich zu modernen Agenten-Laufzeiten und Durability-Engines abschneidet:

**Flisk implementiert durable execution nicht selbst; es hostet sie.** <!-- spellchecker:disable-line -->

Flisk ist die lokale Laufzeit und der Topologie-Orchestrator für Agenten*systeme*. Werkzeuge wie `libfx`, LangGraph, Mastra, Vercel Workflows und Temporal definieren, wie Schritte laufen, wiederholt werden oder Checkpoints setzen. Flisk definiert, wie der Agentenprozess, sein Checkpoint-Volume, seine MCP-Tool-Server, Datenbanken, Queues und Gateways lokal zusammenlaufen. <!-- spellchecker:disable-line -->

### Wer wofür zuständig ist <!-- spellchecker:disable-line -->

| Fähigkeit | Agenten-Framework / Workflow-Engine (`libfx`, LangGraph, Mastra, Vercel Workflows, Temporal) | Lokaler Orchestrator (Flisk CLI) |
| --- | --- | --- |
| **Agentenlogik & Modellaufrufe** | Besitzt (Prompts, Tool-Aufrufe, Turn-Schleife) | Neutral (stellt ein anbieterunabhängiges Runner-Gerüst bereit) | <!-- spellchecker:disable-line -->
| **Dauerhaftigkeit & Checkpoints** | Besitzt Ausführungszustand & Schritt-Wiederholungen | Stellt persistente benannte Volumes / Datenbankinstanzen bereit | <!-- spellchecker:disable-line -->
| **Session-Routing** | Definiert Session-IDs | Traefik routet Sticky-Session-Header (`x-session-id`) | <!-- spellchecker:disable-line -->
| **Tool-Ausführung (MCP)** | Ruft MCP-Server auf | Erzeugt und hostet `--type mcp`-Ressourcen mit Traefik-Routing |
| **Lokale Infrastruktur** | Keine (erwartet URLs/Zugangsdaten in der Umgebung) | Stellt Postgres, NATS, Traefik bereit und verdrahtet `@ref()`-Umgebungsvariablen | <!-- spellchecker:disable-line -->
| **Hot-Reload & Dev-Schleife** | Verlässt sich auf den Runner | Tilt synct unterstützte Code-Änderungen ohne vollständige Builds in die Container (Prozess-Reloader oder Image-Rebuilds übernehmen andere Änderungen) | <!-- spellchecker:disable-line -->
| **Lebenszyklus & Shutdown** | Implementiert Drain-Handler | Sendet SIGTERM und steuert den Containerstart über den Docker-Healthcheck (`/health`) |

Wenn Sie `libfx` oder LangGraph nutzen, brauchen Sie trotzdem eine lokale Datenbank, persistente Checkpoint-Volumes über Neustarts hinweg und ein Gateway, damit andere Dienste den Agenten erreichen. Flisk ist der Ort, an dem diese Teile lokal laufen. <!-- spellchecker:disable-line -->

## Bekannte Grenzen

- Die Community ist klein. <!-- spellchecker:disable-line -->
- Die eingebauten Generatoren sind TypeScript-first; bringen Sie Ihre eigenen Go-, Java- oder Python-Dienste mit. <!-- spellchecker:disable-line -->
- Die 100-Dienste-Zahl ist eine Fixture-Benchmark aus generierten `/health`-Stubs, keine Anwendungslast. Siehe [das Claims-Register](claims.md) und die [Benchmark-Notizen](benchmarks/scale-bench.md). <!-- spellchecker:disable-line -->
- Unter nativem Windows laufen nur Projekte mit lokalen Prozessen und `flisk demo`; ein Docker-Stack braucht Ubuntu auf WSL2. <!-- spellchecker:disable-line -->
- Nur lokale Entwicklung. Flisk deployt nicht; die Produktion bleibt bei Helm, Argo CD oder Kustomize, und es ersetzt kein CI/CD. <!-- spellchecker:disable-line -->
- Docker und Tilt werden benötigt. Wenn Ihr Team bereits ein ausgereiftes Compose-, DevContainer- oder lokales Kubernetes-Setup hat, kann der Mehrwert klein sein. <!-- spellchecker:disable-line -->
- Mehrere Instanzen eines Dienstes lokal laufen zu lassen wird noch nicht unterstützt (Ports, Identität und Service-Discovery sind offene Designfragen). <!-- spellchecker:disable-line -->
- CPU- und RAM-Verbrauch eines kleinen Stacks auf einem 16-GB-Laptop wurden nicht benchmarkt; siehe die [Benchmark-Notizen](benchmarks/scale-bench.md) für das, was gemessen wird.
- Das Projekt ist jung, daher sind Dokumentation, Beispiele und Community-Wissen begrenzt. <!-- spellchecker:disable-line -->
- Der Shutdown sendet SIGTERM, aber das Abarbeiten laufender Arbeit (Queues, Hintergrundjobs) liegt in der Verantwortung des Dienstes; ein gesunder Container kann trotzdem Arbeit verlieren, wenn er SIGTERM ignoriert. <!-- spellchecker:disable-line -->
- Umgebungsvariablen werden auf das `FLISK_`-Präfix umgestellt. Das alte Präfix funktioniert derzeit noch (`FLISK_X` gewinnt); Variablen mit dem alten Präfix geben einen Deprecation-Hinweis aus. Setzen Sie `FLISK_QUIET_DEPRECATIONS=1`, um ihn in CI zu unterdrücken. <!-- spellchecker:disable-line -->
