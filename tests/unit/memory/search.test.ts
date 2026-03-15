/**
 * Tests for search functionality
 */

import { describe, it, expect } from "vitest";
import { reciprocalRankFusion } from "../../../src/core/services/memory/search.js";

describe("reciprocalRankFusion", () => {
	it("should combine single list unchanged", () => {
		const list = [
			{ id: 1, score: 0.9 },
			{ id: 2, score: 0.8 },
			{ id: 3, score: 0.7 },
		];
		const fused = reciprocalRankFusion([list]);
		expect(fused.length).toBe(3);
		expect(fused[0]!.id).toBe(1);
	});

	it("should combine multiple lists", () => {
		const list1 = [
			{ id: 1, score: 0.9 },
			{ id: 2, score: 0.8 },
		];
		const list2 = [
			{ id: 2, score: 0.95 },
			{ id: 3, score: 0.85 },
		];
		const fused = reciprocalRankFusion([list1, list2]);
		expect(fused.length).toBe(3);
	});

	it("should boost items appearing in multiple lists", () => {
		const list1 = [{ id: 1, score: 0.9 }];
		const list2 = [{ id: 1, score: 0.8 }];
		const list3 = [{ id: 2, score: 0.95 }];

		const fused = reciprocalRankFusion([list1, list2, list3]);

		// Item 1 appears in two lists, should be ranked higher
		expect(fused[0]!.id).toBe(1);
	});

	it("should apply top-rank bonus", () => {
		const list = [
			{ id: 1, score: 0.9 },
			{ id: 2, score: 0.8 },
			{ id: 3, score: 0.7 },
		];
		const fused = reciprocalRankFusion([list]);

		// Rank 0 should have bonus (higher score)
		expect(fused[0]!.score).toBeGreaterThan(fused[1]!.score);
	});

	it("should apply weights", () => {
		const list1 = [{ id: 1, score: 0.9 }];
		const list2 = [{ id: 2, score: 0.95 }];

		// Give list1 double weight
		const fused = reciprocalRankFusion([list1, list2], [2.0, 1.0]);

		// Item 1 should win due to higher weight
		expect(fused[0]!.id).toBe(1);
	});

	it("should handle empty lists", () => {
		const fused = reciprocalRankFusion([[], []]);
		expect(fused.length).toBe(0);
	});

	it("should handle null/undefined lists", () => {
		const fused = reciprocalRankFusion([null as any, undefined as any, [{ id: 1, score: 0.9 }]]);
		expect(fused.length).toBe(1);
	});
});
