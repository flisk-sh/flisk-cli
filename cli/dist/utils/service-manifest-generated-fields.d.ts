/**
 * A frontend's `basePath`, as in the schema (runtime/engine/schemas/service-schema.json). `flisk resource --base-path` checks
 * the same pattern, so a resource it creates is never reported invalid by `flisk config verify`.
 */
export declare const BASE_PATH_PATTERN: RegExp;
/**
 * Errors for generated-output fields whose values could change the generated YAML. The value itself is not echoed, because it may
 * contain the newline that makes it dangerous.
 */
export declare function validateGeneratedStringFields(manifest: Record<string, unknown>, displayPath: string): string[];
/**
 * Generated-output errors for one service.json. A file that cannot be read or parsed returns none here, because
 * validateServiceManifestFile reports that case.
 */
export declare function generatedFieldErrorsForFile(filePath: string, displayPath: string): string[];
