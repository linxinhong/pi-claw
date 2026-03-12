<template>
  <div class="voice-wave-container" :class="[mode, { active }]">
    <div class="wave-wrapper">
      <div 
        v-for="i in barCount" 
        :key="i"
        class="wave-bar"
        :style="getBarStyle(i)"
      />
    </div>
    <div class="voice-label">
      {{ mode === 'input' ? '正在聆听...' : '正在播放...' }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue';

// ============================================================================
// Props
// ============================================================================

interface Props {
  active: boolean;
  mode?: 'input' | 'output';
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'input',
});

// ============================================================================
// State
// ============================================================================

const barCount = 20;
const animationFrame = ref<number | null>(null);
const barHeights = ref<number[]>(new Array(barCount).fill(0.5));

// ============================================================================
// Methods
// ============================================================================

function getBarStyle(index: number) {
  const height = barHeights.value[index - 1] || 0.5;
  const percent = Math.min(100, Math.max(10, height * 100));
  
  return {
    height: `${percent}%`,
    animationDelay: `${(index - 1) * 0.05}s`,
    backgroundColor: props.mode === 'input' 
      ? `hsl(${200 + height * 60}, 80%, 50%)`
      : `hsl(${280 + height * 60}, 80%, 60%)`,
  };
}

function animate() {
  if (!props.active) {
    barHeights.value = new Array(barCount).fill(0.5);
    return;
  }

  // 生成随机的波形高度
  barHeights.value = barHeights.value.map((_, i) => {
    // 基础波形 + 随机波动
    const base = 0.3 + Math.sin(Date.now() / 200 + i * 0.5) * 0.2;
    const noise = Math.random() * 0.5;
    return Math.min(1, Math.max(0.1, base + noise));
  });

  animationFrame.value = requestAnimationFrame(animate);
}

// ============================================================================
// Watch
// ============================================================================

watch(() => props.active, (active) => {
  if (active) {
    animate();
  } else {
    if (animationFrame.value) {
      cancelAnimationFrame(animationFrame.value);
    }
    barHeights.value = new Array(barCount).fill(0.5);
  }
}, { immediate: true });

// ============================================================================
// Cleanup
// ============================================================================

onUnmounted(() => {
  if (animationFrame.value) {
    cancelAnimationFrame(animationFrame.value);
  }
});
</script>

<style scoped>
.voice-wave-container {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(15, 23, 42, 0.9);
  backdrop-filter: blur(10px);
  border-radius: 16px;
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  opacity: 0;
  visibility: hidden;
  transition: all 0.3s ease;
}

.voice-wave-container.active {
  opacity: 1;
  visibility: visible;
}

.wave-wrapper {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 40px;
}

.wave-bar {
  width: 4px;
  background: linear-gradient(to top, #3b82f6, #8b5cf6);
  border-radius: 2px;
  transition: height 0.1s ease;
  animation: wave 0.5s ease-in-out infinite alternate;
}

@keyframes wave {
  0% {
    transform: scaleY(0.8);
  }
  100% {
    transform: scaleY(1.2);
  }
}

.voice-label {
  font-size: 13px;
  color: #e2e8f0;
  font-weight: 500;
}

/* 输入模式 - 蓝色调 */
.voice-wave-container.input .wave-bar {
  background: linear-gradient(to top, #0ea5e9, #22d3ee);
}

/* 输出模式 - 紫色调 */
.voice-wave-container.output .wave-bar {
  background: linear-gradient(to top, #8b5cf6, #d946ef);
}

/* 活跃状态下的动画增强 */
.voice-wave-container.active .wave-bar {
  animation-duration: 0.3s;
}
</style>
