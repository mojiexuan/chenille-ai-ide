/**
 * Chenille 上游隔离检查。
 *
 * 规则：除 `src/vs/chenille/**` 外，所有相对上游基线的改动都必须出现在
 * CHENILLE_UPSTREAM.json 的 `allowedUpstreamChanges` 白名单中，且单个文件的
 * 改动行数不能超过上限。这样升级上游时只需要重新处理少量挂钩文件。
 *
 * 用法：
 *   node scripts/chenille/check-isolation.mjs
 *   node scripts/chenille/check-isolation.mjs --base <git-ref>
 *   CHENILLE_BASE=<git-ref> node scripts/chenille/check-isolation.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const config = JSON.parse(readFileSync(join(repoRoot, 'CHENILLE_UPSTREAM.json'), 'utf8'));
const isolation = config.isolation ?? {};
const owned = isolation.owned ?? [];
const allowedUpstreamChanges = isolation.allowedUpstreamChanges ?? {};
const allowedNewPaths = isolation.allowedNewPaths ?? [];
const maxLines = isolation.maxChangedLinesPerUpstreamFile ?? 80;

const args = process.argv.slice(2);
const baseFlagIndex = args.indexOf('--base');
const base = baseFlagIndex >= 0 ? args[baseFlagIndex + 1] : (process.env.CHENILLE_BASE ?? config.upstream?.commit);

const errors = [];
const warnings = [];

function git(gitArgs) {
	return execFileSync('git', gitArgs, { cwd: repoRoot, encoding: 'utf8' }).trimEnd();
}

function toPosix(path) {
	return path.replaceAll('\\', '/');
}

function isUnder(path, prefix) {
	return prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`);
}

function matchesGlob(path, pattern) {
	const escaped = pattern
		.split('*')
		.map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
		.join('[^/]*');
	return new RegExp(`^${escaped}$`).test(path);
}

function isOwned(path) {
	return owned.some(prefix => isUnder(path, prefix));
}

function isAllowedNewPath(path) {
	return allowedNewPaths.some(pattern => matchesGlob(path, pattern));
}

if (!base) {
	errors.push('CHENILLE_UPSTREAM.json 中缺少 upstream.commit，且没有通过 --base 指定基线。');
} else {
	try {
		git(['rev-parse', '--verify', `${base}^{commit}`]);
	} catch {
		errors.push(`找不到上游基线 "${base}"。请先在本地获取完整历史，例如：git fetch --tags origin`);
	}
}

if (!errors.length) {
	// 已跟踪文件的改动
	const numstat = git(['diff', '--numstat', '--no-renames', base, '--', '.']);
	for (const line of numstat.split('\n').filter(Boolean)) {
		const [added, deleted, rawPath] = line.split('\t');
		if (!rawPath) {
			continue;
		}
		const path = toPosix(rawPath);

		if (isOwned(path)) {
			continue;
		}

		if (!(path in allowedUpstreamChanges)) {
			errors.push(`不允许的上游改动：${path}\n  请把它迁移到 src/vs/chenille/**，或登记到 CHENILLE_UPSTREAM.json 的 allowedUpstreamChanges。`);
			continue;
		}

		const entry = allowedUpstreamChanges[path];
		const limit = typeof entry === 'object' && entry?.maxChangedLines ? entry.maxChangedLines : maxLines;
		const changed = (added === '-' ? 0 : Number(added)) + (deleted === '-' ? 0 : Number(deleted));
		if (changed > limit) {
			errors.push(`上游挂钩文件改动过大：${path}（${changed} 行 > 上限 ${limit} 行）\n  上游挂钩应保持最小，复杂逻辑请放进 src/vs/chenille/**。`);
		}

		if (!/\bchenille\b/i.test(readFileSync(join(repoRoot, path), 'utf8'))) {
			warnings.push(`白名单文件未找到 Chenille 标记：${path}（确认挂钩是否仍然存在）`);
		}
	}

	// 未跟踪的新文件
	const untracked = git(['ls-files', '--others', '--exclude-standard']);
	for (const rawPath of untracked.split('\n').filter(Boolean)) {
		const path = toPosix(rawPath);
		if (isOwned(path) || isAllowedNewPath(path)) {
			continue;
		}
		errors.push(`未登记的新文件：${path}\n  Chenille 代码应放在 ${owned.join('、')}，其他文件请加入 allowedNewPaths。`);
	}
}

if (warnings.length) {
	console.warn('\n警告：');
	for (const warning of warnings) {
		console.warn(`  - ${warning}`);
	}
}

if (errors.length) {
	console.error('\nChenille 隔离检查失败：');
	for (const error of errors) {
		console.error(`  - ${error}`);
	}
	console.error(`\n基线：${base}`);
	process.exit(1);
}

console.log(`Chenille 隔离检查通过（基线：${base}，白名单挂钩文件：${Object.keys(allowedUpstreamChanges).length} 个）。`);
