# `flisk maintainers`

`flisk maintainers` runs a small gate over a `MAINTAINERS.md` table. It checks that the file lists at least three distinct maintainers from at least two distinct companies. It is a repository gate, not a claim that the listed people are eligible for any role.

## Commands and flags

| Command / flag | Effect |
| --- | --- |
| `flisk maintainers` | Show the command help. |
| `flisk maintainers check [file]` | Check a Markdown table. `file` defaults to `MAINTAINERS.md` in the current directory. |
| `-h`, `--help` | Show help for `maintainers` or `maintainers check`. |

The table must have `Name`, `GitHub id`, and `Company` columns. Rows with a missing name or GitHub id, a duplicate GitHub id, or a placeholder company (`tbd`, `unknown`, `flisk-sh`, or empty) are ignored.

## Examples

```console
$ flisk maintainers --help
Usage: flisk maintainers [options] [command]

Maintainer file checks

Options:
  -h, --help      display help for command

Commands:
  check [file]    Check MAINTAINERS.md lists 3 maintainers from 2 companies (a
                  gate, not a claim of eligibility)
  help [command]  display help for command
```

Check the default file:

```console
$ flisk maintainers check
3 maintainers, 3 companies
```

Check a specific file:

```console
$ flisk maintainers check /tmp/flisk-maintainers-doc/MAINTAINERS.md
3 maintainers, 3 companies
```

A file that does not meet the gate fails with a reason:

```console
$ flisk maintainers check /tmp/flisk-maintainers-doc/SMALL.md
not eligible: 0 maintainers (3 missing), 0 companies (2 missing)
```

The full [machine-readable CLI envelope](machine-readable-cli.md) is not used by this command; it prints a single human-readable line to stdout on success and stderr on failure.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | The table has at least three valid maintainers from at least two companies. |
| `1` | The file was not found, the required table was not found, or the gate failed. |
| `2` | Invalid arguments, such as an unknown option. |

## What it never does

- It does not edit `MAINTAINERS.md` or any other file.
- It does not verify identities, companies, CODEOWNERS, GitHub permissions, or CLA status.
- It does not require a Flisk project, Docker, or network access.
- It does not grant maintainer status; it only reports whether the file passes the documented gate.
