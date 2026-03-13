/**
 * DashScope TTS Provider
 *
 * 阿里云 DashScope Qwen3-TTS 语音合成
 * API Docs: https://help.aliyun.com/zh/model-studio/developer-reference/qwen-tts
 */

import type { TTSProvider, TTSOptions, TTSResult, TTSVoice } from "../types.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";

const TTS_API_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
// 使用标准 TTS 模型（非 instruct 版本更简单，不需要 instructions 参数）
const TTS_MODEL = "qwen3-tts-flash";

interface ModelsConfig {
	providers?: {
		dashscope?: { apiKey?: string };
		aliyun?: { apiKey?: string; baseUrl?: string };
		bailian?: { apiKey?: string };
	};
}

interface TTSConfig {
	tts?: {
		defaultVoice?: string;
	};
}

export class DashScopeTTS implements TTSProvider {
	name = "dashscope";
	voices: TTSVoice[] = [
		{ id: "Cherry", name: "樱桃", description: "活泼女声" },
		{ id: "Serena", name: "塞雷娜", description: "温柔女声" },
		{ id: "Ethan", name: "伊桑", description: "成熟男声" },
		{ id: "Chelsie", name: "切尔茜", description: "知性女声" },
	];

	/**
	 * 获取 API Key
	 */
	private getApiKey(): string | null {
		// 1. 环境变量 DASHSCOPE_API_KEY
		const envKey = process.env.DASHSCOPE_API_KEY;
		if (envKey) return envKey;

		// 2. 环境变量 ALIYUN_API_KEY
		const aliyunEnvKey = process.env.ALIYUN_API_KEY;
		if (aliyunEnvKey) return aliyunEnvKey;

		// 3. 从 models.json 读取
		try {
			const modelsPath = join(homedir(), ".pi", "agent", "models.json");
			if (existsSync(modelsPath)) {
				const content = readFileSync(modelsPath, "utf-8");
				const config = JSON.parse(content) as ModelsConfig;

				const dashscopeKey = config?.providers?.dashscope?.apiKey;
				if (dashscopeKey) return dashscopeKey;

				const aliyunKey = config?.providers?.aliyun?.apiKey;
				if (aliyunKey) return aliyunKey;

				const bailianKey = config?.providers?.bailian?.apiKey;
				if (bailianKey) return bailianKey;
			}
		} catch {
			// ignore
		}

		return null;
	}

	/**
	 * 获取默认音色
	 */
	private getDefaultVoice(): string {
		try {
			const configPath = join(homedir(), ".pi-claw", "config.json");
			if (existsSync(configPath)) {
				const content = readFileSync(configPath, "utf-8");
				const config = JSON.parse(content) as TTSConfig;
				return config?.tts?.defaultVoice || "Cherry";
			}
		} catch {
			// ignore
		}
		return "Cherry";
	}

	async synthesize(options: TTSOptions): Promise<TTSResult> {
		const apiKey = this.getApiKey();
		if (!apiKey) {
			throw new Error(
				"No API key found for DashScope TTS. Set DASHSCOPE_API_KEY environment variable or configure in models.json"
			);
		}

		const voice = options.voice || this.getDefaultVoice();
		const text = options.text;

		if (!text || text.length === 0) {
			throw new Error("Text is required for TTS");
		}

		// 调用 DashScope TTS API
		// 根据文档：https://help.aliyun.com/zh/model-studio/qwen-tts
		// voice 和 language_type 应该在 input 中，不是 parameters
		const requestBody: any = {
			model: TTS_MODEL,
			input: {
				text,
				voice,
				language_type: "Auto", // 自动检测语言
			},
		};
		
		// 只有 instruct 模型才使用 instructions 参数
		if (TTS_MODEL.includes("instruct") && options.speed) {
			requestBody.parameters = {
				instructions: `语速${options.speed > 1.0 ? "加快" : "减慢"}到${Math.round(options.speed * 100)}%`,
				optimize_instructions: true,
			};
		}
		
		const response = await fetch(TTS_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${apiKey}`,
			},
			body: JSON.stringify(requestBody),
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`[DashScope TTS] API error (${response.status}): ${errorText}`);
			throw new Error(`DashScope TTS API error (${response.status}): ${errorText}`);
		}

		const result = (await response.json()) as {
			output?: { audio?: string | { url: string } };
			message?: string;
		};

		const audioData = result?.output?.audio;
		if (!audioData) {
			throw new Error(`TTS API returned no audio: ${result?.message || "Unknown error"}`);
		}

		// 确定输出路径（DashScope 只返回 wav 格式，即使请求 opus）
		const outputPath = options.outputPath 
			? options.outputPath.replace(/\.opus$/i, ".wav")
			: join(homedir(), ".pi-claw", "scratch", `tts-${Date.now()}.wav`);
		
		// 确保目录存在
		const outputDir = dirname(outputPath);
		if (!existsSync(outputDir)) {
			mkdirSync(outputDir, { recursive: true });
		}

		let audioBuffer: Buffer;

		if (typeof audioData === "object" && audioData.url) {
			// 从 URL 下载
			const audioResponse = await fetch(audioData.url);
			if (!audioResponse.ok) {
				throw new Error(`Failed to download audio: ${audioResponse.status}`);
			}
			audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
		} else if (typeof audioData === "string") {
			// Base64 解码
			audioBuffer = Buffer.from(audioData, "base64");
		} else {
			throw new Error("Unexpected audio format from TTS API");
		}

		writeFileSync(outputPath, audioBuffer);

		// 估算时长（假设 24kHz 采样率，16bit，单声道）
		// WAV 文件头 44 字节，每分钟约 2.88MB
		const durationMs = Math.round((audioBuffer.length / (24000 * 2)) * 1000);

		return {
			audioPath: outputPath,
			duration: durationMs,
			format: options.format || "wav",
		};
	}
}
