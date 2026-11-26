/**
 * The program a command really starts. A setup job of a generated starter declares `cd ../agent && npm install`
 * (#3885), whose first word is the shell builtin `cd`; what fails on a machine without `npm` is the word after it.
 *
 * The command is read the way the shell reads it: `&&` and `;` inside quotes or escaped are arguments, `export` and
 * the other builtins run before the program, and a compound command (`if … then … fi`), a pipe, a redirection or a
 * sourced script — anything whose program this word-by-word view cannot name — is left for the shell to report rather
 * than guessed at.
 */
export declare function leadingProgram(command: string): {
    program: string;
    moved: boolean;
} | null;
/** True when PATH has an entry that is not absolute, which the shell resolves against its current directory. */
export declare function pathHasRelativeEntry(): boolean;
