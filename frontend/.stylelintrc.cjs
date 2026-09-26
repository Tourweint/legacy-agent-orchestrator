// Stylelint 配置 —— CSS 代码质量检查
// 与 ESLint（JS/Vue）、Prettier（格式化）形成完整规范体系

module.exports = {
  extends: ['stylelint-config-standard', 'stylelint-config-recommended-vue'],
  ignoreFiles: ['dist/**', 'node_modules/**', '**/*.min.css'],
  rules: {
    // === 颜色 ===
    'color-hex-length': 'long',
    // 允许 rgba() 传统语法（tokens.css 大量使用，兼容性更好）
    'color-function-notation': null,
    // 允许 alpha 小数表示（0.04 而非 4%）
    'alpha-value-notation': null,

    // === 选择器 ===
    'selector-class-pattern': null,
    'selector-id-pattern': null,
    'no-descending-specificity': null,

    // === 自定义属性 ===
    'custom-property-pattern': null,

    // === 函数 ===
    'function-no-unknown': [true, { ignoreFunctions: ['var'] }],

    // === 数值 ===
    'length-zero-no-unit': true,
    // 允许关键字大小写不一致（currentColor / Consolas 等是合法写法）
    'value-keyword-case': null,

    // === 导入 ===
    'import-notation': null,

    // === 媒体查询 ===
    'media-feature-range-notation': 'prefix',

    // === 关键帧 ===
    'keyframes-name-pattern': null,

    // === 风格（Prettier 已处理格式化，这里放宽）===
    // 不强制规则前空行（紧凑风格）
    'rule-empty-line-before': null,
    // 不强制注释前空行
    'comment-empty-line-before': null,
    // 允许单行多声明（如 padding: 0; margin: 0; 写在一行）
    'declaration-block-single-line-max-declarations': null,

    // === 兼容性 ===
    // 允许必要的 vendor prefix（-webkit-text-size-adjust 等）
    'property-no-vendor-prefix': null,
    // 允许已弃用但仍广泛使用的值（word-break: break-word）
    'declaration-property-value-keyword-no-deprecated': null,
  },
}
