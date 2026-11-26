// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

export interface DevTestOnSaveConfig {
  enabled?: boolean;
  path?: string;
}

export interface DevConfig {
  command?: string;
  watch?: string[];
  liveReload?: boolean;
  testOnSave?: boolean | DevTestOnSaveConfig;
}

export interface AgentConfig {
  /** Runtime scaffold the resource was created with. `custom` is the only one today and carries no vendor dependency. */
  runtime?: string;
  /** Where agent sessions are checkpointed. `files`: named volume; `postgres`: project Postgres via DATABASE_URL. */
  durability?: "files" | "postgres";
}
