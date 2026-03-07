/**
 * Events Watcher - 事件监控服务
 *
 * 核心事件调度功能，不依赖插件接口
 */

import { Cron } from "croner";
import { existsSync, mkdirSync, readdirSync, unlinkSync, watch, type FSWatcher, statSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import * as log from "../../../utils/logger/index.js";
import type { EventCallback, ScheduledEvent } from "./types.js";
import type { HookManager } from "../../hook/manager.js";
import { HOOK_NAMES } from "../../hook/index.js";

/**
 * 事件监控器配置
 */
export interface EventsWatcherConfig {
	eventsDir: string;
	onEvent: EventCallback;
}

/**
 * 事件监控器类
 */
export class EventsWatcher {
	private timers = new Map<string, NodeJS.Timeout>();
	private crons = new Map<string, Cron>();
	private debounceTimers = new Map<string, NodeJS.Timeout>();
	private startTime: number;
	private watcher: FSWatcher | null = null;
	private knownFiles = new Set<string>();
	private eventsDir: string;
	private onEvent: EventCallback;
	private hookManager: HookManager | null = null;

	constructor(config: EventsWatcherConfig) {
		this.eventsDir = config.eventsDir;
		this.onEvent = config.onEvent;
		this.startTime = Date.now();
	}

	/**
	 * 设置 HookManager
	 */
	setHookManager(hookManager: HookManager): void {
		this.hookManager = hookManager;
	}

	start(): void {
		if (!existsSync(this.eventsDir)) {
			mkdirSync(this.eventsDir, { recursive: true });
		}

		log.logInfo(`[EventsWatcher] Starting, dir: ${this.eventsDir}`);
		this.scanExisting();

		this.watcher = watch(this.eventsDir, (_eventType, filename) => {
			if (!filename || !filename.endsWith(".json")) return;
			this.debounce(filename, () => this.handleFileChange(filename));
		});

		log.logInfo(`[EventsWatcher] Started, tracking ${this.knownFiles.size} files`);
	}

	stop(): void {
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}

		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer);
		}
		this.debounceTimers.clear();

		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();

		for (const cron of this.crons.values()) {
			cron.stop();
		}
		this.crons.clear();

		this.knownFiles.clear();
		log.logInfo("[EventsWatcher] Stopped");
	}

	private debounce(filename: string, fn: () => void): void {
		const existing = this.debounceTimers.get(filename);
		if (existing) clearTimeout(existing);

		this.debounceTimers.set(
			filename,
			setTimeout(() => {
				this.debounceTimers.delete(filename);
				fn();
			}, 100),
		);
	}

	private scanExisting(): void {
		try {
			const files = readdirSync(this.eventsDir).filter((f) => f.endsWith(".json"));
			for (const filename of files) {
				this.handleFile(filename);
			}
		} catch {}
	}

	private handleFileChange(filename: string): void {
		const filePath = join(this.eventsDir, filename);

		if (!existsSync(filePath)) {
			this.handleDelete(filename);
		} else {
			this.cancelScheduled(filename);
			this.handleFile(filename);
		}
	}

	private handleDelete(filename: string): void {
		if (!this.knownFiles.has(filename)) return;
		this.cancelScheduled(filename);
		this.knownFiles.delete(filename);
	}

	private cancelScheduled(filename: string): void {
		const timer = this.timers.get(filename);
		if (timer) {
			clearTimeout(timer);
			this.timers.delete(filename);
		}

		const cron = this.crons.get(filename);
		if (cron) {
			cron.stop();
			this.crons.delete(filename);
		}
	}

	private async handleFile(filename: string): Promise<void> {
		const filePath = join(this.eventsDir, filename);

		try {
			const content = await readFile(filePath, "utf-8");
			const event = this.parseEvent(content, filename);

			if (!event) {
				this.deleteFile(filename);
				return;
			}

			this.knownFiles.add(filename);

			switch (event.type) {
				case "immediate":
					this.handleImmediate(filename, event);
					break;
				case "one-shot":
					this.handleOneShot(filename, event);
					break;
				case "periodic":
					this.handlePeriodic(filename, event);
					break;
			}
		} catch {}
	}

	private parseEvent(content: string, filename: string): ScheduledEvent | null {
		try {
			const data = JSON.parse(content);

			if (!data.type || !data.channelId || !data.text) return null;

			switch (data.type) {
				case "immediate":
					return { type: "immediate", channelId: data.channelId, text: data.text };
				case "one-shot":
					if (!data.at) return null;
					return { type: "one-shot", channelId: data.channelId, text: data.text, at: data.at };
				case "periodic":
					if (!data.schedule || !data.timezone) return null;
					return { type: "periodic", channelId: data.channelId, text: data.text, schedule: data.schedule, timezone: data.timezone };
				default:
					return null;
			}
		} catch {
			return null;
		}
	}

	private handleImmediate(filename: string, event: ScheduledEvent): void {
		const filePath = join(this.eventsDir, filename);

		try {
			const stat = statSync(filePath);
			if (stat.mtimeMs < this.startTime) {
				this.deleteFile(filename);
				return;
			}
		} catch {
			return;
		}

		this.execute(filename, event);
	}

	private handleOneShot(filename: string, event: ScheduledEvent): void {
		if (event.type !== "one-shot") return;

		const atTime = new Date(event.at).getTime();
		const now = Date.now();

		if (atTime <= now) {
			this.deleteFile(filename);
			return;
		}

		const delay = atTime - now;
		const timer = setTimeout(() => {
			this.timers.delete(filename);
			this.execute(filename, event);
		}, delay);

		this.timers.set(filename, timer);
	}

	private handlePeriodic(filename: string, event: ScheduledEvent): void {
		if (event.type !== "periodic") return;

		try {
			const cron = new Cron(event.schedule, { timezone: event.timezone }, () => {
				this.execute(filename, event, false);
			});

			this.crons.set(filename, cron);
		} catch {
			this.deleteFile(filename);
		}
	}

	private async execute(filename: string, event: ScheduledEvent, deleteAfter = true): Promise<void> {
		const startTime = Date.now();

		// 构建 hook 上下文
		const hookContext = {
			eventType: event.type,
			channelId: event.channelId,
			text: event.text,
			eventId: event.type === "one-shot" || event.type === "periodic" ? filename : undefined,
			timestamp: new Date(),
		};

		// 触发 event:trigger hook（可拦截）
		if (this.hookManager?.hasHooks(HOOK_NAMES.EVENT_TRIGGER)) {
			const result = await this.hookManager.emit(HOOK_NAMES.EVENT_TRIGGER, hookContext);
			if (!result.continue) {
				log.logInfo(`[EventsWatcher] Event blocked by hook: ${filename}`);
				if (deleteAfter) {
					this.deleteFile(filename);
				}
				return;
			}
		}

		// 执行事件回调
		let success = true;
		let error: string | undefined;
		try {
			this.onEvent(event.channelId, event.text);
		} catch (e) {
			success = false;
			error = e instanceof Error ? e.message : String(e);
		}

		// 触发 event:triggered hook（通知）
		if (this.hookManager?.hasHooks(HOOK_NAMES.EVENT_TRIGGERED)) {
			await this.hookManager.emit(HOOK_NAMES.EVENT_TRIGGERED, {
				...hookContext,
				success,
				error,
				duration: Date.now() - startTime,
			});
		}

		if (deleteAfter) {
			this.deleteFile(filename);
		}
	}

	private deleteFile(filename: string): void {
		try {
			unlinkSync(join(this.eventsDir, filename));
		} catch {}
		this.knownFiles.delete(filename);
	}
}
