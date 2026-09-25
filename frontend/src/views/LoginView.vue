<script setup>
// 登录页 —— 登录方案影响面 #6（登录页、角色标识、会话失效提示）。
// 两条口径：
//   · 用**校园系统原有账号**登录（不建第二套账号体系），引擎只把会话 Cookie 给浏览器
//   · 界面上不出现任何接口术语；提示语全部是人话（零术语纪律）
import { ref } from 'vue'
import { useSessionStore } from '../stores/session.js'

const session = useSessionStore()
const username = ref('')
const password = ref('')

async function submit() {
  if (!username.value || !password.value) {
    session.error = '请填写账号和密码'
    return
  }
  await session.login(username.value.trim(), password.value)
  password.value = '' // 口令不在页面上留存
}
</script>

<template>
  <div class="login-wrap">
    <form class="card" @submit.prevent="submit">
      <div class="brand">校园教室代办</div>
      <div class="sub">用你在校园系统里的账号登录——我们不另建账号</div>

      <label class="field">
        <span>账号</span>
        <input v-model="username" type="text" autocomplete="username" placeholder="例如：233" />
      </label>

      <label class="field">
        <span>密码</span>
        <input v-model="password" type="password" autocomplete="current-password" placeholder="校园系统密码" />
      </label>

      <p v-if="session.expiredNotice" class="hint warn">登录已过期，请重新登录。</p>
      <p v-else-if="session.error" class="hint error">{{ session.error }}</p>

      <button class="primary" type="submit" :disabled="session.submitting">
        {{ session.submitting ? '登录中…' : '登录' }}
      </button>

      <p class="foot">登录后，预约记录会记到你这个账号名下；退出登录即结束本次会话。</p>
    </form>

    <p class="demo">
      演示账号（账号名）：教师 <code>233</code> · 学生 <code>abc</code>
    </p>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 70vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
}

.card {
  width: 340px;
  background: var(--surface);
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-card);
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.brand {
  font-size: 17px;
  font-weight: 650;
}

.sub {
  color: var(--text-muted);
  font-size: 12px;
  margin-bottom: var(--space-2);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: 12px;
  color: var(--text-muted);
}

.field input {
  border: var(--border-width) solid var(--border);
  border-radius: var(--radius-small);
  background: var(--surface-2);
  color: var(--text);
  font-size: 14px;
  padding: 9px 11px;
  font-family: inherit;
}

.field input:focus {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.primary {
  margin-top: var(--space-2);
  background: var(--accent);
  color: var(--on-accent);
  border: none;
  border-radius: var(--radius-small);
  padding: 10px 12px;
  font-size: 14px;
  font-family: inherit;
  cursor: pointer;
}

.primary:disabled {
  opacity: 0.6;
  cursor: default;
}

.hint {
  font-size: 12px;
  margin: 0;
}

.hint.error {
  color: var(--status-danger);
}

.hint.warn {
  color: var(--status-uncertain);
}

.foot {
  color: var(--text-faint);
  font-size: 11px;
  margin: var(--space-1) 0 0;
}

.demo {
  color: var(--text-faint);
  font-size: 11px;
}

.demo code {
  font-family: var(--font-mono);
  color: var(--text-muted);
}
</style>
