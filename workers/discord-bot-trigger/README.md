# Discord bot trigger

A Cloudflare Worker that starts the [Discord badge bot](../../.github/workflows-disabled/discord-founding-role.yml) every 3 minutes. GitHub's own schedule can go hours without firing, and contributors are told the bot answers within a few minutes.

Every run handles new claims. The first run from minute 17 of each hour also runs the level sync and starts the [Cilytics](https://cilytics.flisk.si/) collect in `flisk-sh/cilytics`, whose own hourly schedule did not fire either. The Worker only dispatches; the Discord work stays in GitHub Actions, so the Worker stays far from its daily limits.

## Set up

Deploy from this folder:

```bash
npx wrangler@4 deploy
```

Then create a fine-grained GitHub token limited to `flisk-sh/flisk-cli` and `flisk-sh/cilytics` with **Actions: Read and write**, and store it:

```bash
npx wrangler@4 secret put GITHUB_DISPATCH_TOKEN
```

The token expires, and the bot stops being started when it does. Replace it the same way. Worker errors appear in the Cloudflare dashboard under this Worker's logs.

## Restore the seat list

The bot stops with an error when the registry issue is missing or incomplete, so it can never restart numbering at 1. To restore it, from the repository root:

```bash
DISCORD_BOT_TOKEN=... node scripts/restore-founding-registry.mjs > registry.md
```

It only reads Discord. It starts from `scripts/data/founding-seats.json` (the 30 seats on badges.flisk.si, built 2026-11-24), adds later claims and Discord ids from the bot's replies in `#start-here`, and keeps each holder's current tier and belt. It fails and names the seats if any cannot be matched; add their `"discord"` id to that file and run it again.

`registry.md` contains Discord ids. Create an issue titled "Founding Contributors: the first 100" with that file as its body and the `community` label, then delete the file. Only after that, move the workflow back to `.github/workflows/`.
