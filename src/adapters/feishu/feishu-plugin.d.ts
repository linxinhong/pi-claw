/**
 * Type declarations for @larksuiteoapi/feishu-openclaw-plugin submodules
 *
 * These are re-exports from the main package, split for use without openclaw dependency.
 */

declare module "@larksuiteoapi/feishu-openclaw-plugin/src/messaging/outbound/deliver.js" {
	export interface SendTextLarkParams {
		cfg: Record<string, unknown>;
		to: string;
		text: string;
	}

	export interface SendCardLarkParams {
		cfg: Record<string, unknown>;
		to: string;
		card: Record<string, unknown>;
	}

	export interface SendMediaLarkParams {
		cfg: Record<string, unknown>;
		to: string;
		fileKey: string;
		fileType?: string;
	}

	export interface SendResult {
		messageId: string;
	}

	export function sendTextLark(params: SendTextLarkParams): Promise<SendResult>;
	export function sendCardLark(params: SendCardLarkParams): Promise<SendResult>;
	export function sendMediaLark(params: SendMediaLarkParams): Promise<SendResult>;
}

declare module "@larksuiteoapi/feishu-openclaw-plugin/src/messaging/outbound/send.js" {
	export interface SendMessageParams {
		cfg: Record<string, unknown>;
		messageId: string;
		content: Record<string, unknown>;
	}

	export interface SendCardParams {
		cfg: Record<string, unknown>;
		messageId: string;
		card: Record<string, unknown>;
	}

	export interface SendImageParams {
		cfg: Record<string, unknown>;
		to: string;
		imageKey: string;
	}

	export function sendMessageFeishu(params: SendMessageParams): Promise<void>;
	export function sendCardFeishu(params: SendCardParams): Promise<void>;
	export function updateCardFeishu(params: {
		cfg: Record<string, unknown>;
		messageId: string;
		card: Record<string, unknown>;
	}): Promise<void>;
	export function editMessageFeishu(params: SendMessageParams): Promise<void>;
	export function sendImageLark(params: SendImageParams): Promise<{ messageId: string }>;
}

declare module "@larksuiteoapi/feishu-openclaw-plugin/src/channel/probe.js" {
	export interface ProbeResult {
		ok: boolean;
		error?: string;
		botName?: string;
		botOpenId?: string;
	}

	export function probeFeishu(cfg: Record<string, unknown>): Promise<ProbeResult>;
}

declare module "@larksuiteoapi/feishu-openclaw-plugin/src/messaging/inbound/parse.js" {
	export interface MentionInfo {
		key: string;
		openId: string;
		name: string;
		isBot: boolean;
	}

	export interface MessageContext {
		messageId: string;
		senderId: string;
		chatId: string;
		chatType: string;
		contentType: string;
		content: string;
		createTime?: number;
		mentions: MentionInfo[];
	}

	export function parseMessageEvent(
		event: unknown,
		botOpenId: string
	): Promise<MessageContext>;
}

declare module "@larksuiteoapi/feishu-openclaw-plugin/src/messaging/inbound/mention.js" {
	export interface MentionInfo {
		key: string;
		openId: string;
		name: string;
		isBot: boolean;
	}

	export function mentionedBot(context: { mentions: MentionInfo[] }): boolean;
	export function nonBotMentions(context: { mentions: MentionInfo[] }): MentionInfo[];
}
