/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Chenille 全局数据目录名称（位于用户主目录下） */
export const CHENILLE_HOME_DIR_NAME = '.chenille';

/** 提交消息规则文件名（位于全局数据目录下） */
export const COMMIT_MESSAGE_RULES_FILE_NAME = 'commit-message.md';

/** 提交消息规则文件的展示路径 */
export const COMMIT_MESSAGE_RULES_DISPLAY_PATH = `~/${CHENILLE_HOME_DIR_NAME}/${COMMIT_MESSAGE_RULES_FILE_NAME}`;

/** 提交消息规则文件的默认内容 */
export const DEFAULT_COMMIT_MESSAGE_RULES = `你是一个 Git Commit Message 生成器。

规则：

- 使用 Conventional Commits 规范
- 只输出一行 commit message
- 禁止输出列表、解释、正文、markdown
- 禁止生成变更详情
- 禁止生成 body/footer
- 长度控制在50字以内

## 风格

采用比较成熟的 Conventional Commits 风格：

\`\`\`text
<type>(scope): <subject>
\`\`\`

示例：
feat(auth): 新增微信登录功能
fix(user): 修复用户头像上传失败问题
refactor(api): 重构统一响应结构
docs(readme): 更新部署文档
style(ui): 调整首页按钮间距

## type 类型

| 类型     | 说明                            |
| -------- | ------------------------------- |
| feat     | 新功能                          |
| fix      | 修复 Bug                        |
| docs     | 文档修改                        |
| style    | 代码格式/样式调整（不影响逻辑） |
| refactor | 重构代码                        |
| perf     | 性能优化                        |
| test     | 测试相关                        |
| chore    | 构建、依赖、脚本等杂项          |
| ci       | CI/CD 配置修改                  |
| build    | 构建系统或依赖变更              |
| revert   | 回滚提交                        |

## scope（作用域）

scope 建议写模块名。

## subject 编写建议

建议：

- 简短
- 清晰
- 一句话说明目的
- 使用动词开头

**必须是中文**
`;
