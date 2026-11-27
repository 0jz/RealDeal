/** The shop's own taxonomy, without treating a brand name as a device category. */
export function pageCategory(html: string): string | undefined {
	let breadcrumb: string | undefined
	for (const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
		let data: unknown
		try { data = JSON.parse(script[1]) } catch { continue }
		for (const node of objects(data)) {
			if (node["@type"] === "Product" && typeof node.category === "string") return node.category
			if (node["@type"] === "BreadcrumbList" && Array.isArray(node.itemListElement)) {
				breadcrumb = node.itemListElement.slice(1, -1)
					.map(item => typeof item?.name === "string" ? item.name : "").filter(Boolean).join(" > ") || undefined
			}
		}
	}
	return breadcrumb
}

function objects(value: unknown): Record<string, unknown>[] {
	if (Array.isArray(value)) return value.flatMap(objects)
	if (!value || typeof value !== "object") return []
	const node = value as Record<string, unknown>
	return [node, ...objects(node["@graph"])]
}
