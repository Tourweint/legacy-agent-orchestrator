<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Key, Lock, Message, School, User } from '@element-plus/icons-vue'
import { authApi } from '../api'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const MODE_LOGIN = 'login'
const MODE_REGISTER = 'register'
const LOGIN_METHOD_PASSWORD = 'password'
const LOGIN_METHOD_CODE = 'code'
const REGISTER_VIEW_FORM = 'form'
const LOGIN_VIEW_FORM = 'form'
const LOGIN_VIEW_RESET_PASSWORD = 'resetPassword'

const mode = ref(MODE_LOGIN)
const loginMethod = ref(LOGIN_METHOD_PASSWORD)
const loginView = ref(LOGIN_VIEW_FORM)
const loading = ref(false)
const formRef = ref()
const form = reactive({
  username: '',
  nickname: '',
  password: '',
  email: '',
  verificationCode: '',
  newPassword: ''
})

const codeSending = reactive({
  register: false,
  login: false,
  reset: false
})

const countdowns = reactive({
  register: 0,
  login: 0,
  reset: 0
})

let countdownTimer = null

const modeOptions = [
  { label: '密码登录', value: MODE_LOGIN },
  { label: '学生注册', value: MODE_REGISTER }
]

const loginMethodOptions = [
  { label: '密码登录', value: LOGIN_METHOD_PASSWORD },
  { label: '验证码登录', value: LOGIN_METHOD_CODE }
]

const currentTitle = computed(() => {
  if (mode.value === MODE_REGISTER) {
    return '创建学生账号'
  }
  if (loginView.value === LOGIN_VIEW_RESET_PASSWORD) {
    return '找回账号密码'
  }
  return loginMethod.value === LOGIN_METHOD_PASSWORD ? '登录账号' : '邮箱验证码登录'
})

const submitLabel = computed(() => {
  if (mode.value === MODE_REGISTER) {
    return '完成注册'
  }
  if (loginView.value === LOGIN_VIEW_RESET_PASSWORD) {
    return '重置密码'
  }
  return loginMethod.value === LOGIN_METHOD_PASSWORD ? '登录' : '验证码登录'
})

function isRegisterMode() {
  return mode.value === MODE_REGISTER
}

function isResetPasswordView() {
  return mode.value === MODE_LOGIN && loginView.value === LOGIN_VIEW_RESET_PASSWORD
}

function isCodeLoginView() {
  return mode.value === MODE_LOGIN && loginView.value === LOGIN_VIEW_FORM && loginMethod.value === LOGIN_METHOD_CODE
}

function usesEmail() {
  return isRegisterMode() || isResetPasswordView() || isCodeLoginView()
}

function usesVerificationCode() {
  return isRegisterMode() || isResetPasswordView() || isCodeLoginView()
}

function requiredWhen(condition, message) {
  return (_, value, callback) => {
    if (!condition()) {
      callback()
      return
    }
    if (!value) {
      callback(new Error(message))
      return
    }
    callback()
  }
}

function passwordValidator(message) {
  return (_, value, callback) => {
    if (!value) {
      callback(new Error(message))
      return
    }
    if (value.length < 8 || value.length > 20) {
      callback(new Error('密码长度必须在 8 到 20 位之间'))
      return
    }
    callback()
  }
}

const rules = {
  username: [
    {
      validator: requiredWhen(
        () => isRegisterMode() || (mode.value === MODE_LOGIN && loginView.value === LOGIN_VIEW_FORM && loginMethod.value === LOGIN_METHOD_PASSWORD),
        '请输入用户名'
      ),
      trigger: 'blur'
    }
  ],
  nickname: [
    {
      max: 20,
      message: '昵称长度不能超过 20 位',
      trigger: ['blur', 'change']
    }
  ],
  password: [
    {
      validator: (_, value, callback) => {
        const usingPassword =
          isRegisterMode() || (mode.value === MODE_LOGIN && loginView.value === LOGIN_VIEW_FORM && loginMethod.value === LOGIN_METHOD_PASSWORD)
        if (!usingPassword) {
          callback()
          return
        }
        passwordValidator('请输入密码')(_, value, callback)
      },
      trigger: 'blur'
    }
  ],
  email: [
    {
      validator: requiredWhen(() => usesEmail(), '请输入邮箱'),
      trigger: 'blur'
    },
    {
      type: 'email',
      message: '请输入正确的邮箱地址',
      trigger: ['blur', 'change']
    }
  ],
  verificationCode: [
    {
      validator: requiredWhen(() => usesVerificationCode(), '请输入验证码'),
      trigger: 'blur'
    },
    {
      pattern: /^\d{6}$/,
      message: '验证码必须为 6 位数字',
      trigger: ['blur', 'change']
    }
  ],
  newPassword: [
    {
      validator: (_, value, callback) => {
        if (!isResetPasswordView()) {
          callback()
          return
        }
        passwordValidator('请输入新密码')(_, value, callback)
      },
      trigger: 'blur'
    }
  ]
}

watch(mode, newMode => {
  formRef.value?.clearValidate()
  if (newMode === MODE_LOGIN) {
    loginView.value = LOGIN_VIEW_FORM
  } else {
    loginMethod.value = LOGIN_METHOD_PASSWORD
    form.verificationCode = ''
    form.newPassword = ''
  }
})

watch(loginMethod, () => {
  formRef.value?.clearValidate()
  form.verificationCode = ''
  if (loginMethod.value === LOGIN_METHOD_CODE) {
    form.username = ''
    form.password = ''
  }
})

watch(loginView, () => {
  formRef.value?.clearValidate()
  form.verificationCode = ''
  form.newPassword = ''
})

onBeforeUnmount(() => {
  stopCountdownTimer()
})

function openResetPassword() {
  mode.value = MODE_LOGIN
  loginView.value = LOGIN_VIEW_RESET_PASSWORD
}

function backToLoginForm() {
  loginView.value = LOGIN_VIEW_FORM
}

function startCountdown(scene) {
  countdowns[scene] = 60
  if (countdownTimer) {
    return
  }
  countdownTimer = window.setInterval(() => {
    let hasActiveCountdown = false
    Object.keys(countdowns).forEach(key => {
      if (countdowns[key] > 0) {
        countdowns[key] -= 1
        hasActiveCountdown = true
      }
    })
    if (!hasActiveCountdown) {
      stopCountdownTimer()
    }
  }, 1000)
}

function stopCountdownTimer() {
  if (countdownTimer) {
    window.clearInterval(countdownTimer)
    countdownTimer = null
  }
}

function codeButtonText(scene) {
  return countdowns[scene] > 0 ? `${countdowns[scene]}s 后重发` : '发送验证码'
}

function currentCodeScene() {
  if (isRegisterMode()) {
    return 'register'
  }
  if (isResetPasswordView()) {
    return 'reset'
  }
  if (isCodeLoginView()) {
    return 'login'
  }
  return null
}

async function sendCode() {
  const scene = currentCodeScene()
  if (!scene || countdowns[scene] > 0) {
    return
  }

  await formRef.value.validateField('email')
  codeSending[scene] = true
  try {
    await authApi.sendEmailCode({
      email: form.email,
      scene
    })
    startCountdown(scene)
    ElMessage.success('验证码已发送，请注意查收邮箱')
  } finally {
    codeSending[scene] = false
  }
}

function finishLogin(data) {
  authStore.setAuth(data.accessToken, data.refreshToken, data.userInfo)
  router.replace(data.userInfo?.role === 'ADMIN' ? '/admin' : '/dashboard')
}

async function submit() {
  await formRef.value.validate()
  loading.value = true
  try {
    if (isRegisterMode()) {
      await authApi.register({
        username: form.username,
        nickname: form.nickname,
        password: form.password,
        email: form.email,
        verificationCode: form.verificationCode
      })
      ElMessage.success('注册成功，请登录')
      mode.value = MODE_LOGIN
      loginView.value = LOGIN_VIEW_FORM
      loginMethod.value = LOGIN_METHOD_PASSWORD
      form.password = ''
      form.nickname = ''
      form.verificationCode = ''
      return
    }

    if (isResetPasswordView()) {
      await authApi.resetPasswordByCode({
        email: form.email,
        verificationCode: form.verificationCode,
        newPassword: form.newPassword
      })
      ElMessage.success('密码重置成功，请重新登录')
      loginView.value = LOGIN_VIEW_FORM
      loginMethod.value = LOGIN_METHOD_PASSWORD
      form.password = ''
      form.newPassword = ''
      form.verificationCode = ''
      return
    }

    if (loginMethod.value === LOGIN_METHOD_CODE) {
      const data = await authApi.loginByCode({
        email: form.email,
        verificationCode: form.verificationCode
      })
      finishLogin(data)
      ElMessage.success('登录成功')
      return
    }

    const data = await authApi.login({
      username: form.username,
      password: form.password
    })
    finishLogin(data)
    ElMessage.success('登录成功')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-shell">
      <div class="login-intro">
        <div class="login-brand">
          <div class="brand-mark">
            <el-icon><School /></el-icon>
          </div>
          <div>
            <strong>教室预约</strong>
            <span>校园预约平台</span>
          </div>
        </div>
        <h1>校园教室预约系统</h1>
        <p>
          统一管理教室、座位和预约记录，认证链路支持密码登录、邮箱验证码登录、邮箱验证注册和密码找回。
        </p>
        <div class="login-metrics">
          <div class="metric">
            <div class="metric-label">账号安全</div>
            <div class="metric-value">双令牌认证</div>
          </div>
          <div class="metric">
            <div class="metric-label">邮箱校验</div>
            <div class="metric-value">6 位验证码</div>
          </div>
          <div class="metric">
            <div class="metric-label">权限模型</div>
            <div class="metric-value">3 角色</div>
          </div>
        </div>
      </div>

      <section class="panel login-panel">
        <div class="login-heading">
          <span>欢迎使用</span>
          <strong>{{ currentTitle }}</strong>
        </div>

        <el-segmented v-model="mode" :options="modeOptions" class="mode-switcher" />

        <div v-if="mode === MODE_LOGIN && loginView === LOGIN_VIEW_FORM" class="sub-switcher">
          <el-radio-group v-model="loginMethod" size="small">
            <el-radio-button
              v-for="item in loginMethodOptions"
              :key="item.value"
              :value="item.value"
            >
              {{ item.label }}
            </el-radio-button>
          </el-radio-group>
          <button type="button" class="text-link" @click="openResetPassword">忘记密码？</button>
        </div>

        <div v-else-if="mode === MODE_LOGIN && loginView === LOGIN_VIEW_RESET_PASSWORD" class="sub-switcher">
          <span class="helper-text">通过邮箱验证码重置登录密码</span>
          <button type="button" class="text-link" @click="backToLoginForm">返回登录</button>
        </div>

        <el-form ref="formRef" :model="form" :rules="rules" label-position="top" class="login-form">
          <el-form-item v-if="mode === MODE_REGISTER" label="昵称" prop="nickname">
            <el-input v-model="form.nickname" :prefix-icon="User" placeholder="请输入昵称（可选）" />
          </el-form-item>

          <el-form-item
            v-if="mode === MODE_REGISTER || (mode === MODE_LOGIN && loginView === LOGIN_VIEW_FORM && loginMethod === LOGIN_METHOD_PASSWORD)"
            label="用户名"
            prop="username"
          >
            <el-input v-model="form.username" :prefix-icon="User" placeholder="请输入用户名" />
          </el-form-item>

          <el-form-item
            v-if="mode === MODE_REGISTER || (mode === MODE_LOGIN && loginView === LOGIN_VIEW_FORM && loginMethod === LOGIN_METHOD_PASSWORD)"
            :label="mode === MODE_REGISTER ? '密码' : '密码'"
            prop="password"
          >
            <el-input
              v-model="form.password"
              :prefix-icon="Lock"
              type="password"
              show-password
              placeholder="请输入 8-20 位密码"
            />
          </el-form-item>

          <el-form-item v-if="usesEmail()" label="邮箱" prop="email">
            <el-input v-model="form.email" :prefix-icon="Message" placeholder="请输入邮箱地址" />
          </el-form-item>

          <el-form-item v-if="usesVerificationCode()" label="验证码" prop="verificationCode">
            <el-input v-model="form.verificationCode" :prefix-icon="Key" placeholder="请输入 6 位验证码">
              <template #append>
                <el-button
                  :loading="currentCodeScene() ? codeSending[currentCodeScene()] : false"
                  :disabled="currentCodeScene() ? countdowns[currentCodeScene()] > 0 : true"
                  @click="sendCode"
                >
                  {{ codeButtonText(currentCodeScene() || 'login') }}
                </el-button>
              </template>
            </el-input>
          </el-form-item>

          <el-form-item v-if="isResetPasswordView()" label="新密码" prop="newPassword">
            <el-input
              v-model="form.newPassword"
              :prefix-icon="Lock"
              type="password"
              show-password
              placeholder="请输入新的 8-20 位密码"
            />
          </el-form-item>

          <el-button type="primary" :loading="loading" class="login-button" @click="submit">
            {{ submitLabel }}
          </el-button>
        </el-form>
      </section>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  padding: 42px;
  background:
    radial-gradient(circle at 12% 18%, rgba(37, 99, 235, 0.08), transparent 28%),
    radial-gradient(circle at 92% 8%, rgba(15, 118, 110, 0.08), transparent 24%),
    #f5f7fb;
}

.login-shell {
  min-height: calc(100vh - 84px);
  display: grid;
  grid-template-columns: minmax(0, 1fr) 460px;
  align-items: center;
  gap: 32px;
  max-width: 1220px;
  margin: 0 auto;
}

.login-intro {
  max-width: 720px;
}

.login-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 36px;
}

.login-brand strong {
  display: block;
  color: #172033;
  font-size: 18px;
}

.login-brand span {
  display: block;
  margin-top: 2px;
  color: #667085;
  font-size: 12px;
  font-weight: 600;
}

.login-intro h1 {
  margin: 0;
  color: #172033;
  font-size: 48px;
  line-height: 1.15;
}

.login-intro p {
  max-width: 640px;
  margin: 18px 0 0;
  color: #667085;
  font-size: 17px;
  line-height: 1.8;
}

.login-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 34px;
}

.login-panel {
  width: 100%;
  padding: 28px;
}

.login-heading {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 26px;
}

.login-heading span {
  color: #667085;
  font-size: 14px;
  font-weight: 700;
}

.login-heading strong {
  color: #172033;
  font-size: 30px;
  line-height: 1.2;
}

.mode-switcher {
  width: 100%;
}

.sub-switcher {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 18px;
}

.helper-text {
  color: #667085;
  font-size: 13px;
}

.text-link {
  border: 0;
  padding: 0;
  background: transparent;
  color: #2563eb;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.login-form {
  margin-top: 24px;
}

.login-button {
  width: 100%;
  margin-top: 8px;
  height: 42px;
}

@media (max-width: 920px) {
  .login-page {
    padding: 16px;
  }

  .login-shell {
    grid-template-columns: 1fr;
    min-height: calc(100vh - 32px);
  }

  .login-intro h1 {
    font-size: 36px;
  }

  .login-metrics {
    grid-template-columns: 1fr;
  }

  .login-panel {
    padding: 22px;
  }

  .sub-switcher {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
