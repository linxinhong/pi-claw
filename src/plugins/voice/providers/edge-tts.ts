/**
 * Edge TTS Provider
 *
 * 使用微软 Edge 在线 TTS 服务（免费）
 * 基于 edge-tts 库实现
 */

import type { TTSProvider, TTSOptions, TTSResult, TTSVoice } from "../types.js";
import { writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// ============================================================================
// Edge TTS Implementation
// ============================================================================

/**
 * Edge TTS 提供商
 *
 * 使用微软 Edge 浏览器的在线 TTS 服务，免费且质量较高
 */
export class EdgeTTS implements TTSProvider {
	readonly name = "edge";

	// 常用中文音色
	readonly voices: TTSVoice[] = [
		{ id: "zh-CN-XiaoxiaoNeural", name: "晓晓", gender: "female", language: "zh-CN", description: "活泼、温暖" },
		{ id: "zh-CN-YunyangNeural", name: "云扬", gender: "male", language: "zh-CN", description: "专业、正式" },
		{ id: "zh-CN-XiaoyiNeural", name: "晓伊", gender: "female", language: "zh-CN", description: "温柔、亲切" },
		{ id: "zh-CN-YunjianNeural", name: "云健", gender: "male", language: "zh-CN", description: "解说、旁白" },
		{ id: "zh-TW-HsiaoChenNeural", name: "曉臻", gender: "female", language: "zh-TW", description: "台湾口音" },
		{ id: "zh-HK-HiuMaanNeural", name: "曉曼", gender: "female", language: "zh-HK", description: "香港口音" },
	];

	/**
	 * 合成语音
	 */
	async synthesize(options: TTSOptions): Promise<TTSResult> {
		const {
			text,
			voice = "zh-CN-XiaoxiaoNeural",
			speed = 1.0,
			pitch = 1.0,
			volume = 1.0,
			outputPath,
			format = "mp3",
		} = options;

		// 检查 edge-tts 是否可用
		if (!(await this.isAvailable())) {
			throw new Error(
				"Edge TTS requires 'edge-tts' CLI. Install it with:\n" +
				"  pip install edge-tts"
			);
		}

		// 生成输出路径
		const outputFile = outputPath || this.generateTempPath(format);

		// 构建 edge-tts 命令参数
		const args = [
			"--voice", voice,
			"--text", text,
			"--write-media", outputFile,
		];

		// 语速调整 (edge-tts 使用百分比: -50% 到 +50%)
		if (speed !== 1.0) {
			const ratePercent = Math.round((speed - 1) * 100);
			args.push("--rate", `${ratePercent > 0 ? "+" : ""}${ratePercent}%`);
		}

		// 音调调整
		if (pitch !== 1.0) {
			const pitchPercent = Math.round((pitch - 1) * 100);
			args.push("--pitch", `${pitchPercent > 0 ? "+" : ""}${pitchPercent}Hz`);
		}

		// 执行 edge-tts 命令
		const { spawn } = await import("child_process");
		await new Promise<void>((resolve, reject) => {
			const proc = spawn("edge-tts", args, { stdio: ["ignore", "pipe", "pipe"] });
			
			let stderr = "";
			proc.stderr?.on("data", (data) => {
				stderr += data.toString();
			});

			proc.on("close", (code) => {
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`edge-tts failed with code ${code}: ${stderr}`));
				}
			});

			proc.on("error", (err) => {
				reject(new Error(`Failed to spawn edge-tts: ${err.message}`));
			});
		});

		// 估算音频时长（粗略计算：文本长度 / 语速）
		const estimatedDuration = this.estimateDuration(text, speed);

		return {
			audioPath: outputFile,
			duration: estimatedDuration,
			format,
		};
	}

	/**
	 * 检查 edge-tts 是否可用
	 */
	private async isAvailable(): Promise<boolean> {
		try {
			const { exec } = await import("child_process");
			return await new Promise((resolve) => {
				exec("which edge-tts", (error) => {
					resolve(!error);
				});
			});
		} catch {
			return false;
		}
	}

	/**
	 * 生成临时文件路径
	 */
	private generateTempPath(format: string): string {
		const timestamp = Date.now();
		const random = Math.random().toString(36).substring(2, 10);
		return join(tmpdir(), `edge-tts-${timestamp}-${random}.${format}`);
	}

	/**
	 * 估算音频时长（毫秒）
	 *
	 * 粗略估算：中文约 4 字/秒，英文约 13 字符/秒
	 */
	private estimateDuration(text: string, speed: number): number {
		// 计算中文字符数
		const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
		// 计算英文单词数（近似）
		const englishWords = text.split(/\s+/).filter(w => /[a-zA-Z]/.test(w)).length;
		
		// 基础时长计算（毫秒）
		const chineseMs = chineseChars * 250; // 每个中文字 250ms
		const englishMs = englishWords * 400; // 每个英文单词 400ms
		
		// 应用语速调整
		const baseDuration = chineseMs + englishMs;
		const adjustedDuration = baseDuration / speed;
		
		// 添加最小缓冲
		return Math.max(adjustedDuration, 1000);
	}
}
