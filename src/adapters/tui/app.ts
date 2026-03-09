/**
 * Pi Claw TUI Application
 *
 * TUI 主应用类
 */

import {
	TUI,
	ProcessTerminal,
	Container,
	matchesKey,
	Key,
	truncateToWidth,
} from "@mariozechner/pi-tui";
import type { Focusable } from "@mariozechner/pi-tui";
import type { TUIEvent, TUIEventListener, ChatMessage } from "./types.js";
import { darkTheme } from "./theme.js";
import type { TUITheme } from "./types.js";

// ============================================================================
// Types
// ============================================================================

interface PiClawTUIConfig {
	/** 工作目录 */
	workingDir?: string;
	/** 配置文件路径 */
	configPath?: string;
	/** 主题 */
	theme?: TUITheme;
}

// ============================================================================
// Chat Panel Component
// ============================================================================

class ChatPanel extends Container implements Focusable {
	private tui: TUI;
	private theme: TUITheme;
	private messages: ChatMessage[] = [];
	private currentChannelId = "default";
	private inputBuffer = "";
	private cursorPos = 0;
	public focused = false;
	public onSendMessage?: (content: string, channelId: string) => void;
	public onCommand?: (command: string, args: string) => void;

	constructor(tui: TUI, theme: TUITheme) {
		super();
		this.tui = tui;
		this.theme = theme;
	}

	addMessage(message: ChatMessage): void {
		this.messages.push(message);
		this.tui.requestRender();
	}

	clearMessages(): void {
		this.messages = [];
		this.tui.requestRender();
	}

	getCurrentChannel(): string {
		return this.currentChannelId;
	}

	setChannel(channelId: string): void {
		this.currentChannelId = channelId;
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.enter)) {
			if (this.inputBuffer.trim()) {
				const input = this.inputBuffer.trim();

				// 检查是否是命令（以 / 开头）
				if (input.startsWith("/")) {
					const parts = input.slice(1).split(" ");
					const command = parts[0].toLowerCase();
					const args = parts.slice(1).join(" ");
					this.onCommand?.(command, args);
				} else {
					this.onSendMessage?.(input, this.currentChannelId);
				}

				this.inputBuffer = "";
				this.cursorPos = 0;
			}
		} else if (matchesKey(data, Key.backspace)) {
			if (this.cursorPos > 0) {
				this.inputBuffer = this.inputBuffer.slice(0, this.cursorPos - 1) + this.inputBuffer.slice(this.cursorPos);
				this.cursorPos--;
			}
		} else if (matchesKey(data, Key.delete)) {
			if (this.cursorPos < this.inputBuffer.length) {
				this.inputBuffer = this.inputBuffer.slice(0, this.cursorPos) + this.inputBuffer.slice(this.cursorPos + 1);
			}
		} else if (matchesKey(data, Key.left)) {
			this.cursorPos = Math.max(0, this.cursorPos - 1);
		} else if (matchesKey(data, Key.right)) {
			this.cursorPos = Math.min(this.inputBuffer.length, this.cursorPos + 1);
		} else if (data.length === 1 && data.charCodeAt(0) >= 32) {
			this.inputBuffer = this.inputBuffer.slice(0, this.cursorPos) + data + this.inputBuffer.slice(this.cursorPos);
			this.cursorPos++;
		}
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const inputHeight = 3;
		const headerHeight = 2;
		const availableHeight = process.stdout.rows || 24;
		const messageHeight = availableHeight - inputHeight - headerHeight - 4;

		// Header
		const headerLine = this.theme.primary(`  [Chat] Channel: ${this.currentChannelId}`);
		lines.push(truncateToWidth(headerLine, width));
		lines.push(this.theme.muted("  " + "─".repeat(Math.min(width - 2, 60))));

		// Messages (show last N messages that fit)
		const visibleMessages = this.messages.slice(-messageHeight);
		for (const msg of visibleMessages) {
			const time = msg.timestamp.toLocaleTimeString();
			const roleColor = msg.role === "user" ? this.theme.info : this.theme.success;
			const roleLabel = msg.role === "user" ? "You" : "AI";

			lines.push(this.theme.muted(`  [${time}]`) + " " + roleColor(`${roleLabel}:`));

			// Wrap message content
			const contentLines = this.wrapText(msg.content, width - 4);
			for (const line of contentLines) {
				lines.push(`    ${line}`);
			}
			lines.push("");
		}

		// Fill remaining space
		while (lines.length < messageHeight + headerHeight) {
			lines.push("");
		}

		// Input area
		lines.push(this.theme.muted("  " + "─".repeat(Math.min(width - 2, 60))));
		const prompt = this.theme.primary("  > ");
		const inputLine = this.inputBuffer || this.theme.muted("Type a message...");
		lines.push(prompt + inputLine);

		// Cursor indicator
		if (this.focused) {
			const cursorLine = " ".repeat(4 + this.cursorPos) + this.theme.primary("^");
			lines.push(cursorLine);
		}

		return lines;
	}

	private wrapText(text: string, maxWidth: number): string[] {
		const lines: string[] = [];
		const paragraphs = text.split("\n");

		for (const para of paragraphs) {
			if (para.length === 0) {
				lines.push("");
				continue;
			}

			let currentLine = "";
			const words = para.split(" ");

			for (const word of words) {
				if (currentLine.length + word.length + 1 <= maxWidth) {
					currentLine += (currentLine ? " " : "") + word;
				} else {
					if (currentLine) lines.push(currentLine);
					currentLine = word;
				}
			}
			if (currentLine) lines.push(currentLine);
		}

		return lines;
	}
}

// ============================================================================
// Main TUI Application
// ============================================================================

export class PiClawTUI {
	private tui: TUI | null = null;
	private terminal: ProcessTerminal | null = null;
	private config: PiClawTUIConfig;
	private theme: TUITheme;
	private listeners: TUIEventListener[] = [];
	private running = false;

	// Panels
	private chatPanel: ChatPanel | null = null;

	constructor(config: PiClawTUIConfig = {}) {
		this.config = config;
		this.theme = config.theme || darkTheme;
	}

	/**
	 * 启动 TUI
	 */
	async start(): Promise<void> {
		console.log("[TUI] Initializing terminal...");
		this.terminal = new ProcessTerminal();
		console.log("[TUI] Creating TUI instance...");
		this.tui = new TUI(this.terminal);

		// Start main loop first (needed for rendering and input)
		this.running = true;
		console.log("[TUI] Starting main loop...");
		this.tui.start();

		// Show main panel directly
		console.log("[TUI] Showing chat panel...");
		this.showMainPanel();
	}

	/**
	 * 显示主面板
	 */
	private showMainPanel(): void {
		if (!this.tui) return;

		this.chatPanel = new ChatPanel(this.tui, this.theme);
		this.chatPanel.onSendMessage = (content, channelId) => {
			this.emit({ type: "message-send", content, channelId });
		};
		this.chatPanel.onCommand = (command, args) => {
			this.handleCommand(command, args);
		};
		this.tui.addChild(this.chatPanel);
		this.tui.setFocus(this.chatPanel);
	}

	/**
	 * 停止 TUI
	 */
	stop(): void {
		this.running = false;
		if (this.tui) {
			this.tui.stop();
			this.tui = null;
		}
		this.terminal = null;
	}

	/**
	 * 添加事件监听器
	 */
	addEventListener(listener: TUIEventListener): () => void {
		this.listeners.push(listener);
		return () => {
			const index = this.listeners.indexOf(listener);
			if (index >= 0) {
				this.listeners.splice(index, 1);
			}
		};
	}

	/**
	 * 发送事件
	 */
	private emit(event: TUIEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (error) {
				console.error("TUI event listener error:", error);
			}
		}
	}

	/**
	 * 处理命令
	 */
	private handleCommand(command: string, args: string): void {
		switch (command) {
			case "exit":
			case "quit":
			case "q":
				this.emit({ type: "exit" });
				break;
			case "clear":
				this.chatPanel?.clearMessages();
				break;
			case "help":
				this.addChatMessage({
					id: `help-${Date.now()}`,
					role: "system",
					content: "Available commands:\n  /exit - Exit TUI\n  /clear - Clear messages\n  /help - Show this help",
					timestamp: new Date(),
					channelId: this.chatPanel?.getCurrentChannel() || "default",
				});
				break;
			default:
				this.addChatMessage({
					id: `unknown-${Date.now()}`,
					role: "system",
					content: `Unknown command: /${command}. Type /help for available commands.`,
					timestamp: new Date(),
					channelId: this.chatPanel?.getCurrentChannel() || "default",
				});
		}
	}

	// ============================================================================
	// Public API
	// ============================================================================

	/**
	 * 添加聊天消息
	 */
	addChatMessage(message: ChatMessage): void {
		this.chatPanel?.addMessage(message);
	}

	/**
	 * 请求重新渲染
	 */
	requestRender(): void {
		this.tui?.requestRender();
	}
}
