// Minimal EAN-13 → SVG encoder (for the printable demo barcode sheet). Public-domain algorithm (GS1 General Specifications).
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = L.map((p) => [...p].map((b) => (b === "0" ? "1" : "0")).reverse().join(""));
const R = L.map((p) => [...p].map((b) => (b === "0" ? "1" : "0")).join(""));
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

export function ean13Valid(code) {
  if (!/^\d{13}$/.test(code)) return false;
  const d = [...code].map(Number);
  const sum = d.slice(0, 12).reduce((a, x, i) => a + x * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === d[12];
}

export function ean13Svg(code, { module = 3, height = 90 } = {}) {
  if (!ean13Valid(code)) throw new Error("invalid EAN-13: " + code);
  const d = [...code].map(Number), par = PARITY[d[0]];
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (par[i - 1] === "L" ? L : G)[d[i]];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  bits += "101";
  const quiet = 11, W = (bits.length + quiet * 2) * module, guard = new Set([0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]);
  let rects = "";
  for (let i = 0; i < bits.length; i++) if (bits[i] === "1") rects += `<rect x="${(quiet + i) * module}" y="0" width="${module}" height="${guard.has(i) ? height + 8 : height}"/>`;
  const t = (s, x) => `<text x="${x}" y="${height + 22}" font-size="${module * 6}" font-family="monospace" text-anchor="middle">${s}</text>`;
  const text = t(d[0], (quiet - 5) * module) + t(code.slice(1, 7), (quiet + 3 + 21) * module) + t(code.slice(7), (quiet + 50 + 21) * module);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height + 28}" width="${W}" height="${height + 28}" role="img" aria-label="EAN-13 ${code}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects}</g>${text}</svg>`;
}
