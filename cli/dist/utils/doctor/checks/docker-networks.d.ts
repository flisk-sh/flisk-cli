import type { CheckResult } from "../../../types/index.js";
import { type DoctorProbeEnvironment } from "../../doctor-probe-cache.js";
import { type ExecAsync } from "../../exec-async.js";
export interface DockerNetworkCheckOptions {
    /** Recent probe verdicts remembered per project folder, daemon and server version; absent means always probe. */
    probeEnvironment?: DoctorProbeEnvironment | Promise<DoctorProbeEnvironment>;
    /** The project folder the verdict is remembered for; defaults to the project root or cwd. */
    projectRoot?: string;
}
export declare function checkDockerNetworkCapacity(exec?: ExecAsync, options?: DockerNetworkCheckOptions): Promise<CheckResult>;
