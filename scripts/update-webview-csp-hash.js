// @ts-check
/**
 * 自动计算 webview index.html 中内联脚本的 CSP hash 并更新
 * 用法: node scripts/update-webview-csp-hash.js
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// 需要更新的所有 index.html 文件路径
const indexPaths = [
	'src/vs/workbench/contrib/webview/browser/pre/index.html',
	'out/vs/workbench/contrib/webview/browser/pre/index.html',
	'out-vscode/vs/workbench/contrib/webview/browser/pre/index.html',
	'out-vscode-min/vs/workbench/contrib/webview/browser/pre/index.html',
].map(p => path.join(__dirname, '..', p));

function calculateScriptHash(content) {
	// 匹配 <script ...>...</script> 中的内容
	const scriptRegex = /<script[^>]*>([\s\S]+?)<\/script>/im;
	const match = scriptRegex.exec(content);

	if (!match) {
		return null;
	}

	// 统一换行符为 LF (与浏览器计算方式一致)
	const scriptContent = match[1].replace(/\r\n/g, '\n');

	const hash = crypto
		.createHash('sha256')
		.update(scriptContent, 'utf8')
		.digest('base64');

	return `sha256-${hash}`;
}

function updateCspHash(content, newHash) {
	// 匹配 CSP 中的 script-src hash
	const cspRegex = /(script-src\s+')sha256-[A-Za-z0-9+/=]+(')/;
	return content.replace(cspRegex, `$1${newHash}$2`);
}

function processFile(filePath) {
	if (!fs.existsSync(filePath)) {
		console.log(`  跳过 (不存在): ${filePath}`);
		return;
	}

	const content = fs.readFileSync(filePath, 'utf-8');

	// 计算脚本 hash
	const newHash = calculateScriptHash(content);
	if (!newHash) {
		console.log(`  跳过 (无脚本): ${filePath}`);
		return;
	}

	// 获取当前 CSP hash
	const currentHashMatch = content.match(/script-src\s+'(sha256-[A-Za-z0-9+/=]+)'/);
	const currentHash = currentHashMatch ? currentHashMatch[1] : null;

	if (currentHash === newHash) {
		console.log(`  ✓ 已是最新: ${path.basename(path.dirname(path.dirname(filePath)))}/.../index.html`);
		return;
	}

	// 更新文件
	const updatedContent = updateCspHash(content, newHash);
	fs.writeFileSync(filePath, updatedContent, 'utf-8');

	console.log(`  ✓ 已更新: ${path.basename(path.dirname(path.dirname(filePath)))}/.../index.html`);
	console.log(`    旧: ${currentHash}`);
	console.log(`    新: ${newHash}`);
}

function main() {
	console.log('更新 webview CSP hash...\n');

	for (const filePath of indexPaths) {
		processFile(filePath);
	}

	console.log('\n完成!');
}

main();
