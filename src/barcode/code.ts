/** Retail GTINs only. Keep leading zeros; never turn a barcode into a number. */
export function normalizeBarcode(value: unknown): string | null {
	if (typeof value !== "string" || value.length > 40) return null
	const code = value.replace(/[\s-]/g, "")
	if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(code) || /^0+$/.test(code)) return null
	let sum = 0
	for (let i = code.length - 2, weight = 3; i >= 0; i--, weight = 4 - weight) sum += Number(code[i]) * weight
	return (10 - sum % 10) % 10 === Number(code.at(-1)) ? code : null
}

/** UPC-A and its zero-padded EAN/GTIN representation identify the same item. */
export const barcodeKey = (code: string) => code.padStart(14, "0")

export type BarcodeProduct = {
	barcode: string
	title: string
	brand: string | null
	category: string | null
	image: string | null
	source: { name: string; url: string }
}

export type BarcodeResult =
	| { status: "found"; product: BarcodeProduct }
	| { status: "not_found" | "unavailable"; barcode: string; message: string }
