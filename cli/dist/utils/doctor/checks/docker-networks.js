// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { readDoctorProbe, writeDoctorProbe, } from "../../doctor-probe-cache.js";
import { execAsync } from "../../exec-async.js";
import { findProjectRoot } from "../../paths.js";
import { EXEC_TIMEOUT_MS } from "./shared.js";
const DOCKER_NETWORK_PROBE = "docker-network-capacity";
export async function checkDockerNetworkCapacity(exec = execAsync, options = {}) {
    const scope = options.projectRoot ?? findProjectRoot() ?? process.cwd();
    const env = await options.probeEnvironment;
    const cached = env && readDoctorProbe(env, DOCKER_NETWORK_PROBE, scope, "Docker networks");
    if (cached)
        return cached;
    const result = await probeDockerNetwork(exec);
    if (env)
        writeDoctorProbe(env, DOCKER_NETWORK_PROBE, scope, result);
    return result;
}
async function probeDockerNetwork(exec) {
    const probe = `flisk_doctor_probe_${process.pid}`;
    try {
        await exec(`docker network create ${probe}`, EXEC_TIMEOUT_MS);
    }
    catch (error) {
        const stderr = String(error.stderr ?? error);
        if (/address pools/i.test(stderr)) {
            return {
                name: "Docker networks",
                didPass: false,
                message: "Docker cannot create another network: all predefined address pools are in use. Each Flisk project needs several",
                fix: "Run flisk doctor --fix --scope=machine: it removes unused networks of every Flisk project and keeps the ones in use. Or run flisk down --prune-networks in each project you are not using",
            };
        }
        return {
            name: "Docker networks",
            didPass: true,
            isSkipped: true,
            message: "Could not test network creation",
        };
    }
    try {
        await exec(`docker network rm ${probe}`, EXEC_TIMEOUT_MS);
    }
    catch {
        // A leftover probe network is harmless and flisk_doctor_probe_* is easy to prune.
    }
    return { name: "Docker networks", didPass: true, message: "Docker can create networks" };
}
