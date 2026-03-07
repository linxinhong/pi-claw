/**
 * Event Tools Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { EventsWatcher } from "../../../../../src/core/services/event/watcher.js";
import { createEventCreateTool, createEventListTool, createEventDeleteTool, getAllEventTools } from "../../../../../src/core/services/event/tools.js";

describe("Event Tools", () => {
	let testDir: string;
	let eventsDir: string;
	let watcher: EventsWatcher;

	beforeEach(() => {
		testDir = join(process.cwd(), "test-temp", `event-tools-test-${Date.now()}`);
		eventsDir = join(testDir, "events");
		mkdirSync(eventsDir, { recursive: true });

		watcher = new EventsWatcher({
			eventsDir,
			onEvent: async () => {},
		});
	});

	afterEach(() => {
		watcher.stop();
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	});

	describe("createEventCreateTool", () => {
		it("should create tool with correct name", () => {
			const tool = createEventCreateTool(watcher, "default-channel");
			expect(tool.name).toBe("event_create");
		});

		it("should create immediate event with timestamp in filename", async () => {
			const tool = createEventCreateTool(watcher, "default-channel");
			const result = await tool.execute("test-id", {
				type: "immediate",
				name: "test-immediate",
				channelId: "ch-123",
				text: "Test immediate event",
			});

			expect(result.details?.created).toBe(true);
			expect(result.details?.name).toBe("test-immediate");
			expect(result.details?.filename).toMatch(/^test-immediate-\d+\.json$/);
			expect(existsSync(join(eventsDir, result.details!.filename!))).toBe(true);
		});

		it("should create one-shot event with at parameter", async () => {
			const tool = createEventCreateTool(watcher, "default-channel");
			const futureTime = new Date(Date.now() + 3600000).toISOString();

			const result = await tool.execute("test-id", {
				type: "one-shot",
				name: "test-oneshot",
				channelId: "ch-123",
				text: "Test one-shot event",
				at: futureTime,
			});

			expect(result.details?.created).toBe(true);

			const content = JSON.parse(readFileSync(join(eventsDir, result.details!.filename!), "utf-8"));
			expect(content.type).toBe("one-shot");
			expect(content.at).toBe(futureTime);
		});

		it("should create periodic event with schedule", async () => {
			const tool = createEventCreateTool(watcher, "default-channel");

			const result = await tool.execute("test-id", {
				type: "periodic",
				name: "test-periodic",
				channelId: "ch-123",
				text: "Test periodic event",
				schedule: "0 9 * * 1-5",
				timezone: "Asia/Shanghai",
			});

			expect(result.details?.created).toBe(true);

			const content = JSON.parse(readFileSync(join(eventsDir, result.details!.filename!), "utf-8"));
			expect(content.type).toBe("periodic");
			expect(content.schedule).toBe("0 9 * * 1-5");
			expect(content.timezone).toBe("Asia/Shanghai");
		});

		it("should use default timezone if not specified", async () => {
			const tool = createEventCreateTool(watcher, "default-channel");

			const result = await tool.execute("test-id", {
				type: "periodic",
				name: "test-default-tz",
				channelId: "ch-123",
				text: "Test",
				schedule: "0 9 * * *",
			});

			expect(result.details?.created).toBe(true);

			const content = JSON.parse(readFileSync(join(eventsDir, result.details!.filename!), "utf-8"));
			expect(content.timezone).toBe("Asia/Shanghai");
		});

		it("should use default channelId if not specified", async () => {
			const tool = createEventCreateTool(watcher, "default-channel");

			const result = await tool.execute("test-id", {
				type: "immediate",
				name: "test-default-channel",
				channelId: "", // empty string should use default
				text: "Test",
			});

			expect(result.details?.created).toBe(true);

			const content = JSON.parse(readFileSync(join(eventsDir, result.details!.filename!), "utf-8"));
			expect(content.channelId).toBe("default-channel");
		});

		it("should allow creating events with same name (different timestamps)", async () => {
			const tool = createEventCreateTool(watcher, "default-channel");

			const result1 = await tool.execute("test-id", {
				type: "immediate",
				name: "duplicate",
				channelId: "ch-123",
				text: "First",
			});

			expect(result1.details?.created).toBe(true);
			expect(result1.details?.filename).toMatch(/^duplicate-\d+\.json$/);

			// Wait for next second to ensure different timestamp (timestamp is in seconds)
			await new Promise((resolve) => setTimeout(resolve, 1100));

			const result2 = await tool.execute("test-id", {
				type: "immediate",
				name: "duplicate",
				channelId: "ch-123",
				text: "Second",
			});

			// Both should succeed with different filenames
			expect(result2.details?.created).toBe(true);
			expect(result2.details?.filename).toMatch(/^duplicate-\d+\.json$/);
			expect(result1.details?.filename).not.toBe(result2.details?.filename);
		});

		it("should fail for one-shot without at parameter", async () => {
			const tool = createEventCreateTool(watcher, "default-channel");

			const result = await tool.execute("test-id", {
				type: "one-shot",
				name: "missing-at",
				channelId: "ch-123",
				text: "Test",
			} as any);

			expect(result.details?.error).toBe("missing_at_parameter");
		});

		it("should fail for periodic without schedule parameter", async () => {
			const tool = createEventCreateTool(watcher, "default-channel");

			const result = await tool.execute("test-id", {
				type: "periodic",
				name: "missing-schedule",
				channelId: "ch-123",
				text: "Test",
			} as any);

			expect(result.details?.error).toBe("missing_schedule_parameter");
		});
	});

	describe("createEventListTool", () => {
		it("should create tool with correct name", () => {
			const tool = createEventListTool(watcher);
			expect(tool.name).toBe("event_list");
		});

		it("should list all events", async () => {
			const createTool = createEventCreateTool(watcher, "default-channel");

			await createTool.execute("test-id", {
				type: "immediate",
				name: "event-1",
				channelId: "ch-123",
				text: "Event 1",
			});

			await createTool.execute("test-id", {
				type: "periodic",
				name: "event-2",
				channelId: "ch-456",
				text: "Event 2",
				schedule: "0 9 * * *",
			});

			const listTool = createEventListTool(watcher);
			const result = await listTool.execute("test-id", {});

			expect(result.details?.count).toBe(2);
		});

		it("should filter by channelId", async () => {
			const createTool = createEventCreateTool(watcher, "default-channel");

			await createTool.execute("test-id", {
				type: "immediate",
				name: "event-1",
				channelId: "ch-123",
				text: "Event 1",
			});

			await createTool.execute("test-id", {
				type: "immediate",
				name: "event-2",
				channelId: "ch-456",
				text: "Event 2",
			});

			const listTool = createEventListTool(watcher);
			const result = await listTool.execute("test-id", { channelId: "ch-123" });

			expect(result.details?.count).toBe(1);
			// Name includes timestamp, so check it starts with expected prefix
			expect(result.details?.events[0].name).toMatch(/^event-1-\d+$/);
		});

		it("should filter by type", async () => {
			const createTool = createEventCreateTool(watcher, "default-channel");

			await createTool.execute("test-id", {
				type: "immediate",
				name: "event-1",
				channelId: "ch-123",
				text: "Event 1",
			});

			await createTool.execute("test-id", {
				type: "periodic",
				name: "event-2",
				channelId: "ch-123",
				text: "Event 2",
				schedule: "0 9 * * *",
			});

			const listTool = createEventListTool(watcher);
			const result = await listTool.execute("test-id", { type: "periodic" });

			expect(result.details?.count).toBe(1);
			// Name includes timestamp, so check it starts with expected prefix
			expect(result.details?.events[0].name).toMatch(/^event-2-\d+$/);
		});

		it("should return empty list if no events", async () => {
			const listTool = createEventListTool(watcher);
			const result = await listTool.execute("test-id", {});

			expect(result.details?.count).toBe(0);
		});
	});

	describe("createEventDeleteTool", () => {
		it("should create tool with correct name", () => {
			const tool = createEventDeleteTool(watcher);
			expect(tool.name).toBe("event_delete");
		});

		it("should delete existing event", async () => {
			const createTool = createEventCreateTool(watcher, "default-channel");

			const createResult = await createTool.execute("test-id", {
				type: "immediate",
				name: "to-delete",
				channelId: "ch-123",
				text: "To be deleted",
			});

			const filename = createResult.details!.filename!;
			expect(existsSync(join(eventsDir, filename))).toBe(true);

			// Delete using the full filename (with timestamp)
			const deleteTool = createEventDeleteTool(watcher);
			const result = await deleteTool.execute("test-id", { name: filename.replace(/\.json$/, "") });

			expect(result.details?.deleted).toBe(true);
			expect(existsSync(join(eventsDir, filename))).toBe(false);
		});

		it("should fail if event not found", async () => {
			const deleteTool = createEventDeleteTool(watcher);
			const result = await deleteTool.execute("test-id", { name: "non-existent" });

			expect(result.details?.deleted).toBeUndefined();
			expect(result.details?.error).toContain("not found");
		});
	});

	describe("getAllEventTools", () => {
		it("should return all three tools", () => {
			const tools = getAllEventTools(watcher, "default-channel");
			expect(tools).toHaveLength(3);
			expect(tools.map((t) => t.name)).toEqual(["event_create", "event_list", "event_delete"]);
		});
	});
});
