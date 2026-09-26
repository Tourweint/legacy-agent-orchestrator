import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/animations.css'

createApp(App).use(createPinia()).mount('#app')
