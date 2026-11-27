import { BrowserMultiFormatReader } from "@zxing/browser"
import { BarcodeFormat, DecodeHintType } from "@zxing/library"

/** Loaded only when scanning starts, so the decoder stays out of the landing bundle. */
export function createBarcodeReader() {
	return new BrowserMultiFormatReader(new Map<DecodeHintType, boolean | BarcodeFormat[]>([
		[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.ITF]],
		[DecodeHintType.TRY_HARDER, true],
	]), { delayBetweenScanAttempts: 200, delayBetweenScanSuccess: 1000 })
}
