// Copyright (c) 2026 Flisk Landscape contributors
// SPDX-License-Identifier: MIT

import assert from "node:assert/strict";
import test from "node:test";
import { calculateStats } from "./statistics.mjs";

test("calculateStats returns nulls for empty and missing input", () => {
	for (const input of [undefined, null, []]) {
		const stats = calculateStats(input);
		assert.equal(stats.count, 0);
		assert.equal(stats.min, null);
		assert.equal(stats.max, null);
		assert.equal(stats.median, null);
		assert.equal(stats.p90, null);
		assert.equal(stats.mean, null);
		assert.equal(stats.samples, undefined);
	}
});

test("calculateStats handles a single sample", () => {
	const stats = calculateStats([3.5]);
	assert.equal(stats.count, 1);
	assert.equal(stats.min, 3.5);
	assert.equal(stats.max, 3.5);
	assert.equal(stats.median, 3.5);
	assert.equal(stats.p90, 3.5);
	assert.equal(stats.mean, 3.5);
	assert.deepEqual(stats.samples, [3.5]);
});

test("calculateStats computes median for odd and even sample counts", () => {
	const odd = calculateStats([1.0, 5.0, 3.0, 2.0, 4.0]);
	assert.equal(odd.median, 3.0);
	assert.equal(odd.min, 1.0);
	assert.equal(odd.max, 5.0);

	const even = calculateStats([10.0, 20.0, 30.0, 40.0]);
	assert.equal(even.median, 25.0);
	assert.equal(even.min, 10.0);
	assert.equal(even.max, 40.0);
});

test("calculateStats computes p90 at the ceil(0.9 * n) - 1 index", () => {
	// n=5: index ceil(4.5)-1 = 4, the maximum
	assert.equal(calculateStats([1, 2, 3, 4, 5]).p90, 5);
	// n=10: index ceil(9)-1 = 8, the ninth smallest value
	assert.equal(calculateStats([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]).p90, 9);
	// n=20: index ceil(18)-1 = 17
	const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
	assert.equal(calculateStats(twenty).p90, 18);
});

test("calculateStats computes the mean and rounds all metrics to 3 decimals", () => {
	const stats = calculateStats([0.1234, 0.5678]);
	assert.equal(stats.mean, 0.346);
	assert.equal(stats.median, 0.346);

	const uneven = calculateStats([1.0004, 2.0004, 9.0004]);
	assert.equal(uneven.median, 2.0);
	assert.equal(uneven.mean, 4.0);
});

test("calculateStats keeps samples in input order and does not mutate input", () => {
	const input = [5.5, 1.1, 3.3];
	const stats = calculateStats(input);
	assert.deepEqual(stats.samples, [5.5, 1.1, 3.3]);
	assert.deepEqual(input, [5.5, 1.1, 3.3]);
});
