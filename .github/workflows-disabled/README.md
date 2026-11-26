# Disabled workflows

GitHub only runs files in `.github/workflows/`. Everything here is switched off on purpose.
Only `ci.yml` (it provides the required checks "PR summary review" and "Summary") is active.

To turn one back on, `git mv` it into `.github/workflows/`.
`dependabot.yml.disabled` goes back to `.github/dependabot.yml`.
