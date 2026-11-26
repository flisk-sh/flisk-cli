/** Removes every leading `char` (one character) from `text`, without a backtracking regex. */
export declare function trimStartChar(text: string, char: string): string;
/** Removes every trailing `char` (one character) from `text`, without a backtracking regex. */
export declare function trimEndChar(text: string, char: string): string;
/** Removes every leading and trailing `char` (one character) from `text`. */
export declare function trimChar(text: string, char: string): string;
/** Removes every leading character that appears in `chars` (a set of characters, not a sequence). */
export declare function trimStartChars(text: string, chars: string): string;
/** Removes every trailing character that appears in `chars` (a set of characters, not a sequence). */
export declare function trimEndChars(text: string, chars: string): string;
/** Removes every leading and trailing character that appears in `chars`. */
export declare function trimChars(text: string, chars: string): string;
