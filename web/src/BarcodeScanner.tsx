import { useEffect, useRef, useState, type ChangeEvent } from "react"
import { ScanBarcode } from "lucide-react"
import { normalizeBarcode, type BarcodeProduct, type BarcodeResult } from "../../src/barcode/code"
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./components/ui/dialog"

export function BarcodeScanner({ onUse, disabled, remaining }: { onUse: (product: BarcodeProduct) => void; disabled?: boolean; remaining: number }) {
	const [open, setOpen] = useState(false)
	return <Dialog open={open} onOpenChange={setOpen}>
		<DialogTrigger asChild><button type="button" className="ghost inline-flex items-center gap-2" disabled={disabled}><ScanBarcode className="size-4" />Scan barcode</button></DialogTrigger>
		<DialogContent className="max-h-[90dvh] overflow-y-auto">
			<DialogTitle>Identify a product</DialogTitle>
			<DialogDescription>Scan an EAN / UPC barcode, choose a photo or enter the digits below it.</DialogDescription>
			{open && <BarcodePanel remaining={remaining} onUse={product => { onUse(product); setOpen(false) }} />}
		</DialogContent>
	</Dialog>
}

function BarcodePanel({ onUse, remaining }: { onUse: (product: BarcodeProduct) => void; remaining: number }) {
	const [code, setCode] = useState("")
	const [mode, setMode] = useState<"idle" | "starting" | "camera" | "photo" | "lookup">("idle")
	const [message, setMessage] = useState("")
	const [product, setProduct] = useState<BarcodeProduct | null>(null)
	const video = useRef<HTMLVideoElement>(null)
	const controls = useRef<{ stop: () => void } | null>(null)
	const media = useRef<MediaStream | null>(null)
	const request = useRef<AbortController | null>(null)
	const generation = useRef(0)
	const busy = mode === "starting" || mode === "photo" || mode === "lookup"

	function stopCamera() {
		controls.current?.stop(); controls.current = null
		media.current?.getTracks().forEach(track => track.stop()); media.current = null
		if (video.current) video.current.srcObject = null
	}
	function cancel() {
		generation.current++; request.current?.abort(); stopCamera(); setMode("idle")
	}
	useEffect(() => () => { generation.current++; request.current?.abort(); stopCamera() }, [])
	useEffect(() => {
		const hide = () => { if (document.hidden) cancel() }
		document.addEventListener("visibilitychange", hide)
		return () => document.removeEventListener("visibilitychange", hide)
	}, [])

	async function identify(raw: string) {
		stopCamera(); request.current?.abort()
		const gen = ++generation.current
		const barcode = normalizeBarcode(raw)
		setCode(raw); setProduct(null); setMessage("")
		if (!barcode) { setMode("idle"); setMessage("Check the digits: this is not a valid EAN-8, UPC-A, EAN-13 or GTIN-14 barcode."); return }
		setCode(barcode); setMode("lookup")
		const controller = new AbortController(); request.current = controller
		const timer = setTimeout(() => controller.abort(), 20_000)
		try {
			const response = await fetch("/api/barcode/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ barcode }), signal: controller.signal })
			const data = await response.json() as BarcodeResult & { error?: string }
			if (gen !== generation.current) return
			if (response.ok && data.status === "found") setProduct(data.product)
			else setMessage(data.error ?? (data.status !== "found" ? data.message : "Could not identify this product."))
		} catch {
			if (gen === generation.current) setMessage("The lookup could not finish. Check your connection and try again.")
		} finally { clearTimeout(timer); if (gen === generation.current) setMode("idle") }
	}

	async function startCamera() {
		cancel(); setProduct(null); setMessage("")
		if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
			setMessage("Camera scanning needs HTTPS or localhost and a supported browser. You can still choose a photo or enter the digits."); return
		}
		const gen = ++generation.current; setMode("starting")
		try {
			const { createBarcodeReader } = await import("./barcode-reader")
			if (gen !== generation.current) return
			const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } })
			if (gen !== generation.current) { stream.getTracks().forEach(track => track.stop()); return }
			media.current = stream
			const reader = createBarcodeReader()
			const scanner = await reader.decodeFromStream(stream, video.current!, (result, _error, control) => {
				if (gen !== generation.current || !result) return
				const value = normalizeBarcode(result.getText())
				if (!value) return
				control.stop(); void identify(value)
			})
			if (gen !== generation.current) scanner.stop()
			else { controls.current = scanner; setMode("camera") }
		} catch (error) {
			if (gen !== generation.current) return
			stopCamera(); setMode("idle")
			const name = error instanceof Error ? error.name : ""
			setMessage(name === "NotAllowedError" ? "Camera permission was denied. Allow access in your browser, choose a photo or enter the digits." : name === "NotFoundError" ? "No camera was found. Choose a photo or enter the digits instead." : "Could not start the camera. Close other apps using it, or choose a photo.")
		}
	}

	async function readPhoto(event: ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0]; event.target.value = ""
		if (!file) return
		cancel(); setMessage(""); setProduct(null)
		if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
			setMessage("Choose a JPG, PNG or WebP image up to 10 MB."); return
		}
		const gen = ++generation.current; setMode("photo")
		const url = URL.createObjectURL(file)
		try {
			const { createBarcodeReader } = await import("./barcode-reader")
			if (gen !== generation.current) return
			const img = new Image(); img.src = url; await img.decode()
			if (gen !== generation.current) return
			const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight))
			const canvas = document.createElement("canvas")
			canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
			canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height)
			const result = createBarcodeReader().decodeFromCanvas(canvas)
			if (gen === generation.current) await identify(result.getText())
		} catch {
			if (gen === generation.current) { setMode("idle"); setMessage("No readable barcode found. Try a sharp, well-lit photo with the complete barcode, or enter the digits.") }
		} finally { URL.revokeObjectURL(url) }
	}

	const fits = product ? `I want ${product.title}.`.length <= remaining : true
	return <div className="grid gap-4">
		<p className="m-0 text-xs text-[var(--muted)]">Photos and camera frames stay on your device. Only the barcode digits are sent for product lookup.</p>
		<div className="flex flex-wrap items-center gap-3">
			<button type="button" className="primary" onClick={() => void startCamera()} disabled={busy || mode === "camera"}>Use camera</button>
			{mode !== "idle" && <button type="button" className="ghost" onClick={cancel}>Cancel {mode === "camera" || mode === "starting" ? "camera" : "lookup"}</button>}
			<label className="grid gap-1 text-sm">Photo of barcode<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => void readPhoto(event)} className="max-w-full text-xs" /></label>
		</div>
		<video ref={video} muted playsInline autoPlay aria-label="Barcode camera preview" className={`aspect-video w-full rounded-lg bg-black ${mode === "camera" || mode === "starting" ? "" : "hidden"}`} />
		{mode === "camera" && <p role="status" className="m-0 text-sm">Hold the full barcode steady inside the camera view.</p>}
		<form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void identify(code) }}>
			<label className="grid flex-1 gap-1 text-sm">Barcode digits<input value={code} inputMode="numeric" autoComplete="off" maxLength={40} onChange={event => { setCode(event.target.value); setProduct(null); setMessage("") }} disabled={busy} className="rounded-md border border-[var(--rule)] p-2 font-mono" placeholder="EAN / UPC" /></label>
			<button className="primary" disabled={busy || !code.trim()}>Identify</button>
		</form>
		{busy && <p role="status" className="m-0 text-sm">{mode === "photo" ? "Reading barcode…" : mode === "starting" ? "Starting camera…" : "Looking up product…"}</p>}
		{message && <p role="alert" className="m-0 text-sm">{message}</p>}
		{product && <section aria-label="Identified product" className="grid gap-2 rounded-lg border border-[var(--rule)] p-4">
			{product.image && <img src={product.image} alt="" referrerPolicy="no-referrer" className="h-24 w-24 object-contain" onError={event => { event.currentTarget.hidden = true }} />}
			<h3 className="m-0 font-semibold">{product.title}</h3>
			{product.brand && <p className="m-0 text-sm">{product.brand}</p>}
			<p className="m-0 font-mono text-xs">{product.barcode}</p>
			<a href={product.source.url} target="_blank" rel="noopener noreferrer" className="text-sm">Source: {product.source.name} ↗</a>
			<p className="m-0 text-xs text-[var(--muted)]">Check that the name matches your package. Product identity does not confirm a shop price or availability.</p>
			<button type="button" className="primary" disabled={!fits} onClick={() => onUse(product)}>Add to request</button>
			{!fits && <p className="m-0 text-xs">Your request is too long. Shorten it before adding this product.</p>}
		</section>}
	</div>
}
