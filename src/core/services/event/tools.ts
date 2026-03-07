/**
 * Event Tools - 事件工具创建
 *
 * 提供 Agent 工具形式的事件操作接口
 */

import { Type, Static } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { EventsWatcher } from "./watcher.js";
import type { ScheduledEvent } from "./types.js";

// ============================================================================
// Event Create Tool
// ============================================================================

const EventCreateSchema = Type.Object({
	type: Type.Union([Type.Literal("immediate"), Type.Literal("one-shot"), Type.Literal("periodic")], {
		description: "Event type: immediate (execute now), one-shot (execute once at specified time), periodic (repeat on schedule)",
	}),
	name: Type.String({ description: "Event name (used as filename, without .json)" }),
	channelId: Type.String({ description: "Target channel ID to send message to" }),
	text: Type.String({ description: "Instruction text for the Agent to execute when event triggers" }),
	at: Type.Optional(Type.String({ description: "Execution time for one-shot event (ISO 8601 format, e.g., 2024-01-15T09:00:00)" })),
	schedule: Type.Optional(Type.String({ description: "Cron expression for periodic event (e.g., '0 9 * * 1-5' for weekdays 9am)" })),
	timezone: Type.Optional(Type.String({ description: "Timezone for periodic event (default: Asia/Shanghai)", default: "Asia/Shanghai" })),
});
type EventCreateParams = Static<typeof EventCreateSchema>;

export function createEventCreateTool(watcher: EventsWatcher, defaultChannelId: string): AgentTool<typeof EventCreateSchema> {
	return {
		name: "event_create",
		label: "Event Create",
		description: "Create a scheduled event. Use 'immediate' for instant execution, 'one-shot' for single execution at a specific time, or 'periodic' for recurring events.",
		parameters: EventCreateSchema,
		execute: async (_toolCallId, params: EventCreateParams, _signal, _onUpdate) => {
			const { type, name, channelId, text, at, schedule, timezone } = params;

			// 验证参数
			if (type === "one-shot" && !at) {
				return {
					content: [{ type: "text", text: "Error: 'at' parameter is required for one-shot events" }],
					details: { error: "missing_at_parameter" },
				};
			}

			if (type === "periodic" && !schedule) {
				return {
					content: [{ type: "text", text: "Error: 'schedule' parameter is required for periodic events" }],
					details: { error: "missing_schedule_parameter" },
				};
			}

			// 构建事件对象
			const event: ScheduledEvent = (() => {
				switch (type) {
					case "immediate":
						return { type: "immediate", channelId: channelId || defaultChannelId, text };
					case "one-shot":
						return { type: "one-shot", channelId: channelId || defaultChannelId, text, at: at! };
					case "periodic":
						return {
							type: "periodic",
							channelId: channelId || defaultChannelId,
							text,
							schedule: schedule!,
							timezone: timezone || "Asia/Shanghai",
						};
				}
			})();

			const result = watcher.createEvent(name, event);

			if (result.success) {
				return {
					content: [{ type: "text", text: `Created ${type} event "${name}" successfully.` }],
					details: { created: true, name, type },
				};
			} else {
				return {
					content: [{ type: "text", text: `Error: ${result.error}` }],
					details: { error: result.error },
				};
			}
		},
	};
}

// ============================================================================
// Event List Tool
// ============================================================================

const EventListSchema = Type.Object({
	channelId: Type.Optional(Type.String({ description: "Filter by channel ID (optional)" })),
	type: Type.Optional(
		Type.Union([Type.Literal("immediate"), Type.Literal("one-shot"), Type.Literal("periodic")], {
			description: "Filter by event type (optional)",
		}),
	),
});
type EventListParams = Static<typeof EventListSchema>;

export function createEventListTool(watcher: EventsWatcher): AgentTool<typeof EventListSchema> {
	return {
		name: "event_list",
		label: "Event List",
		description: "List all scheduled events, optionally filtered by channel or type.",
		parameters: EventListSchema,
		execute: async (_toolCallId, params: EventListParams, _signal, _onUpdate) => {
			const { channelId, type } = params;

			const events = watcher.listEvents(channelId, type);

			if (events.length === 0) {
				return {
					content: [{ type: "text", text: "No events found." }],
					details: { count: 0 },
				};
			}

			// 格式化输出
			const lines = events.map(({ name, event }) => {
				switch (event.type) {
					case "immediate":
						return `- ${name} [immediate] -> ${event.channelId}: "${event.text.substring(0, 50)}..."`;
					case "one-shot":
						return `- ${name} [one-shot] @ ${event.at} -> ${event.channelId}: "${event.text.substring(0, 50)}..."`;
					case "periodic":
						return `- ${name} [periodic] "${event.schedule}" (${event.timezone}) -> ${event.channelId}: "${event.text.substring(0, 50)}..."`;
				}
			});

			return {
				content: [{ type: "text", text: `Found ${events.length} events:\n${lines.join("\n")}` }],
				details: { count: events.length, events },
			};
		},
	};
}

// ============================================================================
// Event Delete Tool
// ============================================================================

const EventDeleteSchema = Type.Object({
	name: Type.String({ description: "Event name to delete (without .json)" }),
});
type EventDeleteParams = Static<typeof EventDeleteSchema>;

export function createEventDeleteTool(watcher: EventsWatcher): AgentTool<typeof EventDeleteSchema> {
	return {
		name: "event_delete",
		label: "Event Delete",
		description: "Delete a scheduled event by name.",
		parameters: EventDeleteSchema,
		execute: async (_toolCallId, params: EventDeleteParams, _signal, _onUpdate) => {
			const { name } = params;

			const result = watcher.deleteEvent(name);

			if (result.success) {
				return {
					content: [{ type: "text", text: `Deleted event "${name}" successfully.` }],
					details: { deleted: true, name },
				};
			} else {
				return {
					content: [{ type: "text", text: `Error: ${result.error}` }],
					details: { error: result.error },
				};
			}
		},
	};
}

// ============================================================================
// All Event Tools
// ============================================================================

/**
 * 获取所有事件工具
 */
export function getAllEventTools(watcher: EventsWatcher, defaultChannelId: string): AgentTool<any>[] {
	return [
		createEventCreateTool(watcher, defaultChannelId),
		createEventListTool(watcher),
		createEventDeleteTool(watcher),
	];
}
