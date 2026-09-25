// 接触层本地错误 —— 参数非法 / 配置缺失等"请求根本不该发出"的问题（M3：把不合格的请求挡在存量系统之外）。
// 它不是三值结论：三值只描述"已发出的调用结果如何"；本错误发生在调用之前。

export class ContactError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ContactError'
  }
}
