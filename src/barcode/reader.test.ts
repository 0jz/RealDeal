import assert from "node:assert/strict"
import { test } from "node:test"
import { BinaryBitmap, HybridBinarizer, RGBLuminanceSource } from "@zxing/library"
import { createBarcodeReader } from "../../web/src/barcode-reader"
import { barcodeKey } from "./code"

// Independent EAN encoder creates test pixels; production uses ZXing to decode.
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"]
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"]
const parity = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"]
const inverse = (s: string) => [...s].map(b => b === "1" ? "0" : "1").join("")
function pixels(code: string) {
	if (code.length === 12) code = `0${code}`
	const bits = code.length === 8
		? `101${[...code.slice(0, 4)].map(n => L[+n]).join("")}01010${[...code.slice(4)].map(n => inverse(L[+n])).join("")}101`
		: `101${[...code.slice(1, 7)].map((n, i) => (parity[+code[0]][i] === "L" ? L : G)[+n]).join("")}01010${[...code.slice(7)].map(n => inverse(L[+n])).join("")}101`
	const width = (bits.length + 24) * 3, height = 180
	const data = new Uint8ClampedArray(width * height).fill(255)
	for (let y = 15; y < 165; y++) for (let i = 0; i < bits.length; i++) {
		if (bits[i] === "1") data.fill(0, y * width + (i + 12) * 3, y * width + (i + 13) * 3)
	}
	return new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(data, width, height)))
}

test("the production scanner decodes EAN-13, EAN-8 and UPC-A image pixels", () => {
	for (const code of ["5099206061309", "3017620422003", "96385074", "036000291452"]) {
		assert.equal(barcodeKey(createBarcodeReader().decodeBitmap(pixels(code)).getText()), barcodeKey(code))
	}
})

test("a barcode image with a wrong check digit is not accepted by the scanner", () => {
	assert.throws(() => createBarcodeReader().decodeBitmap(pixels("5099206061308")))
})
