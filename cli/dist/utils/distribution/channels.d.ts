/**
 * The channel catalog behind `flisk distribute`: where a listing can go, the status vocabulary a
 * channel entry uses, and the field limits a listing has to meet.
 */
export declare const DISTRIBUTION_FILE = "distribution.json";
export declare const CHANNEL_STATUSES: readonly ["live", "review", "draft", "blocked", "todo", "n/a"];
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];
export declare const STATUS_ICONS: Record<ChannelStatus, string>;
export interface Channel {
    id: string;
    name: string;
    /** True when the channel only lists MCP servers. */
    isMcpOnly: boolean;
    /** How a listing is submitted, in plain words. */
    submit: string;
    /** Field limits and rules, in plain words. */
    limits: string[];
}
export declare const CHANNELS: readonly Channel[];
export declare const TAGLINE_LIMIT = 60;
export declare const REGISTRY_DESCRIPTION_LIMIT = 100;
export declare const OPENAI_NAME_LIMIT = 30;
export declare const OPENAI_SHORT_DESCRIPTION_LIMIT = 30;
export declare const OPENAI_LONG_DESCRIPTION_LIMIT = 4000;
export declare const PRODUCT_HUNT_DESCRIPTION_LIMIT = 260;
export interface ChannelEntry {
    status: ChannelStatus;
    url?: string;
    date?: string;
    note?: string;
}
export interface DistributionApp {
    name?: string;
    tagline?: string;
    description?: string;
    bestFor?: string[];
    url?: string;
    homepage?: string;
    repository?: string;
    version?: string;
    reviewerNotes?: string;
    channels?: Record<string, ChannelEntry>;
}
export interface DistributionFile {
    schemaVersion: 1;
    owner?: string;
    githubOwner?: string;
    audience?: string;
    launch?: string;
    why?: string;
    promise?: string;
    /** How a release goes out (for example "tag v*, CI publishes"). */
    release?: string;
    /** License of the published app, such as MIT. */
    license?: string;
    /** Where users get help: a URL or an email. */
    support?: string;
    apps: Record<string, DistributionApp>;
}
