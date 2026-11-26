# Flisk: ολόκληρη η εφαρμογή σας εκτελείται στον υπολογιστή σας με μία εντολή

[![Test coverage](https://raw.githubusercontent.com/flisk-sh/flisk-cli/main/docs/assets/coverage.svg)](https://github.com/flisk-sh/flisk-cli/blob/main/docs/assets/coverage.svg)

[English](../README.md) | [简体中文](README-zh_cn.md) | [繁體中文](README-zh_tw.md) | [日本語](README-ja.md) | [한국어](README-ko.md) | [Türkçe](README-tr.md) | [Tiếng Việt](README-vi.md) | [ไทย](README-th.md) | [Deutsch](README-de.md) | [Español](README-es.md) | [Français](README-fr.md) | [Українська](README-uk.md) | [Polski](README-pl.md) | [Português (Brasil)](README-pt-BR.md) | [العربية](README-ar.md) | [فارسی](README-fa.md) | [Bahasa Indonesia](README-id.md) | [Italiano](README-it.md) | Ελληνικά | [മലയാളം](README-ml.md) | [Română](README-ro.md)

<a href="https://trendshift.io/repositories/266432?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-266432" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/266432/daily?language=Starlark" alt="flisk-sh%2Fflisk | Trendshift" width="250" height="55"/></a>
<a href="https://trendshift.io/repositories/266432?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-266432" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/266432/weekly?language=Starlark" alt="flisk-sh%2Fflisk | Trendshift" width="250" height="55"/></a>

Το Flisk είναι ένα εργαλείο γραμμής εντολών για τοπική ανάπτυξη. Εκτελεί κάθε μέρος της εφαρμογής σας (API, ιστότοπο, workers, πράκτορες AI, βάση δεδομένων) στον υπολογιστή σας πίσω από μία τοπική διεύθυνση και επαναφορτώνει ένα μέρος όταν το αποθηκεύετε. Περιγράφετε κάθε μέρος σε ένα μικρό `service.json`· το Flisk γράφει από αυτό τα Dockerfile, το αρχείο Compose και το Tiltfile και τα διατηρεί συγχρονισμένα. Δεν κάνει deploy: η παραγωγή μένει στα δικά σας εργαλεία.

Γρήγορη εκκίνηση:

```bash
npx @flisk-sh/flisk@latest demo
```

Θέλετε να διαλέξετε μόνοι σας το stack; Απαντήστε σε λίγες ερωτήσεις με τα βελάκια και το Enter:

```bash
npx @flisk-sh/flisk create
```

```bash
mkdir my-shop && cd my-shop
flisk project --yes
flisk resource orders-api --type backend --stack shop --yes
flisk resource shop-web --type frontend --stack shop --yes
flisk up shop
```

## Προαπαιτούμενα (εγκατάσταση μία φορά)

| Εργαλείο | Έκδοση | Εγκατάσταση | Χρειάζεται για |
|------|---------|---------|------------|
| **Το runtime της εφαρμογής σας** | ό,τι χρησιμοποιεί η εφαρμογή σας | Node.js, Python, Go, Bun, ... | Κάθε διαδρομή: εκτελεί τον κώδικά σας |
| **Node.js** | 22.12+ | [nodejs.org](https://nodejs.org/) | Εγκατάσταση με npm (`npm install -g @flisk-sh/flisk`) |
| **Docker** | Engine 25+, Compose 2.20.2+ | [docker.com](https://www.docker.com/products/docker-desktop/) | Μόνο για τη διαδρομή Docker + Tilt |
| **Tilt** | 0.25+ | macOS/Linux: `curl -fsSL https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.sh \| bash`. Windows: η διαδρομή Docker + Tilt τρέχει σε Ubuntu στο WSL2, οπότε χρησιμοποιήστε εκεί τη γραμμή για Linux· εγγενής εγκατάσταση σε PowerShell: `iex ((new-object net.webclient).DownloadString('https://raw.githubusercontent.com/tilt-dev/tilt/master/scripts/install.ps1'))` | Μόνο για τη διαδρομή Docker + Tilt |
| **Bun** | 1.2+ | macOS/Linux: `curl -fsSL https://bun.sh/install \| bash`. Windows PowerShell: `powershell -c "irm bun.sh/install.ps1 \| iex"` | Εγκατάσταση με Bun (`bun add -g @flisk-sh/flisk`) ή παραγόμενες υπηρεσίες JavaScript |

> **Δύο τρόποι εκτέλεσης.** Σε ένα έργο όπου κάθε υπηρεσία δηλώνει ένα `command`, οι υπηρεσίες τρέχουν ως τοπικές διεργασίες: χρειάζεστε μόνο το Flisk και το runtime της εφαρμογής σας ([απλούστερη διαδρομή](start/simplest.md)). Βάση δεδομένων, μία διεύθυνση για κάθε υπηρεσία ή το ίδιο container που κάνετε deploy απαιτούν [Docker](start/words.md#docker) και Tilt. Το `flisk doctor` ελέγχει μόνο ό,τι χρησιμοποιεί το έργο σας.

Βηματική προετοιμασία του υπολογιστή σας: [macOS](setup/macos.md) | [Ubuntu](setup/linux.md) | [Windows (WSL2)](setup/windows.md) | [Omarchy](setup/omarchy.md).

## Εγκατάσταση

Εγκαταστήστε το CLI με npm:

```bash
npm install -g @flisk-sh/flisk
```

Επαληθεύστε με `flisk --version`: εκτυπώνει τον αριθμό έκδοσης. Έπειτα ελέγξτε τον υπολογιστή σας:

```bash
flisk doctor
```

Το `flisk doctor` ελέγχει μόνο ό,τι χρησιμοποιεί το έργο σας και δείχνει πώς να διορθώσετε ό,τι λείπει.

Άλλοι τρόποι εγκατάστασης: [Bun](install/bun.md) | [προμεταγλωττισμένο binary, χωρίς Node.js ή Bun](install/binary.md) | [εικόνα container](install/container.md). Για εγκατάσταση μέσω GitHub Packages αντί του δημόσιου μητρώου npm: [εγκατάσταση από GitHub Packages](github-packages.md). Για ενημέρωση αργότερα χρησιμοποιήστε `flisk upgrade` (ή το alias του `flisk update`)· για να καρφιτσώσετε μία έκδοση δείτε [αναβάθμιση και καρφίτσωμα έκδοσης](upgrading.md).

> [!IMPORTANT]
> Αποκτήστε το Flisk από το αποθετήριο [flisk-sh/flisk](https://github.com/flisk-sh/flisk-cli), από το πακέτο npm
> [`@flisk-sh/flisk`](https://www.npmjs.com/package/@flisk-sh/flisk) ή από τον [επίσημο ιστότοπο](https://flisk.sh/).
> Ακολουθήστε τους συνδέσμους εγκατάστασης αυτών των επίσημων πηγών. Ένα παρόμοιο όνομα αποθετηρίου
> ή ένα αντιγραμμένο README δεν αποδεικνύει ότι μία λήψη είναι επίσημη.

Ο πλήρης οδηγός βρίσκεται στο [αγγλικό README](../README.md).
