// ===== 导航栏滚动效果 =====
const navbar = document.querySelector('.navbar');
let lastScroll = 0;

window.addEventListener('scroll', () => {
	const currentScroll = window.pageYOffset;

	// 添加/移除背景模糊效果
	if (currentScroll > 50) {
		navbar.style.background = 'rgba(10, 10, 15, 0.95)';
	} else {
		navbar.style.background = 'rgba(10, 10, 15, 0.8)';
	}

	lastScroll = currentScroll;
});

// ===== 平滑滚动 =====
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
	anchor.addEventListener('click', function (e) {
		e.preventDefault();
		const target = document.querySelector(this.getAttribute('href'));
		if (target) {
			target.scrollIntoView({
				behavior: 'smooth',
				block: 'start'
			});
		}
	});
});

// ===== 特性卡片动画 =====
const observerOptions = {
	threshold: 0.1,
	rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
	entries.forEach(entry => {
		if (entry.isIntersecting) {
			entry.target.style.opacity = '1';
			entry.target.style.transform = 'translateY(0)';
		}
	});
}, observerOptions);

// 初始化卡片动画
document.querySelectorAll('.feature-card, .download-card').forEach(card => {
	card.style.opacity = '0';
	card.style.transform = 'translateY(20px)';
	card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
	observer.observe(card);
});

// ===== 代码打字效果 =====
const codeElement = document.querySelector('.code-content code');
if (codeElement) {
	const originalHTML = codeElement.innerHTML;

	// 可选：添加光标闪烁效果
	const cursor = document.createElement('span');
	cursor.className = 'cursor';
	cursor.innerHTML = '|';
	cursor.style.cssText = 'animation: blink 1s infinite; color: var(--primary);';

	// 添加光标闪烁动画
	const style = document.createElement('style');
	style.textContent = `
        @keyframes blink {
            0%, 50% { opacity: 1; }
            51%, 100% { opacity: 0; }
        }
    `;
	document.head.appendChild(style);
}

// ===== 检测操作系统并高亮对应下载卡片 =====
function detectOS() {
	const userAgent = navigator.userAgent.toLowerCase();
	let os = 'unknown';

	if (userAgent.includes('win')) {
		os = 'windows';
	} else if (userAgent.includes('mac')) {
		os = 'macos';
	} else if (userAgent.includes('linux')) {
		os = 'linux';
	}

	// 高亮对应的下载卡片
	const downloadCards = document.querySelectorAll('.download-card');
	downloadCards.forEach(card => {
		const cardOS = card.querySelector('h3').textContent.toLowerCase();
		if ((os === 'windows' && cardOS === 'windows') ||
			(os === 'macos' && cardOS === 'macos') ||
			(os === 'linux' && cardOS === 'linux')) {
			card.style.borderColor = 'var(--primary)';
			card.style.boxShadow = '0 0 30px rgba(99, 102, 241, 0.2)';
		}
	});
}

// 页面加载完成后检测操作系统
window.addEventListener('load', detectOS);

// ===== 鼠标跟随光效 =====
document.addEventListener('mousemove', (e) => {
	const cards = document.querySelectorAll('.feature-card, .download-card');
	cards.forEach(card => {
		const rect = card.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;

		card.style.setProperty('--mouse-x', `${x}px`);
		card.style.setProperty('--mouse-y', `${y}px`);
	});
});
