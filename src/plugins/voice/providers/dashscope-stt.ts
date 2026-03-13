/**
 * DashScope STT Provider
 *
 * 阿里云 DashScope Qwen-ASR 语音识别
 * API Docs: https://help.aliyun.com/zh/model-studio/developer-reference/qwen-asr
 */

import type { STTProvider, STTOptions, STTResult } from "../types.js";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import OpenAI from "openai";

interface ModelsConfig {
	providers?: {
		dashscope?: { apiKey?: string };
		aliyun?: { apiKey?: string; baseUrl?: string };
		bailian?: { apiKey?: string };
	};
}

export class DashScopeSTT implements STTProvider {
	name = "dashscope";
	languages = ["zh", "en", "ja", "ko", "fr", "de", "es", "ru"];

	/**
	 * 获取配置
	 */
	private getConfig(): { apiKey: string; baseUrl: string } {
		// 1. 环境变量 DASHSCOPE_API_KEY
		const envKey = process.env.DASHSCOPE_API_KEY;
		if (envKey) {
			return {
				apiKey: envKey,
				baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
			};
		}

		// 2. 环境变量 ALIYUN_API_KEY
		const aliyunEnvKey = process.env.ALIYUN_API_KEY;
		if (aliyunEnvKey) {
			return {
				apiKey: aliyunEnvKey,
				baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
			};
		}

		// 3. 从 models.json 读取
		try {
			const modelsPath = join(homedir(), ".pi", "agent", "models.json");
			if (existsSync(modelsPath)) {
				const content = readFileSync(modelsPath, "utf-8");
				const config = JSON.parse(content) as ModelsConfig;

				const dashscopeKey = config?.providers?.dashscope?.apiKey;
				if (dashscopeKey) {
					return {
						apiKey: dashscopeKey,
						baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
					};
				}

				const aliyunConfig = config?.providers?.aliyun;
				if (aliyunConfig?.apiKey) {
					return {
						apiKey: aliyunConfig.apiKey,
						baseUrl: aliyunConfig.baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1",
					};
				}

				const bailianKey = config?.providers?.bailian?.apiKey;
				if (bailianKey) {
					return {
						apiKey: bailianKey,
						baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
					};
				}
			}
		} catch {
			// ignore
		}

		return { apiKey: "", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" };
	}

	/**
	 * 将音频文件编码为 base64
	 */
	private encodeAudioFile(filePath: string): string {
		const buffer = readFileSync(filePath);
		return buffer.toString("base64");
	}

	async transcribe(options: STTOptions): Promise<STTResult> {
		const config = this.getConfig();
		if (!config.apiKey) {
			throw new Error(
				"No API key found for DashScope STT. Set DASHSCOPE_API_KEY environment variable or configure in models.json"
			);
		}

		// 检查文件是否存在
		if (!existsSync(options.audioPath)) {
			throw new Error(`Audio file not found: ${options.audioPath}`);
		}

		// 编码音频文件
		const audioDataBase64 = this.encodeAudioFile(options.audioPath);

		// 使用 OpenAI 兼容 API 调用 DashScope
		const client = new OpenAI({
			apiKey: config.apiKey,
			baseURL: config.baseUrl,
		});

		const language = options.language === "en" ? "en" : "zh";

		const completion = await client.chat.completions.create({
			model: "qwen3-asr-flash",
			messages: [
				{
					role: "user",
					content: [
						{
							type: "input_audio",
							input_audio: {
								data: `data:audio/opus;base64,${audioDataBase64}`,
							},
						},
					],
				},
			] as any,
			extra_body: {
				asr_options: {
					language,
					enable_itn: false,
				},
			},
		} as any);

		const text = completion.choices[0].message.content || "";

		return {
			text,
			confidence: 0.95, // DashScope 不返回置信度，使用固定值
		};
	}
}
