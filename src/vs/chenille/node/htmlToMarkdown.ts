/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Chenille. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** 抓取内容的最大长度 */
export const MAX_MARKDOWN_LENGTH = 100_000;

const BLOCK_TAGS = 'p|div|section|article|header|footer|main|aside|nav|form|fieldset|figure|figcaption|address|details|summary|table|thead|tbody|tfoot|tr|dl|dt|dd|center';

/** 解码常见 HTML 实体 */
export function decodeEntities(text: string): string {
	const named: Record<string, string> = {
		amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ',
		mdash: '—', ndash: '–', hellip: '…', copy: '©', reg: '®', trade: '™',
		laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
		middot: '·', bull: '•', times: '×', divide: '÷', deg: '°', plusmn: '±',
		larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔',
	};
	return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, entity: string) => {
		if (entity[0] === '#') {
			const code = entity[1] === 'x' || entity[1] === 'X'
				? parseInt(entity.slice(2), 16)
				: parseInt(entity.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : match;
		}
		return named[entity.toLowerCase()] ?? match;
	});
}

function stripTags(html: string): string {
	return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/**
 * 将 HTML 转为适合模型阅读的 Markdown。
 * 主进程没有 DOM，这里用轻量正则实现，重点保留标题、正文、链接、列表与代码。
 */
export function convertHtmlToMarkdown(html: string, baseUrl?: string): string {
	let text = html;
	text = text.replace(/<!--[\s\S]*?-->/g, '');
	text = text.replace(/<head\b[\s\S]*?<\/head>/gi, '');
	text = text.replace(/<(script|style|noscript|svg|canvas|template|iframe|object|embed|nav|aside|footer|dialog)\b[\s\S]*?<\/\1>/gi, '');
	text = text.replace(/<(script|style|link|meta|input|button|select|textarea)\b[^>]*\/?>/gi, '');

	// 标题
	text = text.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => `\n\n${'#'.repeat(Number(level))} ${stripTags(inner)}\n\n`);

	// 代码块
	text = text.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => {
		const langMatch = /<code[^>]*class="[^"]*(?:language-|lang-)([\w+#-]+)[^"]*"/i.exec(inner);
		const code = decodeEntities(inner.replace(/<[^>]*>/g, '')).replace(/\n$/, '');
		return `\n\n\`\`\`${langMatch?.[1] ?? ''}\n${code}\n\`\`\`\n\n`;
	});
	text = text.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner: string) => `\`${stripTags(inner)}\``);

	// 链接与图片
	text = text.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
		const label = stripTags(inner);
		const url = resolveUrl(href, baseUrl);
		return label && url ? `[${label}](${url})` : label;
	});
	text = text.replace(/<img\b[^>]*>/gi, (tag: string) => {
		const alt = /alt=["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
		const src = /src=["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
		return src ? `![${decodeEntities(alt)}](${resolveUrl(src, baseUrl)})` : '';
	});

	// 列表
	text = text.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => `\n- ${stripTags(inner)}`);
	text = text.replace(/<\/(ul|ol)>/gi, '\n\n');

	// 引用与分隔线
	text = text.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => {
		const content = stripTags(inner);
		return content ? `\n\n> ${content}\n\n` : '\n\n';
	});
	text = text.replace(/<hr\b[^>]*\/?>/gi, '\n\n---\n\n');

	// 强调
	text = text.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag: string, inner: string) => `**${stripTags(inner)}**`);
	text = text.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag: string, inner: string) => `*${stripTags(inner)}*`);

	// 段落与换行
	text = text.replace(/<br\s*\/?>/gi, '\n');
	text = text.replace(new RegExp(`<(${BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n\n');
	text = text.replace(new RegExp(`</(${BLOCK_TAGS})>`, 'gi'), '\n\n');
	text = text.replace(/<\/?(td|th)\b[^>]*>/gi, ' | ');
	text = text.replace(/<\/(h[1-6]|li|p|tr|pre)>/gi, '\n');

	// 剩余标签移除并解码实体
	text = decodeEntities(text.replace(/<[^>]*>/g, ''));

	// 规整空白
	text = text.replace(/[ \t ]+/g, ' ');
	text = text.replace(/ *\n */g, '\n');
	text = text.replace(/\n{3,}/g, '\n\n');
	text = text.trim();

	return text.length > MAX_MARKDOWN_LENGTH ? `${text.slice(0, MAX_MARKDOWN_LENGTH)}\n\n[内容过长，已截断]` : text;
}

function resolveUrl(url: string, baseUrl?: string): string {
	if (!url) {
		return '';
	}
	try {
		return baseUrl ? new URL(url, baseUrl).toString() : new URL(url).toString();
	} catch {
		return url;
	}
}

/** 从 HTML 中提取 <title> */
export function extractHtmlTitle(html: string): string | undefined {
	const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
	const title = match ? stripTags(match[1]) : '';
	return title || undefined;
}
