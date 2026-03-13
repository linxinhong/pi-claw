/**
 * Whisper STT Provider
 *
 * 使用 OpenAI Whisper 或本地 whisper.cpp 进行语音识别
 */

import type { STTProvider, STTOptions, STTResult, STTSegment } from "../../../core/voice/types.js";

// ============================================================================
// Whisper STT Implementation
// ============================================================================

/**
 * Whisper STT 提供商
 *
 * 支持多种实现方式：
 * 1. OpenAI API（云端）
 * 2. whisper.cpp（本地，需要编译）
 * 3. faster-whisper（Python，本地运行）
 */
export class WhisperSTT implements STTProvider {
	readonly name = "whisper";
	readonly languages = ["zh", "en", "ja", "ko", "de", "fr", "es", "it", "ru"];

	/** API Key（如果使用 OpenAI API） */
	private apiKey?: string;
	/** 本地 whisper 可执行文件路径 */
	private whisperPath?: string;
	/** 模型路径 */
	private modelPath?: string;

	constructor(options?: {
		apiKey?: string;
		whisperPath?: string;
		modelPath?: string;
	}) {
		this.apiKey = options?.apiKey;
		this.whisperPath = options?.whisperPath;
		this.modelPath = options?.modelPath;
	}

	/**
	 * 识别音频
	 */
	async transcribe(options: STTOptions): Promise<STTResult> {
		const { audioPath, language = "zh", punctuation = true } = options;

		// 优先使用本地 whisper.cpp
		if (await this.hasLocalWhisper()) {
			return this.transcribeWithLocal(audioPath, language, punctuation);
		}

		// 其次使用 OpenAI API
		if (this.apiKey) {
			return this.transcribeWithAPI(audioPath, language);
		}

		throw new Error(
			"Whisper STT requires either:\n" +
			"1. Local whisper.cpp binary (set whisperPath)\n" +
			"2. OpenAI API key (set apiKey)\n\n" +
			"To install whisper.cpp:\n" +
			"  git clone https://github.com/ggerganov/whisper.cpp.git\n" +
			"  cd whisper.cpp && make"
		);
	}

	/**
	 * 使用本地 whisper.cpp 识别
	 */
	private async transcribeWithLocal(
		audioPath: string,
		language: string,
		punctuation: boolean,
	): Promise<STTResult> {
		const whisperBin = this.whisperPath || "whisper-cpp";
		const model = this.modelPath || "models/ggml-base.bin";

		const args = [
			"-m", model,
			"-f", audioPath,
			"-l", language,
			"--output-json",
			"--no-timestamps",
		];

		if (!punctuation) {
			args.push("--no-timestamps");
		}

		const { spawn } = await import("child_process");
		return new Promise((resolve, reject) => {
			const proc = spawn(whisperBin, args, { stdio: ["ignore", "pipe", "pipe"] });
			
			let stdout = "";
			let stderr = "";

			proc.stdout?.on("data", (data) => {
				stdout += data.toString();
			});

			proc.stderr?.on("data", (data) => {
				stderr += data.toString();
			});

			proc.on("close", (code) => {
				if (code === 0) {
					try {
						// 解析输出文本
						const text = this.extractTextFromOutput(stdout, stderr);
						resolve({ text });
					} catch (err) {
						reject(new Error(`Failed to parse whisper output: ${err}`));
					}
				} else {
					reject(new Error(`whisper.cpp failed with code ${code}: ${stderr}`));
				}
			});

			proc.on("error", (err) => {
				reject(new Error(`Failed to spawn whisper: ${err.message}`));
			});
		});
	}

	/**
	 * 使用 OpenAI API 识别
	 */
	private async transcribeWithAPI(audioPath: string, language: string): Promise<STTResult> {
		const fs = await import("fs");
		const path = await import("path");
		
		// 读取音频文件
		const audioBuffer = fs.readFileSync(audioPath);
		const fileName = path.basename(audioPath);
		
		// 构建 multipart/form-data 请求体
		const boundary = `----VoiceFormBoundary${Date.now().toString(36)}`;
		const chunks: Buffer[] = [];
		
		// file 字段
		chunks.push(Buffer.from(`--${boundary}\r\n`));
		chunks.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`));
		chunks.push(Buffer.from(`Content-Type: audio/mpeg\r\n\r\n`));
		chunks.push(audioBuffer);
		chunks.push(Buffer.from(`\r\n`));
		
		// model 字段
		chunks.push(Buffer.from(`--${boundary}\r\n`));
		chunks.push(Buffer.from(`Content-Disposition: form-data; name="model"\r\n\r\n`));
		chunks.push(Buffer.from("whisper-1\r\n"));
		
		// language 字段
		chunks.push(Buffer.from(`--${boundary}\r\n`));
		chunks.push(Buffer.from(`Content-Disposition: form-data; name="language"\r\n\r\n`));
		chunks.push(Buffer.from(`${language}\r\n`));
		
		// response_format 字段
		chunks.push(Buffer.from(`--${boundary}\r\n`));
		chunks.push(Buffer.from(`Content-Disposition: form-data; name="response_format"\r\n\r\n`));
		chunks.push(Buffer.from("json\r\n"));
		
		// 结束边界
		chunks.push(Buffer.from(`--${boundary}--\r\n`));
		
		const body = Buffer.concat(chunks);

		const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": `multipart/form-data; boundary=${boundary}`,
				"Content-Length": body.length.toString(),
			},
			body: body as any,
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(`OpenAI API error: ${error}`);
		}

		const result = await response.json() as {
			text?: string;
			segments?: Array<{
				text: string;
				start: number;
				end: number;
				avg_logprob?: number;
			}>;
		};
		return {
			text: result.text || "",
			segments: result.segments?.map((s) => ({
				text: s.text,
				startTime: Math.round(s.start * 1000),
				endTime: Math.round(s.end * 1000),
				confidence: s.avg_logprob ? Math.exp(s.avg_logprob) : undefined,
			})),
		};
	}

	/**
	 * 检查是否有本地 whisper
	 */
	private async hasLocalWhisper(): Promise<boolean> {
		if (!this.whisperPath) {
			return false;
		}
		try {
			const { exec } = await import("child_process");
			return await new Promise((resolve) => {
				exec(`test -x ${this.whisperPath}`, (error) => {
					resolve(!error);
				});
			});
		} catch {
			return false;
		}
	}

	/**
	 * 从输出中提取文本
	 */
	private extractTextFromOutput(stdout: string, stderr: string): string {
		// whisper.cpp 的输出在 stderr
		const lines = stderr.split("\n");
		const textLines: string[] = [];

		for (const line of lines) {
			// 匹配输出格式：[00:00:00.000 --> 00:00:05.000] 文本内容
			const match = line.match(/\[.*?\]\s*(.+)/);
			if (match) {
				textLines.push(match[1].trim());
			}
		}

		return textLines.join(" ").trim();
	}
}
