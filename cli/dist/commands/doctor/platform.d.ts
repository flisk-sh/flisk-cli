import { type HostInfo } from "../../utils/agent-host.js";
import type { DoctorOptions } from "./context.js";
export declare const NATIVE_WINDOWS_DOCTOR_MESSAGE = "Native Windows cannot boot a Docker stack; services that declare a command run as local processes. For a Docker stack use WSL2 Ubuntu with Docker Desktop integration. Guide: docs/start-here-on-windows.md (reference: docs/wsl2.md)";
/**
 * The native-Windows report: the platform finding plus the Windows diagnostics
 * (kept behind the win32 platform check so Linux/macOS are unchanged), then exit 1.
 */
export declare function runNativeWindowsDoctor(options: DoctorOptions, host: HostInfo): Promise<void>;
/** The WebContainer report: no Docker daemon or Tilt to check, then exit 1. */
export declare function runWebcontainerDoctor(options: DoctorOptions, host: HostInfo): void;
