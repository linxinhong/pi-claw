/**
 * Tests for memory chunking functionality
 */

import { describe, it, expect } from "vitest";
import {
	chunkDocument,
	scanBreakPoints,
	findCodeFences,
	CHUNK_SIZE_CHARS,
} from "../../../src/core/services/memory/indexer.js";

describe("scanBreakPoints", () => {
	it("should detect h1 headings", () => {
		const text = "# Title\nSome content\n# Another Title";
		const points = scanBreakPoints(text);
		expect(points.some((p) => p.type === "h1")).toBe(true);
	});

	it("should detect h2 headings", () => {
		const text = "## Section 1\nContent\n## Section 2";
		const points = scanBreakPoints(text);
		expect(points.some((p) => p.type === "h2")).toBe(true);
	});

	it("should detect blank lines", () => {
		const text = "Paragraph 1\n\nParagraph 2";
		const points = scanBreakPoints(text);
		expect(points.some((p) => p.type === "blank")).toBe(true);
	});

	it("should be sorted by position", () => {
		const text = "# H1\n\n## H2\n\n### H3";
		const points = scanBreakPoints(text);
		for (let i = 1; i < points.length; i++) {
			expect(points[i]!.pos).toBeGreaterThan(points[i - 1]!.pos);
		}
	});
});

describe("findCodeFences", () => {
	it("should detect code fences", () => {
		const text = "Some text\n```\ncode here\n```\nMore text";
		const fences = findCodeFences(text);
		expect(fences.length).toBe(1);
	});

	it("should handle multiple code fences", () => {
		const text = "```\ncode1\n```\n```\ncode2\n```";
		const fences = findCodeFences(text);
		expect(fences.length).toBe(2);
	});

	it("should handle unclosed code fences", () => {
		const text = "Some text\n```\nunclosed code";
		const fences = findCodeFences(text);
		expect(fences.length).toBe(1);
		expect(fences[0]!.end).toBe(text.length);
	});
});

describe("chunkDocument", () => {
	it("should return single chunk for short content", () => {
		const content = "Short content";
		const chunks = chunkDocument(content);
		expect(chunks.length).toBe(1);
		expect(chunks[0]!.text).toBe(content);
		expect(chunks[0]!.pos).toBe(0);
	});

	it("should split long content into multiple chunks", () => {
		const content = "A".repeat(5000) + "\n## Section\n" + "B".repeat(5000);
		const chunks = chunkDocument(content);
		expect(chunks.length).toBeGreaterThan(1);
	});

	it("should include overlap between chunks", () => {
		const content = "A".repeat(5000) + "\n## Section\n" + "B".repeat(5000);
		const chunks = chunkDocument(content);

		if (chunks.length > 1) {
			// Chunks should have some overlap
			expect(chunks[1]!.pos).toBeLessThan(chunks[0]!.pos + chunks[0]!.text.length);
		}
	});

	it("should prefer breaking at headings", () => {
		const content =
			"A".repeat(3000) +
			"\n## Section Break\n" +
			"B".repeat(3000) +
			"\n## Another Section\n" +
			"C".repeat(3000);
		const chunks = chunkDocument(content);

		// Chunks should start with headings or be at the beginning
		for (let i = 1; i < chunks.length; i++) {
			const chunk = chunks[i]!;
			// Check if chunk starts with or contains a heading near the start
			const hasHeading = chunk.text.slice(0, 100).includes("## ");
			expect(hasHeading || chunk.text.startsWith("A") || chunk.text.startsWith("B")).toBe(true);
		}
	});

	it("should preserve position information", () => {
		const content = "# Title\n\nContent here";
		const chunks = chunkDocument(content);
		expect(chunks[0]!.pos).toBe(0);

		// Reconstruct content from chunks should be possible
		for (const chunk of chunks) {
			expect(content.slice(chunk.pos, chunk.pos + chunk.text.length)).toBe(chunk.text);
		}
	});
});
