import type { DiscoveredResource, DiscoveredStack, ResourceMetadata, StackMetadata } from "../../types/index.js";
export declare function clearMetadataCache(): void;
export declare function getResourceMetadata(resource: DiscoveredResource): ResourceMetadata;
export declare function getStackMetadata(stack: DiscoveredStack): StackMetadata;
