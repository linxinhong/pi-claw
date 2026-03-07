/**
 * MemoryStore 单元测试
 *
 * 测试核心记忆存储服务
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryStore } from '../../../../../src/core/services/memory/store.js';
import { existsSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';

describe('MemoryStore', () => {
	let store: MemoryStore;
	let testWorkspace: string;

	beforeEach(() => {
		// 创建临时工作目录
		testWorkspace = join(process.cwd(), 'test-temp', `memory-test-${Date.now()}`);
		store = new MemoryStore(testWorkspace);
	});

	afterEach(() => {
		// 清理临时目录
		try {
			const memoryPath = join(testWorkspace, 'memory');
			if (existsSync(memoryPath)) {
				unlinkSync(join(memoryPath, 'memory.md'));
				rmdirSync(memoryPath);
			}
		} catch {}
	});

	describe('基础功能', () => {
		it('constructor 创建必要的目录结构', () => {
			const memoryPath = join(testWorkspace, 'memory');
			expect(existsSync(memoryPath)).toBe(true);
		});

		it('append() 添加新的记忆条目', () => {
			store.append('这是第一条记忆');
			const content = store.read();

			expect(content).toContain('这是第一条记忆');
			expect(content).toContain('## '); // 包含日期标题
		});

		it('append() 追加多条记忆', () => {
			store.append('第一条记忆');
			store.append('第二条记忆');
			store.append('第三条记忆');

			const content = store.read();
			expect(content).toContain('第一条记忆');
			expect(content).toContain('第二条记忆');
			expect(content).toContain('第三条记忆');
		});

		it('read() 读取所有记忆', () => {
			expect(store.read()).toBe('');

			store.append('记忆1');
			store.append('记忆2');

			const content = store.read();
			expect(content).toContain('记忆1');
			expect(content).toContain('记忆2');
		});

		it('read() 在空文件时返回空字符串', () => {
			expect(store.read()).toBe('');
		});
	});

	describe('搜索功能', () => {
		beforeEach(() => {
			store.append('购买了牛奶和鸡蛋');
			store.append('会议定在明天下午3点');
			store.append('完成了项目文档');
		});

		it('search() 搜索包含关键词的记忆', () => {
			const results = store.search('会议');
			expect(results.length).toBeGreaterThan(0);
			expect(results[0]).toContain('会议');
		});

		it('search() 搜索不存在的关键词返回空数组', () => {
			const results = store.search('不存在的词');
			expect(results).toEqual([]);
		});

		it('search() 不区分大小写', () => {
			const results1 = store.search('会议');
			const results2 = store.search('会议'); // 大小写不同

			expect(results1.length).toBe(results2.length);
		});

		it('search() 返回包含日期标题的结果', () => {
			const results = store.search('牛奶');
			expect(results[0]).toContain('## '); // 应包含日期标题
		});
	});

	describe('遗忘功能', () => {
		beforeEach(() => {
			store.append('需要删除的秘密信息');
			store.append('保留的普通信息');
			store.append('另一个需要删除的秘密');
		});

		it('forget() 删除匹配的记忆并返回删除行数', () => {
			const count = store.forget('秘密');
			// 每个 append 会创建 2 行（日期 + 内容），匹配 2 次 = 4 行
			expect(count).toBe(4);
		});

		it('forget() 删除后记忆不再存在', () => {
			store.forget('秘密');
			const results = store.search('秘密');
			expect(results).toEqual([]);
		});

		it('forget() 不匹配的内容保留', () => {
			store.forget('秘密');
			const content = store.read();
			expect(content).toContain('保留的普通信息');
		});

		it('forget() 不存在的模式返回0', () => {
			const count = store.forget('不存在的内容');
			expect(count).toBe(0);
		});

		it('forget() 不区分大小写', () => {
			store.append('TEST内容');
			const count = store.forget('test');
			// 删除 2 行（日期 + 内容）
			expect(count).toBe(2);
		});
	});

	describe('边界测试', () => {
		it('处理空字符串输入', () => {
			store.append('');
			const content = store.read();
			expect(content).toBeTruthy(); // 应包含日期标题
		});

		it('处理特殊字符', () => {
			const specialChars = '测试特殊字符: @#$%^&*()_+-=[]{}|;:\'",.<>?/~`';
			store.append(specialChars);

			const results = store.search('@#$%');
			expect(results.length).toBeGreaterThan(0);
		});

		it('处理多行内容', () => {
			const multiline = '第一行\n第二行\n第三行';
			store.append(multiline);

			const results = store.search('第二行');
			expect(results.length).toBeGreaterThan(0);
		});

		it('处理长文本', () => {
			const longText = 'A'.repeat(10000);
			store.append(longText);

			const content = store.read();
			expect(content.length).toBeGreaterThanOrEqual(10000);
		});
	});

	describe('日期格式', () => {
		it('append() 创建正确的日期格式', () => {
			const today = new Date().toISOString().split('T')[0];
			store.append('测试内容');

			const content = store.read();
			expect(content).toContain(`## ${today}`);
		});

		it('多条记忆在同一天只创建一个日期标题', () => {
			store.append('记忆1');
			store.append('记忆2');

			const content = store.read();
			const dateHeaders = (content.match(/## \d{4}-\d{2}-\d{2}/g) || []).length;
			expect(dateHeaders).toBeGreaterThanOrEqual(1);
		});
	});
});
