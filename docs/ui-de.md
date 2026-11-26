# Tastenbelegung von `flisk ui`

> Dies ist die deutsche Übersetzung von [ui.md](ui.md). Bei Abweichungen gilt die englische Version. <!-- spellchecker:disable-line -->

`flisk ui` öffnet ein interaktives Terminal-Dashboard für den laufenden Stack. Die folgenden Tasten sind die, die das Dashboard verarbeitet. <!-- spellchecker:disable-line -->

| Taste | Wirkung |
|---|---|
| `1`–`5` | Zu Overview, Resources, Events, Files, Config springen |
| `Tab` / `Shift+Tab` | Nächster / vorheriger Tab |
| `↑`/`↓` oder `j`/`k` | Markierung bewegen | <!-- spellchecker:disable-line -->
| `g` / `G`, `Home` / `End` | Erstes / letztes Element |
| `PgUp` / `PgDn` | Eine Seite bewegen |
| `Enter` oder `Space` | Markierten Stack, Service oder Datei öffnen | <!-- spellchecker:disable-line -->
| `Esc` | Eine Ebene zurück (Datei → Service → Stack). Auf dem obersten Bildschirm zeigt es nur "Press q to quit" |
| `/` | Suchen. `Enter` behält den Filter, `Esc` löscht ihn |
| `r` | Aktualisieren. In Events lädt es die Ereignisse neu |
| `e` | Zwischen nur aktivierten und allen Services umschalten |
| `t` | Tooltips in der Fußzeile umschalten |
| `m` | Mausunterstützung umschalten |
| `?` | Hilfefenster anzeigen. Beliebige Taste schließt es |
| `q` | Beenden |

## Flags

- `--no-animations`: Animationen deaktivieren (statischer Spinner-Text).
- `--high-contrast`: Farben mit hohem Kontrast aktivieren.

## ASCII-Modus

`flisk ui` wechselt von selbst zu reinem ASCII, wenn die Umgebung keine Farben verlangt:

- `NO_COLOR` ist gesetzt, auch mit leerem Wert, oder <!-- spellchecker:disable-line -->
- `TERM` beginnt mit `dumb` (Groß-/Kleinschreibung egal). <!-- spellchecker:disable-line -->

Es verwendet die ASCII-Symbole unten auch dann, behält aber die Farben, wenn `TERM` `linux` ist oder die erste gesetzte Variable von `LC_ALL`, `LC_CTYPE` und `LANG` kein UTF-8 nennt (zum Beispiel `LANG=C`). <!-- spellchecker:disable-line -->

Im ASCII-Modus gibt es keine Farben und keine Rahmen um die Panels, und `--high-contrast` hat keine Wirkung. Alles, was ein Symbol war, wird zu Text: <!-- spellchecker:disable-line -->

| Wo | Normal | ASCII |
|---|---|---|
| Banner und Markierung der gewählten Zeile | `▓▒░` (Ende: `░▒▓`) | `>>>` (Ende: `<<<`) | <!-- spellchecker:disable-line -->
| Trenner zwischen Fußzeilen-Elementen | ` │ ` | ` \| ` |
| Horizontale Linien | `─` | `-` | <!-- spellchecker:disable-line -->
| Abschnittsüberschrift | `┌─ Resources ─` | `[ Resources ]` |
| Stack- und Service-Titel | `┌─ NAME ─┐` | `--- NAME ---` | <!-- spellchecker:disable-line -->
| Status: healthy, in progress, failed, unknown | `✓` `○` `✗` `?` | `[+]` `[~]` `[x]` `[?]` |
| Services unter einem Stack | `├─ ` und `└─ ` | `\|- ` und `L- ` | <!-- spellchecker:disable-line -->
| Ordner offen, geschlossen (Tab Files) | `▼` `▶` | `[-]` `[+]` | <!-- spellchecker:disable-line -->
| Dateitypen: Docker, Tilt, Config, Prisma, generiert, sonstige | Emoji | `[D]` `[T]` `[C]` `[P]` `[G]` `[?]` |
| Übersichts-Zähler: in einem Stack, kein Stack | `●` `○` | `[+]` `-` |
| Fußzeilen-Schalter | `🖱️` `ℹ️` `✓ enabled` (oder `✓ all`) | `Mouse` `Info` `[+] enabled` (oder `[+] all`) | <!-- spellchecker:disable-line -->
| Tooltip-Präfix | `ℹ ` | `[i] ` |
| Lade-Spinner | Braille-Punkte | `-` `/` `\|` `\` |
| Fehlerzeichen, Leerzustand-Zeichen | `✗` `◉` | `[x]` `[*]` |
| Pfeiltasten in Tastenhinweisen | `↑/↓` | `UP/DOWN` |

Zum Ausprobieren `NO_COLOR=1 flisk ui` ausführen. Dasselbe Verhalten beschreibt [`cli/README.md`](../cli/README.md).

## Tab Events

Der Tab Events liest aus Tilt, also muss Tilt laufen. Wenn nicht, zeigt der Tab "Tilt is not running or its UI is unreachable" und schlägt `flisk up` vor. In diesem Tab `r` drücken, um es erneut zu versuchen. <!-- spellchecker:disable-line -->
