# Atalhos de teclado do `flisk ui`

> Esta página é uma tradução em português de [ui.md](ui.md).

O `flisk ui` abre um painel interativo no terminal para a stack em execução. As teclas abaixo são as que o painel reconhece.

| Tecla | Ação |
|---|---|
| `1`–`5` | Vai para as abas Overview, Resources, Events, Files, Config | <!-- spellchecker:disable-line -->
| `Tab` / `Shift+Tab` | Próxima aba / aba anterior |
| `↑`/`↓` ou `j`/`k` | Move o destaque |
| `g` / `G`, `Home` / `End` | Primeiro / último item |
| `PgUp` / `PgDn` | Move uma página |
| `Enter` ou `Space` | Abre a stack, o serviço ou o arquivo destacado |
| `Esc` | Volta um nível (arquivo → serviço → stack). Na tela principal só mostra "Press q to quit" |
| `/` | Busca. `Enter` mantém o filtro, `Esc` limpa |
| `r` | Atualiza. Na aba Events, recarrega os eventos |
| `e` | Alterna entre somente serviços habilitados e todos os serviços |
| `t` | Alterna as dicas do rodapé |
| `m` | Alterna o suporte a mouse |
| `?` | Mostra o painel de ajuda. Qualquer tecla o fecha |
| `q` | Sai |

## Flags

- `--no-animations`: desativa as animações (texto de spinner estático).
- `--high-contrast`: ativa cores de alto contraste.

## Modo ASCII

O `flisk ui` muda sozinho para ASCII puro quando o ambiente pede para não usar cores:

- `NO_COLOR` está definida, mesmo com valor vazio, ou
- `TERM` começa com `dumb` (qualquer capitalização).

Ele também usa os símbolos ASCII abaixo, mas mantém as cores, quando `TERM` é `linux` ou a primeira variável definida entre `LC_ALL`, `LC_CTYPE` e `LANG` não indica UTF-8 (por exemplo `LANG=C`).

No modo ASCII não há cores, nem caixas em volta dos painéis, e `--high-contrast` não tem efeito. Tudo que era símbolo vira texto:

| Onde | Normal | ASCII |
|---|---|---|
| Banner e marcador da linha selecionada | `▓▒░` (fim: `░▒▓`) | `>>>` (fim: `<<<`) |
| Separador entre itens do rodapé | ` │ ` | ` \| ` | <!-- spellchecker:disable-line -->
| Réguas horizontais | `─` | `-` |
| Título de seção | `┌─ Resources ─` | `[ Resources ]` |
| Título de stack e de serviço | `┌─ NAME ─┐` | `--- NAME ---` |
| Status: saudável, em andamento, falhou, desconhecido | `✓` `○` `✗` `?` | `[+]` `[~]` `[x]` `[?]` |
| Serviços dentro de uma stack | `├─ ` e `└─ ` | `\|- ` e `L- ` |
| Pasta aberta, fechada (aba Files) | `▼` `▶` | `[-]` `[+]` |
| Tipos de arquivo: Docker, Tilt, config, Prisma, gerado, outro | emoji | `[D]` `[T]` `[C]` `[P]` `[G]` `[?]` |
| Contagens da Overview: numa stack, sem stack | `●` `○` | `[+]` `-` |
| Alternadores do rodapé | `🖱️` `ℹ️` `✓ enabled` (ou `✓ all`) | `Mouse` `Info` `[+] enabled` (ou `[+] all`) |
| Prefixo de dica | `ℹ ` | `[i] ` |
| Spinner de carregamento | pontos braille | `-` `/` `\|` `\` |
| Marca de erro, marca de estado vazio | `✗` `◉` | `[x]` `[*]` | <!-- spellchecker:disable-line -->
| Setas nas dicas de teclas | `↑/↓` | `UP/DOWN` |

Para testar, rode `NO_COLOR=1 flisk ui`. O mesmo comportamento está descrito em [`cli/README.md`](../cli/README.md).

## Aba Events

A aba Events lê do Tilt, então o Tilt precisa estar rodando. Se não estiver, a aba mostra "Tilt is not running or its UI is unreachable" e sugere `flisk up`. Pressione `r` nessa aba para tentar de novo.
