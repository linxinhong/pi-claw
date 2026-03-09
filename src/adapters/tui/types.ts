/**
 * TUI Types
 *
 * TUI 相关的类型定义
 */

import type { Component } from "@mariozechner/pi-tui";

// ============================================================================
// 消息类型
// ============================================================================

/**
 * 聊天消息
 */
export interface ChatMessage {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: Date;
	channelId: string;
	/** 是否正在处理中 */
	processing?: boolean;
}

/**
 * 日志消息
 */
export interface LogMessage {
	id: string;
	level: "info" | "warn" | "error" | "debug";
	message: string;
	timestamp: Date;
	source?: string;
}

// ============================================================================
// 状态类型
// ============================================================================

/**
 * Adapter 状态
 */
export interface AdapterStatus {
	name: string;
	type: string;
	status: "running" | "stopped" | "error";
	channels: number;
	messages: number;
	lastMessage?: Date;
	error?: string;
}

/**
 * 频道状态
 */
export interface ChannelStatus {
	id: string;
	name: string;
	type: "private" | "group";
	status: "active" | "idle" | "processing";
	messageCount: number;
	lastMessage?: Date;
	model?: string;
}

// ============================================================================
// 配置类型
// ============================================================================

/**
 * 配置项
 */
export interface ConfigItem {
	id: string;
	label: string;
	description?: string;
	value: string | number | boolean;
	values?: (string | number | boolean)[];
	type: "string" | "number" | "boolean" | "select";
}

// ============================================================================
// 主题类型
// ============================================================================

/**
 * TUI 主题
 */
export interface TUITheme {
	// 颜色
	primary: (text: string) => string;
	secondary: (text: string) => string;
	success: (text: string) => string;
	warning: (text: string) => string;
	error: (text: string) => string;
	info: (text: string) => string;
	muted: (text: string) => string;

	// 背景
	bgPrimary: (text: string) => string;
	bgSecondary: (text: string) => string;

	// 边框
	border: (text: string) => string;
	borderActive: (text: string) => string;

	// Markdown 组件主题
	markdown: {
		heading: (text: string) => string;
		link: (text: string) => string;
		linkUrl: (text: string) => string;
		code: (text: string) => string;
		codeBlock: (text: string) => string;
		codeBlockBorder: (text: string) => string;
		quote: (text: string) => string;
		quoteBorder: (text: string) => string;
		hr: (text: string) => string;
		listBullet: (text: string) => string;
		bold: (text: string) => string;
		italic: (text: string) => string;
		strikethrough: (text: string) => string;
		underline: (text: string) => string;
	};

	// SelectList 主题
	selectList: {
		selectedPrefix: (text: string) => string;
		selectedText: (text: string) => string;
		description: (text: string) => string;
		scrollInfo: (text: string) => string;
		noMatch: (text: string) => string;
	};

	// Editor 主题
	editor: {
		borderColor: (text: string) => string;
		selectList: {
			selectedPrefix: (text: string) => string;
			selectedText: (text: string) => string;
			description: (text: string) => string;
			scrollInfo: (text: string) => string;
			noMatch: (text: string) => string;
		};
	};

	// SettingsList 主题
	settingsList: {
		label: (text: string, selected: boolean) => string;
		value: (text: string, selected: boolean) => string;
		description: (text: string) => string;
		cursor: string;
		hint: (text: string) => string;
	};
}

// ============================================================================
// 面板接口
// ============================================================================

/**
 * 面板接口
 */
export interface Panel extends Component {
	/** 面板名称 */
	readonly name: string;

	/** 显示面板 */
	show(): void;

	/** 隐藏面板 */
	hide(): void;

	/** 是否可见 */
	isVisible(): boolean;

	/** 刷新面板 */
	refresh(): void;
}

// ============================================================================
// 事件类型
// ============================================================================

/**
 * TUI 事件
 */
export type TUIEvent =
	| { type: "channel-select"; channelId: string }
	| { type: "message-send"; content: string; channelId: string }
	| { type: "config-change"; key: string; value: unknown }
	| { type: "adapter-status"; status: AdapterStatus }
	| { type: "exit" };

/**
 * TUI 事件监听器
 */
export type TUIEventListener = (event: TUIEvent) => void | Promise<void>;
