import { SITE_NAMES, SCOUT_SITES, type ScoutResult, type SiteReport, type ScoutSite } from "../../src/scout/types"

function siteLine(site: ScoutSite, report: SiteReport): string {
	const shop = SITE_NAMES[site]
	if (report.status === "ok") return `${shop}: ${report.pages} pages read, ${report.found} found`
	if (report.status === "blocked") return `${shop}: blocked the request`
	if (report.status === "off") return `${shop}: not checked${report.note ? ` (${report.note})` : ""}`
	if (report.status === "skipped") return `${shop}: not sold here`
	return `${shop}: couldn't finish`
}

export function ScoutsRead({ scout }: { scout?: ScoutResult }) {
	if (!scout) return null
	const n = scout.trace.length
	return <details className="mt-4 border-t border-[var(--rule)] pt-3 text-sm">
		<summary className="cursor-pointer font-semibold text-[var(--muted)]">What the scouts read ({n})</summary>
		<div className="mt-3 grid gap-3">
			<ul className="m-0 grid list-none gap-1 p-0 text-[var(--muted)]">
				{SCOUT_SITES.map(site => {
					const report = scout.sites[site]
					if (!report) return null
					return <li key={site}>{siteLine(site, report)}</li>
				})}
			</ul>
			{n > 0 && <ul className="m-0 grid list-none gap-2 p-0">
				{scout.trace.map((row, i) => <li key={`${row.url}-${i}`} className="grid gap-0.5 border-b border-[var(--rule)] pb-2 last:border-b-0 last:pb-0">
					<div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
						<span className="font-semibold">{SITE_NAMES[row.site]}</span>
						<a href={row.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 break-words">{row.title}</a>
					</div>
					<div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[var(--muted)]">
						<span className="font-mono tabular-nums">{row.price.toLocaleString("sr-RS")} RSD</span>
						<span>score {row.score == null ? "–" : row.score.toFixed(2)}</span>
						<span>{row.kept ? "kept" : [row.drop, row.why].filter(Boolean).join(": ")}</span>
					</div>
				</li>)}
			</ul>}
		</div>
	</details>
}
