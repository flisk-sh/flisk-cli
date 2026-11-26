# Raccourcis clavier de `flisk ui`

> Ceci est la traduction française de [ui.md](ui.md). En cas de différence, la version anglaise prévaut.

`flisk ui` ouvre un tableau de bord interactif dans le terminal pour la stack en cours d'exécution. Les touches ci-dessous sont celles que le tableau de bord gère. <!-- spellchecker:disable-line -->

| Touche | Action |
|---|---|
| `1`–`5` | Aller à Overview, Resources, Events, Files, Config |
| `Tab` / `Shift+Tab` | Onglet suivant / précédent |
| `↑`/`↓` ou `j`/`k` | Déplacer la surbrillance |
| `g` / `G`, `Home` / `End` | Premier / dernier élément |
| `PgUp` / `PgDn` | Déplacer d'une page |
| `Enter` ou `Space` | Ouvrir la stack, le service ou le fichier en surbrillance |
| `Esc` | Revenir d'un niveau (fichier → service → stack). Sur l'écran le plus haut, affiche seulement "Press q to quit" | <!-- spellchecker:disable-line -->
| `/` | Rechercher. `Enter` conserve le filtre, `Esc` l'efface |
| `r` | Rafraîchir. Dans Events, recharge les événements |
| `e` | Basculer entre les services activés seulement et tous les services |
| `t` | Activer/désactiver les info-bulles du pied de page |
| `m` | Activer/désactiver la prise en charge de la souris |
| `?` | Afficher le panneau d'aide. N'importe quelle touche le ferme |
| `q` | Quitter |

## Options

- `--no-animations` : désactive les animations (texte de spinner statique).
- `--high-contrast` : active les couleurs à fort contraste.

## Mode ASCII

`flisk ui` passe de lui-même en ASCII simple quand l'environnement demande de ne pas utiliser de couleurs : <!-- spellchecker:disable-line -->

- `NO_COLOR` est définie, même avec une valeur vide, ou
- `TERM` commence par `dumb` (quelle que soit la casse).

Il utilise aussi les symboles ASCII ci-dessous, tout en conservant les couleurs, quand `TERM` vaut `linux` ou quand la première variable définie parmi `LC_ALL`, `LC_CTYPE` et `LANG` ne nomme pas UTF-8 (par exemple `LANG=C`). <!-- spellchecker:disable-line -->

En mode ASCII, il n'y a ni couleurs ni encadrés autour des panneaux, et `--high-contrast` est sans effet. Tout ce qui était un symbole devient du texte : <!-- spellchecker:disable-line -->

| Où | Normal | ASCII |
|---|---|---|
| Indicateur de bannière et de ligne sélectionnée | `▓▒░` (fin : `░▒▓`) | `>>>` (fin : `<<<`) |
| Séparateur entre les éléments du pied de page | ` │ ` | ` \| ` |
| Lignes horizontales | `─` | `-` |
| Titre de section | `┌─ Resources ─` | `[ Resources ]` |
| Titre de stack et de service | `┌─ NAME ─┐` | `--- NAME ---` |
| État : healthy, in progress, failed, unknown | `✓` `○` `✗` `?` | `[+]` `[~]` `[x]` `[?]` |
| Services sous une stack | `├─ ` et `└─ ` | `\|- ` et `L- ` |
| Dossier ouvert, fermé (onglet Files) | `▼` `▶` | `[-]` `[+]` |
| Types de fichier : Docker, Tilt, config, Prisma, généré, autre | emoji | `[D]` `[T]` `[C]` `[P]` `[G]` `[?]` |
| Compteurs de la vue d'ensemble : dans une stack, sans stack | `●` `○` | `[+]` `-` | <!-- spellchecker:disable-line -->
| Bascules du pied de page | `🖱️` `ℹ️` `✓ enabled` (ou `✓ all`) | `Mouse` `Info` `[+] enabled` (ou `[+] all`) |
| Préfixe d'info-bulle | `ℹ ` | `[i] ` | <!-- spellchecker:disable-line -->
| Spinner de chargement | points braille | `-` `/` `\|` `\` |
| Marque d'erreur, marque d'état vide | `✗` `◉` | `[x]` `[*]` |
| Flèches dans les indications de touches | `↑/↓` | `UP/DOWN` |

Pour l'essayer, lancez `NO_COLOR=1 flisk ui`. Le même comportement est décrit dans [`cli/README.md`](../cli/README.md).

## Onglet Events

L'onglet Events lit les données de Tilt, donc Tilt doit être en cours d'exécution. Sinon, l'onglet affiche "Tilt is not running or its UI is unreachable" et suggère `flisk up`. Appuyez sur `r` dans cet onglet pour réessayer. <!-- spellchecker:disable-line -->
