import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sourcePath = resolve(root, 'src/vs/chenille/browser/media/chenille-icon.png');

function decodePng(buffer) {
	if (buffer.readUInt32BE(0) !== 0x89504e47) {
		throw new Error('Not a PNG file');
	}
	const width = buffer.readUInt32BE(16);
	const height = buffer.readUInt32BE(20);
	const bitDepth = buffer[24];
	const colorType = buffer[25];
	const interlace = buffer[28];
	if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
		throw new Error(`Unsupported PNG: depth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
	}

	const idat = [];
	let offset = 8;
	while (offset < buffer.length) {
		const length = buffer.readUInt32BE(offset);
		const type = buffer.toString('ascii', offset + 4, offset + 8);
		const data = buffer.subarray(offset + 8, offset + 8 + length);
		if (type === 'IDAT') {
			idat.push(data);
		}
		offset += 12 + length;
		if (type === 'IEND') {
			break;
		}
	}

	const raw = inflateSync(Buffer.concat(idat));
	const bpp = 4;
	const stride = width * bpp;
	const pixels = Buffer.alloc(width * height * bpp);
	let rawOffset = 0;

	for (let y = 0; y < height; y++) {
		const filter = raw[rawOffset++];
		const row = raw.subarray(rawOffset, rawOffset + stride);
		rawOffset += stride;
		const out = y * stride;
		const prev = out - stride;

		for (let x = 0; x < stride; x++) {
			const value = row[x];
			const left = x >= bpp ? pixels[out + x - bpp] : 0;
			const up = y > 0 ? pixels[prev + x] : 0;
			const upLeft = y > 0 && x >= bpp ? pixels[prev + x - bpp] : 0;
			let decoded;
			switch (filter) {
				case 0: decoded = value; break;
				case 1: decoded = value + left; break;
				case 2: decoded = value + up; break;
				case 3: decoded = value + ((left + up) >> 1); break;
				case 4: {
					const p = left + up - upLeft;
					const pa = Math.abs(p - left);
					const pb = Math.abs(p - up);
					const pc = Math.abs(p - upLeft);
					const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
					decoded = value + predictor;
					break;
				}
				default: throw new Error(`Unsupported PNG filter: ${filter}`);
			}
			pixels[out + x] = decoded & 0xff;
		}
	}

	return { width, height, pixels };
}

function lanczos(value) {
	if (value === 0) {
		return 1;
	}
	if (value < -3 || value > 3) {
		return 0;
	}
	const x = Math.PI * value;
	return (3 * Math.sin(x) * Math.sin(x / 3)) / (x * x);
}

function resize({ width, height, pixels }, targetWidth, targetHeight) {
	const source = new Float32Array(width * height * 4);
	for (let i = 0; i < pixels.length; i++) {
		source[i] = pixels[i];
	}

	const horizontal = new Float32Array(targetWidth * height * 4);
	horizontalResize(source, width, height, targetWidth, horizontal);
	const vertical = new Float32Array(targetWidth * targetHeight * 4);
	verticalResize(horizontal, targetWidth, height, targetHeight, vertical);

	const output = Buffer.alloc(targetWidth * targetHeight * 4);
	for (let i = 0; i < output.length; i++) {
		output[i] = Math.max(0, Math.min(255, Math.round(vertical[i])));
	}
	return { width: targetWidth, height: targetHeight, pixels: output };
}

function horizontalResize(source, width, height, targetWidth, output) {
	const scale = targetWidth / width;
	const support = 3;
	for (let y = 0; y < height; y++) {
		for (let dx = 0; dx < targetWidth; dx++) {
			const center = (dx + 0.5) / scale - 0.5;
			const start = Math.floor(center - support * Math.max(1, 1 / scale));
			const end = Math.ceil(center + support * Math.max(1, 1 / scale));
			let weightSum = 0;
			const accum = [0, 0, 0, 0];
			for (let sx = start; sx <= end; sx++) {
				const clamped = Math.max(0, Math.min(width - 1, sx));
				const weight = lanczos((center - sx) * Math.min(1, scale));
				if (weight === 0) {
					continue;
				}
				weightSum += weight;
				const sourceIndex = (y * width + clamped) * 4;
				for (let channel = 0; channel < 4; channel++) {
					accum[channel] += source[sourceIndex + channel] * weight;
				}
			}
			const outIndex = (y * targetWidth + dx) * 4;
			for (let channel = 0; channel < 4; channel++) {
				output[outIndex + channel] = weightSum === 0 ? 0 : accum[channel] / weightSum;
			}
		}
	}
}

function verticalResize(source, width, height, targetHeight, output) {
	const scale = targetHeight / height;
	const support = 3;
	for (let dy = 0; dy < targetHeight; dy++) {
		const center = (dy + 0.5) / scale - 0.5;
		const start = Math.floor(center - support * Math.max(1, 1 / scale));
		const end = Math.ceil(center + support * Math.max(1, 1 / scale));
		for (let x = 0; x < width; x++) {
			let weightSum = 0;
			const accum = [0, 0, 0, 0];
			for (let sy = start; sy <= end; sy++) {
				const clamped = Math.max(0, Math.min(height - 1, sy));
				const weight = lanczos((center - sy) * Math.min(1, scale));
				if (weight === 0) {
					continue;
				}
				weightSum += weight;
				const sourceIndex = (clamped * width + x) * 4;
				for (let channel = 0; channel < 4; channel++) {
					accum[channel] += source[sourceIndex + channel] * weight;
				}
			}
			const outIndex = (dy * width + x) * 4;
			for (let channel = 0; channel < 4; channel++) {
				output[outIndex + channel] = weightSum === 0 ? 0 : accum[channel] / weightSum;
			}
		}
	}
}

const crcTable = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(buffer) {
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const typeBuffer = Buffer.from(type, 'ascii');
	const body = Buffer.concat([typeBuffer, data]);
	const result = Buffer.alloc(12 + data.length);
	result.writeUInt32BE(data.length, 0);
	body.copy(result, 4);
	result.writeUInt32BE(crc32(body), 8 + data.length);
	return result;
}

function encodePng({ width, height, pixels }) {
	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0;
		pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 6;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

function encodeIco(images) {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(images.length, 4);

	const entries = [];
	const payloads = [];
	let offset = 6 + 16 * images.length;

	for (const image of images) {
		const { width, height, pixels } = image;
		const rowSize = width * 4;
		const maskSize = Math.ceil(width / 32) * 4 * height;
		const bitmapHeader = Buffer.alloc(40);
		bitmapHeader.writeUInt32LE(40, 0);
		bitmapHeader.writeInt32LE(width, 4);
		bitmapHeader.writeInt32LE(height * 2, 8);
		bitmapHeader.writeUInt16LE(1, 12);
		bitmapHeader.writeUInt16LE(32, 14);
		bitmapHeader.writeUInt32LE(0, 16);
		bitmapHeader.writeUInt32LE(rowSize * height + maskSize, 20);

		const xor = Buffer.alloc(rowSize * height);
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const src = ((height - 1 - y) * width + x) * 4;
				const dst = (y * width + x) * 4;
				xor[dst] = pixels[src + 2];
				xor[dst + 1] = pixels[src + 1];
				xor[dst + 2] = pixels[src];
				xor[dst + 3] = pixels[src + 3];
			}
		}

		const payload = Buffer.concat([bitmapHeader, xor, Buffer.alloc(maskSize)]);
		const entry = Buffer.alloc(16);
		entry[0] = width >= 256 ? 0 : width;
		entry[1] = height >= 256 ? 0 : height;
		entry.writeUInt16LE(1, 4);
		entry.writeUInt16LE(32, 6);
		entry.writeUInt32LE(payload.length, 8);
		entry.writeUInt32LE(offset, 12);
		entries.push(entry);
		payloads.push(payload);
		offset += payload.length;
	}

	return Buffer.concat([header, ...entries, ...payloads]);
}

function encodeIcns(images) {
	const chunks = images.map(({ type, png }) => {
		const header = Buffer.alloc(8);
		header.write(type, 0, 'ascii');
		header.writeUInt32BE(png.length + 8, 4);
		return Buffer.concat([header, png]);
	});
	const body = Buffer.concat(chunks);
	const header = Buffer.alloc(8);
	header.write('icns', 0, 'ascii');
	header.writeUInt32BE(body.length + 8, 4);
	return Buffer.concat([header, body]);
}

const source = decodePng(readFileSync(sourcePath));
const master = resize(source, 1024, 1024);

function pngAt(size) {
	return encodePng(resize(master, size, size));
}

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
writeFileSync(resolve(root, 'resources/win32/code.ico'), encodeIco(icoSizes.map(size => resize(master, size, size))));
writeFileSync(resolve(root, 'resources/win32/sessions.ico'), encodeIco(icoSizes.map(size => resize(master, size, size))));
writeFileSync(resolve(root, 'resources/win32/code_150x150.png'), pngAt(150));
writeFileSync(resolve(root, 'resources/win32/code_70x70.png'), pngAt(70));

const icnsEntries = [
	['icp4', 16],
	['icp5', 32],
	['icp6', 64],
	['ic07', 128],
	['ic08', 256],
	['ic09', 512],
	['ic10', 1024],
	['ic11', 32],
	['ic12', 64],
	['ic13', 256],
	['ic14', 512],
];
writeFileSync(resolve(root, 'resources/darwin/code.icns'), encodeIcns(icnsEntries.map(([type, size]) => ({ type, png: pngAt(size) }))));

writeFileSync(resolve(root, 'resources/linux/code.png'), pngAt(512));
writeFileSync(resolve(root, 'src/vs/chenille/browser/media/chenille-icon-large.png'), encodePng(master));

console.log('Generated Chenille app icons');
