import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, SetStateAction } from "react"
import { BarcodeScanner } from "./BarcodeScanner"

export const MAX_CHARS = 1000
const WARN_CHARS = 800
const EXAMPLES = [
	"New phone for 75000 RSD. I can sell my iPhone 13, it's in good shape.",
	"Hoću iPhone 15 za 85k, prodajem stari ajfon 13",
	"Laptop do 100 hiljada",
]

/** The prompt in the front page hero. The plan is made from here; Planner shows the result. */
export function AskBox({ text, setText, busy, checking, miss, error, onPlan }: {
	text: string
	setText: Dispatch<SetStateAction<string>>
	busy: boolean
	checking: boolean
	miss: { message: string; unknown: string[] } | null
	error: string
	onPlan: () => void
}) {
	const onPromptKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onPlan() }
	}

	return <section id="ask" className="hero-ask" aria-labelledby="ask-title">
		<h2 id="ask-title">What do you want to buy or sell?</h2>
		{error && <p className="alert" role="alert">{error}</p>}
		<div className="ask-box">
			<label className="field"><span className="sr-only">Describe what you want to buy or sell</span>
				<textarea id="ask-input" value={text} maxLength={MAX_CHARS} rows={1} placeholder="e.g. New phone for 75000 RSD. I can sell my old iPhone 13." aria-describedby="ask-count" onChange={e => setText(e.target.value)} onKeyDown={onPromptKey} readOnly={checking} />
			</label>
			<div className="ask-foot">
				<span id="ask-count" className={text.length >= WARN_CHARS ? "counter near" : "counter"} aria-live="polite">{text.length >= WARN_CHARS ? `${text.length}/${MAX_CHARS}` : ""}</span>
				<button type="button" className="primary" disabled={busy || checking || !text.trim()} onClick={onPlan}>{busy || checking ? "Checking…" : "Make my plan"}</button>
			</div>
		</div>
		{!checking && <BarcodeScanner disabled={busy} remaining={MAX_CHARS - text.length - (text.trim() ? 2 : 0)} onUse={product => setText(current => {
			const previous = current.trim()
			const separator = previous ? /[.!?;]$/.test(previous) ? "\n" : ".\n" : ""
			return `${previous}${separator}I want ${product.title}.`
		})} />}
		{miss && <p className="alert" role="alert">{miss.unknown.length ? `I couldn't match: ${miss.unknown.join(", ")}` : miss.message}</p>}
		{!checking && <div className="examples">
			<p className="label">Or try one of these</p>
			<ul>{EXAMPLES.map(ex => <li key={ex}><button type="button" onClick={() => setText(ex)}>{ex}</button></li>)}</ul>
		</div>}
	</section>
}
