// 判定层本地错误 —— 谓词求值无法进行（缺少必要上下文/算子误用）时抛出；
// 引擎把它收敛为该命题的"无法确认"，绝不就地猜一个成立与否。

export class JudgmentError extends Error {
  constructor(message) {
    super(message)
    this.name = 'JudgmentError'
  }
}
