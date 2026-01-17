/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Chenille 提示词统一导出
 *
 * 目录结构：
 * - agentPrompt.ts          - 默认智能体提示词（Chat/Agent 模式）
 * - commitMessagePrompt.ts  - 提交消息生成提示词
 * - codeCompletionPrompt.ts - 代码补全提示词
 * - contextCollapsePrompt.ts - 上下文收拢提示词
 */

import { AiPrompt, AgentType } from '../types.js';

// 智能体提示词
import { BUILTIN_AGENT_PROMPT_NAME, AGENT_PROMPT_CONTENT } from './agentPrompt.js';
export { BUILTIN_AGENT_PROMPT_NAME, AGENT_PROMPT_CONTENT };

// 提交消息提示词
import { BUILTIN_COMMIT_PROMPT_NAME, COMMIT_PROMPT_CONTENT } from './commitMessagePrompt.js';
export { BUILTIN_COMMIT_PROMPT_NAME, COMMIT_PROMPT_CONTENT };

// 代码补全提示词
import { BUILTIN_INLINE_COMPLETION_PROMPT_NAME, INLINE_COMPLETION_PROMPT_CONTENT } from './codeCompletionPrompt.js';
export { BUILTIN_INLINE_COMPLETION_PROMPT_NAME, INLINE_COMPLETION_PROMPT_CONTENT };

// 上下文收拢提示词
export {
	CONTEXT_COLLAPSE_SYSTEM_PROMPT,
	createCollapseRequestMessage,
	CONTINUE_WORK_MESSAGE,
	COLLAPSED_CONTEXT_MARKER,
} from './contextCollapsePrompt.js';

/**
 * 内置 Agent 提示词
 */
export const BUILTIN_AGENT_PROMPT: AiPrompt = {
	name: BUILTIN_AGENT_PROMPT_NAME,
	description: '用于代码编写智能体的默认提示词（内置，不可修改）',
	isBuiltin: true,
	content: AGENT_PROMPT_CONTENT
};

/**
 * 内置 Commit 提示词
 */
export const BUILTIN_COMMIT_PROMPT: AiPrompt = {
	name: BUILTIN_COMMIT_PROMPT_NAME,
	description: '用于生成 Git 提交消息的默认提示词（内置，不可修改）',
	isBuiltin: true,
	content: COMMIT_PROMPT_CONTENT
};

/**
 * 内置 Inline Completion 提示词
 */
export const BUILTIN_INLINE_COMPLETION_PROMPT: AiPrompt = {
	name: BUILTIN_INLINE_COMPLETION_PROMPT_NAME,
	description: '用于代码补全的默认提示词（内置，不可修改）',
	isBuiltin: true,
	content: INLINE_COMPLETION_PROMPT_CONTENT
};

/**
 * 所有内置提示词列表
 */
export const BUILTIN_PROMPTS: AiPrompt[] = [
	BUILTIN_AGENT_PROMPT,
	BUILTIN_COMMIT_PROMPT,
	BUILTIN_INLINE_COMPLETION_PROMPT,
];

/**
 * 检查提示词是否为内置提示词
 */
export function isBuiltinPrompt(name: string): boolean {
	return BUILTIN_PROMPTS.some(p => p.name === name);
}

/**
 * 根据 AgentType 获取默认提示词
 */
export function getDefaultPromptByAgentType(agentType: AgentType): AiPrompt | undefined {
	switch (agentType) {
		case AgentType.CODE_WRITER:
			return BUILTIN_AGENT_PROMPT;
		case AgentType.COMMIT_MESSAGE:
			return BUILTIN_COMMIT_PROMPT;
		case AgentType.INLINE_COMPLETION:
			return BUILTIN_INLINE_COMPLETION_PROMPT;
		default:
			return undefined;
	}
}
