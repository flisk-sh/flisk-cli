// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT
import { checkIngressPorts } from "../../../utils/doctor-runtime.js";
import { describeHostPortPlan, hostPortPlanFix } from "../../../utils/host-port-config.js";
import { findPortOwner, formatPortOwnerDiagnostic } from "../../../utils/port-owner.js";
/**
 * The gateway/Postgres host ports the plan chose, or which process took one when
 * the plan failed. `observed` carries the port owner into the JSON report.
 */
export const hostPortsCheck = {
    name: "Host Ports",
    requires: null,
    run: (ctx) => {
        if (ctx.hostPortPlan) {
            return {
                name: "Host Ports",
                didPass: true,
                message: describeHostPortPlan(ctx.hostPortPlan, ctx.portCaps),
            };
        }
        const match = ctx.portPlanError?.match(/(?:FLISK_\w+=|port )(\d+)/i);
        const conflictingPort = match ? Number(match[1]) : undefined;
        const owner = conflictingPort ? findPortOwner(conflictingPort) : null;
        if (owner && conflictingPort) {
            const diag = formatPortOwnerDiagnostic(conflictingPort, owner, ctx.portPlanError);
            return {
                name: "Host Ports",
                didPass: false,
                message: diag.message,
                fix: diag.fix,
                observed: owner,
            };
        }
        return {
            name: "Host Ports",
            didPass: false,
            message: ctx.portPlanError ?? "Could not select host ports",
            fix: hostPortPlanFix(ctx.portCaps),
        };
    },
};
/** The ingress ports the plan chose are free; only runs when the project enables the gateway. */
export const ingressPortsCheck = {
    name: "Ingress Ports",
    requires: null,
    when: (ctx) => ctx.gatewayEnabled,
    run: (ctx) => ctx.hostPortPlan
        ? checkIngressPorts(ctx.execSync, undefined, [ctx.hostPortPlan.ingressHttp, ctx.hostPortPlan.ingressHttps], { commandCache: ctx.hostCommandCache })
        : {
            name: "Ingress Ports",
            didPass: false,
            message: "Ingress port plan is unavailable",
        },
};
