import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import App from './App.vue'
import router from './router'
import pinia from './stores'
import 'element-plus/dist/index.css'
import './styles.css'

const app = createApp(App)

app.use(ElementPlus)
app.use(pinia)
app.use(router)
app.mount('#app')
