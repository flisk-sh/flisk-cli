# `flisk mcp check`

`flisk mcp check` checks whether an MCP server speaks the expected protocol. It is registered as the `check` subcommand of [`flisk mcp`](../mcp.md), so the command is written with a space: `flisk mcp check <target>`. The target is either the full URL of an MCP endpoint or the name of a resource in the current Flisk project.

## Flags and argument

| Command / flag | Effect |
| --- | --- |
| `flisk mcp check <target>` | Check the endpoint at `<target>`, which must be an https URL (plain http is allowed only for localhost, `*.localhost` and loopback addresses) or a resource name from `flisk resources`. |
| `--call` | Also call each tool once with sample arguments built from its `inputSchema`. A tool call can reach the network, so it is opt-in. |
| `--no-icon` | Skip the check that `icon-512.png` beside the endpoint is a PNG. |
| `--json` | Print one [machine-readable envelope](machine-readable-cli.md) on stdout instead of the text table. The report stays in `data` even when checks fail. |
| `-h`, `--help` | Show the command help. |

```console
$ flisk mcp check --help
Usage: flisk mcp check [options] <target>

Check an MCP server's protocol (initialize, tools, prompts, errors, HTTP rules,
icon); read-only unless --call

Arguments:
  target      An https URL of the MCP endpoint, or the name of a resource in
              this project

Options:
  --call      Also call each tool once with sample arguments (a call can reach
              the network) (default: false)
  --no-icon   Skip the icon-512.png check
  --json      Print the report as a JSON envelope (default: false)
  -h, --help  display help for command
```

## What it checks

The command checks `initialize`, `tools/list`, each tool's `readOnlyHint`, `prompts/list`, one `prompts/get` per declared prompt, refusal of an unknown method with JSON-RPC `-32601`, refusal of invalid JSON with HTTP 400, refusal of `GET` with HTTP 405, and that a client sending only `Accept: application/json` still gets a response. It also checks that `icon-512.png` is a PNG unless `--no-icon` is set. Without `--call`, the `tools/call` row is reported as skipped, not passed. A network error is retried twice.

## Example

This is the text report from a local test server. The port on your machine will differ.

```console
$ flisk mcp check http://127.0.0.1:62453/mcp
MCP check: http://127.0.0.1:62453/mcp
Server: fake-mcp

  Result  Check                                          Detail
  pass    initialize                                     status 200, server fake-mcp, capabilities [tools, prompts]
  pass    tools/list                                     status 200, tools [lookup, ping]
  pass    readOnlyHint lookup                            readOnlyHint=true
  pass    readOnlyHint ping                              readOnlyHint=true
  skip    tools/call                                     not run: pass --call to call each tool once (a call can reach the network)
  pass    prompts/list                                   status 200, prompts [explain]
  pass    prompts/get explain                            status 200, arguments {"topic":"example"}, 1 message(s)
  pass    unknown method is refused (-32601)             {"code":-32601,"message":"Method not found"}
  pass    bad JSON is refused (HTTP 400)                 status 400 {"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}
  pass    GET is refused (HTTP 405)                      status 405
  pass    a JSON-only Accept header is served (not 406)  status 200
  pass    icon-512.png is a PNG                          http://127.0.0.1:62453/icon-512.png: status 200, image/png

11 of 11 checks passed
```

An invalid target is rejected before any request is sent:

```console
$ flisk mcp check http://example.com/mcp --json
{"schemaVersion":1,"data":null,"errors":[{"code":"COMMAND_FAILED","message":"flisk mcp check needs an https URL, got http://example.com","suggestions":["Use the https address of the server","Plain http is accepted only for localhost, *.localhost and loopback addresses"]}]}
```

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Every executed check passed; skipped checks do not count as failures. |
| `1` | A protocol check failed, or the target could not be resolved (not in a project, unknown resource, or a resource with no HTTP route). |
| `2` | Invalid invocation, such as a missing target, an unknown flag, or a non-https URL outside loopback. |

## What it never does

- It does not start the stack or the MCP server. The server must already answer at the URL, or the named resource must already be running.
- It does not modify the server, its files, or the Flisk project configuration.
- It does not deploy, publish or register anything with an MCP registry.
- It does not call tools unless `--call` is given.
- It does not accept a plain http URL for a remote host; https is required outside loopback.
