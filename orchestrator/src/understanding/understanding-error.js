// 理解层本地错误。

export class UnderstandingError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UnderstandingError'
  }
}
