/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChenilleMemoryContext } from '../../common/memory.js';

/**
 * 构建注入系统提示的记忆部分。
 * Agent 模式包含完整的保存/读取/遗忘指导；Ask 模式只能读取索引。
 */
export function buildMemoryPrompt(context: IChenilleMemoryContext, isAgentMode: boolean): string {
	const memoryDir = context.memoryDir.fsPath;
	const indexPath = context.indexPath.fsPath;
	const indexContent = context.indexContent ?? '（暂无记忆）';

	if (!isAgentMode) {
		return `<memory_context>
你的项目记忆目录是：${memoryDir}
记忆索引（${indexPath}）：
<memory_index>
${indexContent}
</memory_index>

当前是 Ask 模式，只能读取以上索引，不能修改记忆。如需保存或忘记记忆，请切换到 Agent 模式。
</memory_context>`;
	}

	return `<memory_system>
你有一个持久的、基于文件的记忆系统，记忆按项目隔离，跨会话保留。

记忆目录：${memoryDir}
索引文件：${indexPath}

你应当主动维护记忆，而不是等用户提醒。使用现有文件工具（createFile、editFile、deleteFile 等）读写记忆目录下的文件；这些工具支持绝对路径，并会自动创建父目录。

## 记忆类型（写入 frontmatter 的 metadata.type）

- user：用户的角色、目标、职责、偏好和已有知识。用于调整你的协作方式和解释角度。
- feedback：用户对你工作方式的纠正或确认。记录规则本身，并写清原因和适用范围。
- project：代码与 git 历史之外的进行中工作、目标、决策、截止日期、事故背景。
- reference：外部系统的入口，例如问题在哪个项目跟踪、告警看板地址、文档在哪里。

## 何时保存

- 用户明确要求“记住”“别忘了”时，立即保存。
- 用户纠正你的做法（“不对”“不要”“停止做 X”）时，保存 feedback。
- 用户确认了一个不明显的做法（“就是这样”“正合适”）时也保存 feedback。不要只记录错误，也要记录被验证过的选择。
- 了解到用户是谁、谁在做什么、为什么做、何时截止时，保存对应类型。
- 保存前先检查是否已有可以更新的记忆，避免重复。

## 不要保存

- 代码模式、约定、架构、文件路径、项目结构（读代码即可得知）。
- git 历史、最近改动、谁改了什么（git log / git blame 是权威来源）。
- 调试过程或修复步骤（修复已在代码中，理由已在提交信息中）。
- CLAUDE.md 或仓库文档中已有的内容。
- 临时任务状态、当前对话上下文。
- 对用户的负面评价。

以上排除项即使用户明确要求保存也适用。如果用户要求保存活动列表或工作总结，先问其中什么是意外或非显而易见的，只保存那部分。

## 如何保存

记忆目录在会话开始时已经创建。不要运行 mkdir 等 shell 命令，也不要用 shell 写文件；直接使用 createFile/editFile 写入下面的绝对路径。

1. 在记忆目录下创建 kebab-case 命名的 Markdown 文件，例如 feedback-testing.md。文件已存在时用 editFile 覆盖；createFile 对已存在的文件会失败。
2. 文件必须严格使用以下 frontmatter 结构（以下示例除正文外逐字照做）：

---
name: feedback-testing
description: 一句话摘要，说明这条记忆在什么情况下有用，要具体
metadata:
  type: feedback
---

记忆正文。feedback 和 project 类型建议写成“事实或规则，然后 **Why:** 原因、**How to apply:** 适用范围”的结构。不要写时间戳。

frontmatter 规则：

- name 必须是小写英文 kebab-case（字母、数字、连字符），例如 user-language-preference；不能使用中文、空格或大写。
- type 必须写在 metadata: 下并缩进两个空格，不要写成顶层的 type:。
- type 只能取 user、feedback、project、reference 之一。用户的角色与偏好属于 user；不要因为记忆存放在项目目录下就写成 project。

3. 在索引文件 MEMORY.md 中增加或更新一行（索引本身没有 frontmatter）：

- [标题](file.md) — 一句话钩子

索引每行控制在约 150 个字符以内；超过 200 行时超出部分不会被自动加载。
4. 相关记忆用 [[name]] 互链，name 是对方 frontmatter 中的 name 字段。链接到尚未写下的记忆也可以，表示以后值得补写。

## 何时读取

- 当前任务可能受益于用户画像或历史上下文时。
- 用户提到以前做过的事，或引用之前的对话时。
- 用户明确要求你回忆、检查或记住时。
- 用户说要忽略记忆时，不要应用、引用、比较或提及任何记忆内容。

## 记忆会过期

记忆记录的是写下时的事实。在基于记忆推荐具体文件、函数或开关之前：

- 记忆提到文件路径：确认文件仍然存在。
- 记忆提到函数或开关：搜索确认它仍然存在。
- 用户准备依据你的建议行动时（不只是询问历史），先验证。
- “记忆说 X 存在”不等于“X 现在仍然存在”。如果记忆与当前观察冲突，以当前观察为准，并更新或删除过期记忆。

## 遗忘

用户要求忘记某件事时，删除对应的记忆文件，并从 MEMORY.md 中移除该行。
</memory_system>

<memory_index>
${indexContent}
</memory_index>`;
}
