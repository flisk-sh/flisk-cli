# Flisk et vos outils existants

> Ceci est la traduction française de [compare-honest.md](compare-honest.md). En cas de différence, la version anglaise prévaut.

Flisk CLI transforme un `service.json` par service en une stack Docker locale, avec Tilt (l'outil de développement local) qui surveille les services et met à jour les conteneurs en direct pendant que vous codez. Ce n'est ni un outil de déploiement ni un remplaçant de Compose. La production reste sur Helm. Pour une comparaison technique approfondie incluant Docker Compose, Tilt seul, Skaffold, DevSpace et kind/minikube, voir [comparer Flisk avec les outils de dev alternatifs](comparison.md). <!-- spellchecker:disable-line -->

## Compose

Compose convient mieux à 2 à 3 services que vous avez déjà écrits. Flisk est utile quand vous voulez du scaffolding, un `flisk up <stack>` sélectif et un Tiltfile généré pour un ensemble de services plus grand. <!-- spellchecker:disable-line -->

## Tilt

Flisk écrit le Tiltfile qui configure la surveillance des services et la boucle de mise à jour en direct de Tilt. Si vous maintenez déjà un Tiltfile et qu'il convient à votre façon de travailler, restez sur Tilt. <!-- spellchecker:disable-line -->

## Skaffold, Garden et DevSpace

Ces outils ciblent un cluster. Flisk non ; il exécute une boucle de développement locale Docker + Tilt. Le déploiement en production reste dans votre workflow Helm ou Kubernetes. <!-- spellchecker:disable-line -->

## Frameworks d'agents IA et moteurs de workflow (libfx, LangGraph, Mastra, Vercel Workflows, Temporal) <!-- spellchecker:disable-line -->

Quand les développeurs demandent comment Flisk se compare aux runtimes d'agents modernes et aux moteurs de durabilité : <!-- spellchecker:disable-line -->

**Flisk n'implémente pas l'exécution durable ; il l'héberge.**

Flisk est le runtime local et l'orchestrateur de topologie pour les *systèmes* d'agents. Des outils comme `libfx`, LangGraph, Mastra, Vercel Workflows et Temporal définissent comment les étapes s'exécutent, se relancent ou enregistrent des checkpoints. Flisk définit comment le processus d'agent, son volume de checkpoints, ses serveurs d'outils MCP, ses bases de données, ses files de messages et ses passerelles s'exécutent ensemble en local. <!-- spellchecker:disable-line -->

### Qui gère quoi

| Capacité | Framework d'agent / moteur de workflow (`libfx`, LangGraph, Mastra, Vercel Workflows, Temporal) | Orchestrateur local (Flisk CLI) | <!-- spellchecker:disable-line -->
| --- | --- | --- |
| **Logique d'agent et appels au modèle** | Gère (prompts, invocations d'outils, boucle de tour) | Neutre (scaffold un runner indépendant du fournisseur) |
| **Durabilité et checkpoints** | Gère l'état d'exécution et les relectures d'étapes | Fournit des volumes nommés persistants / des instances de base de données |
| **Routage de session** | Définit les ID de session | Traefik route les en-têtes de session sticky (`x-session-id`) |
| **Exécution d'outils (MCP)** | Appelle les serveurs MCP | Scaffold et héberge des ressources `--type mcp` avec le routage Traefik | <!-- spellchecker:disable-line -->
| **Infrastructure locale** | Aucune (attend des URL/identifiants en env) | Provisionne Postgres, NATS, Traefik, connecte l'env `@ref()` | <!-- spellchecker:disable-line -->
| **Rechargement à chaud et boucle de dev** | Dépend du runner | Tilt synchronise les changements de code pris en charge dans les conteneurs sans rebuild complet (les reloaders de processus ou les rebuilds d'images gèrent les autres changements) | <!-- spellchecker:disable-line -->
| **Cycle de vie et arrêt** | Implémente les gestionnaires de drain | Envoie SIGTERM et conditionne le démarrage des conteneurs via le health check Docker (`/health`) | <!-- spellchecker:disable-line -->

Si vous utilisez `libfx` ou LangGraph, il vous faut quand même une base de données locale, des volumes de checkpoints persistants entre les redémarrages et une passerelle pour que les autres services atteignent l'agent. Flisk est l'endroit où ces pièces s'exécutent en local.

## Limites connues

- La communauté est petite.
- Les générateurs intégrés sont d'abord TypeScript ; apportez vos propres services Go, Java ou Python. <!-- spellchecker:disable-line -->
- Le chiffre de 100 services est un banc d'essai sur fixture de stubs `/health` générés, pas une charge applicative. Voir [le registre des affirmations](claims.md) et les [notes de bench](benchmarks/scale-bench.md). <!-- spellchecker:disable-line -->
- Sous Windows natif, seuls les projets en processus locaux et `flisk demo` fonctionnent ; une stack Docker nécessite Ubuntu sur WSL2. <!-- spellchecker:disable-line -->
- Développement local uniquement. Flisk ne déploie pas ; la production reste sur Helm, Argo CD ou Kustomize, et il ne remplace pas le CI/CD. <!-- spellchecker:disable-line -->
- Docker et Tilt sont requis. Si votre équipe a déjà une configuration Compose, DevContainer ou Kubernetes local mature, la valeur ajoutée peut être faible.
- Exécuter plusieurs instances d'un même service en local n'est pas encore pris en charge (ports, identité et découverte de services sont des questions de conception ouvertes). <!-- spellchecker:disable-line -->
- L'utilisation CPU et RAM d'une petite stack sur un portable de 16 Go n'a pas été mesurée ; voir les [notes de bench](benchmarks/scale-bench.md) pour ce qui est mesuré. <!-- spellchecker:disable-line -->
- Le projet est jeune, donc la documentation, les exemples et la connaissance communautaire sont limités. <!-- spellchecker:disable-line -->
- L'arrêt envoie SIGTERM, mais drainer le travail en cours (files de messages, tâches de fond) relève de la responsabilité du service ; un conteneur sain peut quand même perdre du travail s'il ignore SIGTERM. <!-- spellchecker:disable-line -->
- Les variables d'environnement passent du préfixe `FLISK_` à `FLISK_`. Les deux fonctionnent aujourd'hui (`FLISK_X` gagne) ; `FLISK_X` affiche un avis de dépréciation. Définissez `FLISK_QUIET_DEPRECATIONS=1` pour le faire taire en CI. <!-- spellchecker:disable-line -->
