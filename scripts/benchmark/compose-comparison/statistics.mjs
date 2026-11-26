// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

/**
 * Statistics for the compose-comparison benchmark.
 * Pure functions; safe to import without opening sockets or spawning tools.
 */

/** Calculates count, min, max, median, p90, and mean for an array of sample numbers. */
export function calculateStats(samples) {
	if (!samples || samples.length === 0) {
		return {
			count: 0,
			min: null,
			max: null,
			median: null,
			p90: null,
			mean: null,
		};
	}
	const sorted = [...samples].sort((a, b) => a - b);
	const count = sorted.length;
	const min = sorted[0];
	const max = sorted[count - 1];
	const mid = Math.floor(count / 2);
	const median =
		count % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	const p90Index = Math.min(count - 1, Math.max(0, Math.ceil(0.9 * count) - 1));
	const p90 = sorted[p90Index];
	const mean = sorted.reduce((sum, v) => sum + v, 0) / count;

	return {
		count,
		samples: [...samples],
		min: Number(min.toFixed(3)),
		max: Number(max.toFixed(3)),
		median: Number(median.toFixed(3)),
		p90: Number(p90.toFixed(3)),
		mean: Number(mean.toFixed(3)),
	};
}
