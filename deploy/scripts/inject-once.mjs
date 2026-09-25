// 第 5 幕一次性注入器（演示辅助）——向 8090 引擎的接触层发一条布防指令。
// 说明：注入接缝在引擎进程内（第 09 章 §二）；跨进程布防的最小实现是环境变量约定——
// 引擎启动时读取 ORCH_CHAOS_INJECT（JSON），本脚本用于生成该值并在重启引擎时带上。
//
// 用法：node deploy/scripts/inject-once.mjs   → 打印布防 JSON 与重启命令
// 演示后撤防：不带 ORCH_CHAOS_INJECT 重启引擎即可。

const spec = {
  injects: [
    { interface: 'edu.reservation.classroom.create', nth: 1, fault: 'T5' },
  ],
}

console.log('第 5 幕布防（T5 响应丢失：真实转发落库后丢弃响应）：')
console.log(`\n  ORCH_CHAOS_INJECT='${JSON.stringify(spec)}' ORCH_LEGACY_ADMIN_PASSWORD=admin \\\n    ORCH_LEGACY_TEACHER_PASSWORD=233 npm start\n`)
console.log('演示完成后撤防：去掉 ORCH_CHAOS_INJECT 重启引擎（npm start）。')
console.log('注入生效时，轨迹条目会显示 ⚠ 注入 徽章（§七 可见性要求）。')
