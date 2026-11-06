// QR version 4, error correction L, byte mode, mask 0. The fixed version keeps
// local share URLs offline and dependency-free (up to 78 UTF-8 bytes).
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 78) throw new Error('Endereço longo demais para o QR code.');
  const bits = [];
  const push = (value, count) => { for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(4, 4); push(bytes.length, 8);
  bytes.forEach(b => push(b, 8));
  push(0, Math.min(4, 640 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0));
  for (let pad = 0; data.length < 80; pad++) data.push(pad % 2 ? 0x11 : 0xec);
  const mul = (a, b) => {
    let result = 0;
    for (; b; b >>>= 1) { if (b & 1) result ^= a; a <<= 1; if (a & 256) a ^= 0x11d; }
    return result;
  };
  let generator = [1], root = 1;
  for (let i = 0; i < 20; i++) {
    const next = new Array(generator.length + 1).fill(0);
    generator.forEach((v, j) => { next[j] ^= v; next[j + 1] ^= mul(v, root); });
    generator = next; root = mul(root, 2);
  }
  const ec = new Array(20).fill(0);
  for (const value of data) {
    const factor = value ^ ec.shift(); ec.push(0);
    for (let j = 0; j < 20; j++) ec[j] ^= mul(generator[j + 1], factor);
  }
  const stream = [];
  for (const value of [...data, ...ec]) for (let i = 7; i >= 0; i--) stream.push((value >>> i) & 1);
  const size = 33;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < size && y < size) { matrix[y][x] = !!v; reserved[y][x] = true; } };
  for (const [cx, cy] of [[3, 3], [29, 3], [3, 29]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)); set(cx + dx, cy + dy, d !== 2 && d !== 4);
    }
  }
  for (let i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(26 + dx, 26 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  // BCH format bits for level L and mask 0 (including the format XOR mask).
  const format = 0x77c4, bit = i => (format >>> i) & 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
  let index = 0, up = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right--;
    for (let row = 0; row < size; row++) {
      const y = up ? size - 1 - row : row;
      for (let dx = 0; dx < 2; dx++) {
        const x = right - dx;
        if (!reserved[y][x]) matrix[y][x] = !!((stream[index++] || 0) ^ ((x + y) % 2 === 0 ? 1 : 0));
      }
    }
    up = !up;
  }
  return matrix;
}

export function qrPath(matrix) {
  return matrix.flatMap((row, y) => row.flatMap((dark, x) => dark ? [`M${x + 4},${y + 4}h1v1h-1z`] : [])).join('');
}
