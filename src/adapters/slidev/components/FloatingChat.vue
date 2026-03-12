<template>
  <div 
    class="floating-chat-container"
    :class="[`position-${position}`, { open: isOpen }]"
  >
    <!-- 触发按钮 -->
    <button 
      class="chat-toggle-btn"
      @click="toggleChat"
      :class="{ active: isOpen, 'has-unread': unreadCount > 0 }"
    >
      <span class="icon">💬</span>
      <span v-if="unreadCount > 0" class="badge">{{ unreadCount }}</span>
    </button>

    <!-- 聊天窗口 -->
    <Transition name="chat-panel">
      <div v-show="isOpen" class="chat-panel">
        <!-- 头部 -->
        <div class="chat-header">
          <h3>AI 助手</h3>
          <div class="header-actions">
            <button 
              class="voice-btn"
              :class="{ active: isListening }"
              @click="toggleVoice"
              title="语音对话"
            >
              🎤
            </button>
            <button class="close-btn" @click="toggleChat">✕</button>
          </div>
        </div>

        <!-- 消息列表 -->
        <div ref="messagesContainer" class="messages-list">
          <div
            v-for="msg in messages"
            :key="msg.id"
            class="message"
            :class="msg.role"
          >
            <div class="message-content">
              <div class="message-text" v-html="formatMessage(msg.content)"></div>
              <span v-if="msg.isVoice" class="voice-indicator">🎤</span>
            </div>
            <span class="message-time">{{ formatTime(msg.timestamp) }}</span>
          </div>
          
          <!-- 加载指示器 -->
          <div v-if="isLoading" class="message assistant loading">
            <div class="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>

        <!-- 语音波形（对话中显示） -->
        <VoiceWave 
          v-if="isListening || isSpeaking" 
          :active="true" 
          :mode="isListening ? 'input' : 'output'"
        />

        <!-- 输入区域 -->
        <div class="chat-input-area">
          <textarea
            ref="inputRef"
            v-model="inputText"
            :placeholder="placeholder"
            :disabled="isLoading"
            @keydown.enter.prevent="sendMessage"
            rows="1"
          />
          <button 
            class="send-btn" 
            :disabled="!inputText.trim() || isLoading"
            @click="sendMessage"
          >
            ➤
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue';
import type { ChatMessage } from '../types.js';
import VoiceWave from './VoiceWave.vue';

// ============================================================================
// Props
// ============================================================================

interface Props {
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  placeholder?: string;
  initialOpen?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  position: 'bottom-right',
  placeholder: '输入消息或点击麦克风语音对话...',
  initialOpen: false,
});

// ============================================================================
// Emits
// ============================================================================

interface Emits {
  send: [text: string];
  'voice-start': [];
  'voice-stop': [];
}

const emit = defineEmits<Emits>();

// ============================================================================
// State
// ============================================================================

const isOpen = ref(props.initialOpen);
const inputText = ref('');
const messages = ref<ChatMessage[]>([]);
const isLoading = ref(false);
const isListening = ref(false);
const isSpeaking = ref(false);
const unreadCount = ref(0);

const messagesContainer = ref<HTMLElement>();
const inputRef = ref<HTMLTextAreaElement>();

// ============================================================================
// Methods
// ============================================================================

function toggleChat() {
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    unreadCount.value = 0;
    nextTick(() => {
      inputRef.value?.focus();
      scrollToBottom();
    });
  }
}

function toggleVoice() {
  if (isListening.value) {
    isListening.value = false;
    emit('voice-stop');
  } else {
    isListening.value = true;
    emit('voice-start');
  }
}

function sendMessage() {
  const text = inputText.value.trim();
  if (!text || isLoading.value) return;

  // 添加用户消息
  addMessage({
    id: Date.now().toString(),
    role: 'user',
    content: text,
    timestamp: Date.now(),
    isVoice: false,
  });

  inputText.value = '';
  emit('send', text);
}

function addMessage(message: ChatMessage) {
  messages.value.push(message);
  
  if (!isOpen.value) {
    unreadCount.value++;
  }
  
  nextTick(scrollToBottom);
}

function addAssistantMessage(content: string, isVoice = false) {
  addMessage({
    id: Date.now().toString(),
    role: 'assistant',
    content,
    timestamp: Date.now(),
    isVoice,
  });
}

function setLoading(loading: boolean) {
  isLoading.value = loading;
}

function setListening(listening: boolean) {
  isListening.value = listening;
}

function setSpeaking(speaking: boolean) {
  isSpeaking.value = speaking;
}

function scrollToBottom() {
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

function formatMessage(content: string): string {
  // 简单的 Markdown 渲染
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

// ============================================================================
// Expose
// ============================================================================

defineExpose({
  addMessage,
  addAssistantMessage,
  setLoading,
  setListening,
  setSpeaking,
  toggleChat,
  isOpen: computed(() => isOpen.value),
});
</script>

<style scoped>
.floating-chat-container {
  position: fixed;
  z-index: 9999;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

/* 位置 */
.position-bottom-right { bottom: 20px; right: 20px; }
.position-bottom-left { bottom: 20px; left: 20px; }
.position-top-right { top: 20px; right: 20px; }
.position-top-left { top: 20px; left: 20px; }

/* 触发按钮 */
.chat-toggle-btn {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: #3b82f6;
  color: white;
  font-size: 24px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
  transition: all 0.3s ease;
  position: relative;
}

.chat-toggle-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 6px 16px rgba(59, 130, 246, 0.5);
}

.chat-toggle-btn.active {
  background: #ef4444;
}

.chat-toggle-btn.has-unread::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 12px;
  height: 12px;
  background: #ef4444;
  border-radius: 50%;
  border: 2px solid white;
}

.badge {
  position: absolute;
  top: -4px;
  right: -4px;
  background: #ef4444;
  color: white;
  font-size: 12px;
  font-weight: bold;
  padding: 2px 6px;
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
}

/* 聊天面板 */
.chat-panel {
  position: absolute;
  bottom: 70px;
  right: 0;
  width: 360px;
  height: 480px;
  background: white;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.position-bottom-left .chat-panel,
.position-top-left .chat-panel {
  right: auto;
  left: 0;
}

.position-top-right .chat-panel,
.position-top-left .chat-panel {
  bottom: auto;
  top: 70px;
}

/* 头部 */
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
  color: white;
}

.chat-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.voice-btn, .close-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.2);
  color: white;
  cursor: pointer;
  transition: all 0.2s;
}

.voice-btn:hover, .close-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.voice-btn.active {
  background: #ef4444;
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

/* 消息列表 */
.messages-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background: #f8fafc;
}

.message {
  margin-bottom: 16px;
  max-width: 85%;
}

.message.user {
  margin-left: auto;
}

.message-content {
  padding: 12px 16px;
  border-radius: 16px;
  position: relative;
}

.message.user .message-content {
  background: #3b82f6;
  color: white;
  border-bottom-right-radius: 4px;
}

.message.assistant .message-content {
  background: white;
  color: #1e293b;
  border-bottom-left-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.voice-indicator {
  margin-left: 4px;
  font-size: 12px;
  opacity: 0.6;
}

.message-time {
  display: block;
  font-size: 11px;
  color: #94a3b8;
  margin-top: 4px;
}

/* 加载指示器 */
.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 8px 16px;
}

.typing-indicator span {
  width: 8px;
  height: 8px;
  background: #cbd5e1;
  border-radius: 50%;
  animation: typing 1.4s infinite ease-in-out both;
}

.typing-indicator span:nth-child(1) { animation-delay: -0.32s; }
.typing-indicator span:nth-child(2) { animation-delay: -0.16s; }

@keyframes typing {
  0%, 80%, 100% { transform: scale(0); }
  40% { transform: scale(1); }
}

/* 输入区域 */
.chat-input-area {
  display: flex;
  padding: 12px 16px;
  background: white;
  border-top: 1px solid #e2e8f0;
  gap: 8px;
}

.chat-input-area textarea {
  flex: 1;
  border: 1px solid #e2e8f0;
  border-radius: 20px;
  padding: 10px 16px;
  font-size: 14px;
  resize: none;
  outline: none;
  min-height: 20px;
  max-height: 100px;
}

.chat-input-area textarea:focus {
  border-color: #3b82f6;
}

.send-btn {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: #3b82f6;
  color: white;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.send-btn:hover:not(:disabled) {
  background: #2563eb;
}

.send-btn:disabled {
  background: #cbd5e1;
  cursor: not-allowed;
}

/* 动画 */
.chat-panel-enter-active,
.chat-panel-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.chat-panel-enter-from,
.chat-panel-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(10px);
}

/* 代码块样式 */
:deep(pre) {
  background: #1e293b;
  color: #e2e8f0;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 13px;
}

:deep(code) {
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
  color: #ef4444;
}
</style>
