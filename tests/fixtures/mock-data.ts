/**
 * Mock 数据集合
 *
 * 按数据类型分段，每段包含工厂函数和静态示例
 */

// ============================================================================
// 1. 用户数据
// ============================================================================

export interface MockUser {
  id: string;
  userName: string;
  displayName: string;
  email?: string;
  avatar?: string;
}

export const mockUsers = {
  normal: {
    id: 'ou_user_001',
    userName: 'zhangsan',
    displayName: '张三',
    email: 'zhangsan@example.com',
  },
  admin: {
    id: 'ou_admin_001',
    userName: 'admin',
    displayName: '管理员',
    email: 'admin@example.com',
  },
  bot: {
    id: 'ou_bot_001',
    userName: 'pi-claw-bot',
    displayName: 'Pi Claw Bot',
  },
} satisfies Record<string, MockUser>;

export function createMockUser(overrides?: Partial<MockUser>): MockUser {
  return {
    id: `ou_${Date.now()}`,
    userName: `user_${Date.now()}`,
    displayName: 'Test User',
    ...overrides,
  };
}

// ============================================================================
// 2. 频道数据
// ============================================================================

export interface MockChannel {
  id: string;
  name: string;
  type?: 'group' | 'direct' | 'thread';
}

export const mockChannels = {
  general: {
    id: 'oc_general_001',
    name: '综合讨论',
    type: 'group',
  },
  dev: {
    id: 'oc_dev_001',
    name: '开发频道',
    type: 'group',
  },
  dm: {
    id: 'oc_dm_001',
    name: '私聊频道',
    type: 'direct',
  },
} satisfies Record<string, MockChannel>;

export function createMockChannel(overrides?: Partial<MockChannel>): MockChannel {
  return {
    id: `oc_${Date.now()}`,
    name: 'Test Channel',
    type: 'group',
    ...overrides,
  };
}

// ============================================================================
// 3. 消息事件
// ============================================================================

export interface MockMessageEvent {
  type: 'message';
  channel: string;
  ts: string;
  user: string;
  userName?: string;
  text: string;
  rawText: string;
  attachments: Array<{ original: string; local: string }>;
}

export const mockMessages = {
  text: {
    type: 'message',
    channel: 'oc_general_001',
    ts: '1711276800.123456',
    user: 'ou_user_001',
    userName: '张三',
    text: '你好，机器人！',
    rawText: '<at user_id="ou_bot_001"></at> 你好，机器人！',
    attachments: [],
  },
  withImage: {
    type: 'message',
    channel: 'oc_general_001',
    ts: '1711276860.234567',
    user: 'ou_user_001',
    userName: '张三',
    text: '[图片]',
    rawText: '[图片]',
    attachments: [
      { original: 'img_v1_abc123', local: 'attachments/2026-03-24/img_001.jpg' },
    ],
  },
  withFile: {
    type: 'message',
    channel: 'oc_dev_001',
    ts: '1711276920.345678',
    user: 'ou_user_001',
    userName: '张三',
    text: '[文件]',
    rawText: '请查看附件',
    attachments: [
      { original: 'file_v1_xyz789', local: 'attachments/2026-03-24/doc_001.pdf' },
    ],
  },
  withVoice: {
    type: 'message',
    channel: 'oc_dm_001',
    ts: '1711276980.456789',
    user: 'ou_user_001',
    userName: '张三',
    text: '[语音]',
    rawText: '[语音]',
    attachments: [
      { original: 'voice_v1_qrs456', local: 'attachments/2026-03-24/voice_001.ogg' },
    ],
  },
  longText: {
    type: 'message',
    channel: 'oc_general_001',
    ts: '1711277040.567890',
    user: 'ou_user_001',
    userName: '张三',
    text: '这是一条很长的消息。'.repeat(50),
    rawText: '这是一条很长的消息。'.repeat(50),
    attachments: [],
  },
} satisfies Record<string, MockMessageEvent>;

export function createMockMessage(overrides?: Partial<MockMessageEvent>): MockMessageEvent {
  return {
    type: 'message',
    channel: 'oc_general_001',
    ts: `${Date.now() / 1000}.000000`,
    user: 'ou_user_001',
    userName: 'Test User',
    text: 'Test message',
    rawText: 'Test message',
    attachments: [],
    ...overrides,
  };
}

// ============================================================================
// 4. 调度事件
// ============================================================================

export interface MockScheduledEvent {
  type: 'scheduled';
  channel: string;
  eventId: string;
  eventType: 'immediate' | 'one-shot' | 'periodic';
  scheduleInfo: string;
  text: string;
}

export const mockScheduledEvents = {
  daily: {
    type: 'scheduled',
    channel: 'oc_general_001',
    eventId: 'evt_daily_report',
    eventType: 'periodic',
    scheduleInfo: '0 9 * * 1-5',
    text: '每日早报',
  },
  oneShot: {
    type: 'scheduled',
    channel: 'oc_dev_001',
    eventId: 'evt_reminder_001',
    eventType: 'one-shot',
    scheduleInfo: '2026-03-25T10:00:00Z',
    text: '代码评审提醒',
  },
  immediate: {
    type: 'scheduled',
    channel: 'oc_general_001',
    eventId: 'evt_immediate_001',
    eventType: 'immediate',
    scheduleInfo: '',
    text: '立即执行任务',
  },
} satisfies Record<string, MockScheduledEvent>;

export function createMockScheduledEvent(overrides?: Partial<MockScheduledEvent>): MockScheduledEvent {
  return {
    type: 'scheduled',
    channel: 'oc_general_001',
    eventId: `evt_${Date.now()}`,
    eventType: 'periodic',
    scheduleInfo: '0 */6 * * *',
    text: 'Scheduled task',
    ...overrides,
  };
}

// ============================================================================
// 5. 系统事件
// ============================================================================

export interface MockSystemEvent {
  type: 'system';
  action: 'startup' | 'shutdown' | 'error';
  error?: Error;
}

export const mockSystemEvents = {
  startup: { type: 'system', action: 'startup' },
  shutdown: { type: 'system', action: 'shutdown' },
  error: { type: 'system', action: 'error', error: new Error('Connection timeout') },
} satisfies Record<string, MockSystemEvent>;

// ============================================================================
// 6. 插件配置
// ============================================================================

export interface MockPluginConfig {
  enabled: boolean;
  [key: string]: unknown;
}

export const mockPluginConfigs = {
  agent: { enabled: true, maxHistoryMessages: 20 },
  voice: { enabled: true, defaultVoice: 'Cherry' },
  memory: { enabled: true, maxHistoryMessages: 10 },
  card: { enabled: true },
  event: { enabled: false },
  debug: { enabled: true },
} satisfies Record<string, MockPluginConfig>;

// ============================================================================
// 7. 模型配置
// ============================================================================

export interface MockModelDefinition {
  id: string;
  name?: string;
  input: Array<'text' | 'image' | 'audio'>;
  cost: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  contextWindow: number;
  maxTokens: number;
  reasoning?: boolean;
}

export const mockModels = {
  qwen: {
    id: 'qwen3.5-plus',
    name: 'qwen3.5-plus',
    input: ['text', 'image'],
    cost: { input: 0.002, output: 0.006, cacheRead: 0.0005, cacheWrite: 0.002 },
    contextWindow: 1000000,
    maxTokens: 65536,
    reasoning: true,
  },
  glm: {
    id: 'glm-5',
    name: 'glm-5',
    input: ['text'],
    cost: { input: 0.001, output: 0.003 },
    contextWindow: 202752,
    maxTokens: 16384,
    reasoning: true,
  },
  asr: {
    id: 'qwen3-asr-flash',
    input: ['audio'],
    cost: { input: 0, output: 0 },
    contextWindow: 32000,
    maxTokens: 8192,
  },
} satisfies Record<string, MockModelDefinition>;

// ============================================================================
// 8. 存储记录
// ============================================================================

export interface MockLoggedMessage {
  date: string;
  ts: string;
  user: string;
  userName?: string;
  displayName?: string;
  text: string;
  attachments: Array<{ original: string; local: string }>;
  isBot: boolean;
}

export const mockLoggedMessages: MockLoggedMessage[] = [
  {
    date: '2026-03-24',
    ts: '1711276800.123456',
    user: 'ou_user_001',
    userName: '张三',
    displayName: '张三',
    text: '帮我写一个 Python 脚本',
    attachments: [],
    isBot: false,
  },
  {
    date: '2026-03-24',
    ts: '1711276810.234567',
    user: 'ou_bot_001',
    userName: 'pi-claw-bot',
    displayName: 'Pi Claw Bot',
    text: '好的，这是脚本内容...',
    attachments: [
      { original: 'script.py', local: 'attachments/2026-03-24/script.py' },
    ],
    isBot: true,
  },
  {
    date: '2026-03-24',
    ts: '1711276820.345678',
    user: 'ou_user_001',
    userName: '张三',
    displayName: '张三',
    text: '运行报错了',
    attachments: [
      { original: 'error_screenshot.png', local: 'attachments/2026-03-24/error.png' },
    ],
    isBot: false,
  },
];

// ============================================================================
// 9. 工具定义
// ============================================================================

export interface MockTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const mockTools = {
  readFile: {
    name: 'read_file',
    description: '读取文件内容',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
      },
      required: ['path'],
    },
  },
  writeFile: {
    name: 'write_file',
    description: '写入文件内容',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        content: { type: 'string', description: '文件内容' },
      },
      required: ['path', 'content'],
    },
  },
  execCommand: {
    name: 'exec_command',
    description: '执行 shell 命令',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '命令' },
        args: { type: 'array', items: { type: 'string' }, description: '参数列表' },
      },
      required: ['command'],
    },
  },
} satisfies Record<string, MockTool>;

// ============================================================================
// 10. 插件上下文
// ============================================================================

export function createMockPluginContext(overrides?: Record<string, unknown>) {
  return {
    message: {
      text: 'test message',
      rawText: 'test message',
      user: 'ou_user_001',
      userName: 'Test User',
      channel: 'oc_general_001',
      ts: `${Date.now() / 1000}.000000`,
      attachments: [],
    },
    channelName: '综合讨论',
    channels: [mockChannels.general, mockChannels.dev],
    users: [mockUsers.normal, mockUsers.admin],
    respond: async () => {},
    workspaceDir: '/tmp/test-workspace',
    channelDir: '/tmp/test-workspace/oc_general_001',
    capabilities: {
      platform: 'test',
      hasCapability: () => true,
    },
    ...overrides,
  };
}
