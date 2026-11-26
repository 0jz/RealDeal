// Deterministic "template" answers used (a) by the no-key TemplateInferenceRunner and
// (b) as the fallback when an LLM answer fails a check (bad JSON, unknown ids, invented numbers).
import { fmtRSD } from "./rules.js";

const ACCESSORY = /\b(maska|futrola|nosac|filteri|papir|jastucici|baterija|kabl|narukvica|torba|nastavak|dzojstik|kafa|punjac|staklo)\b/;
const VARIANT_WORDS = /\b(pro|max|slim|plus|mini|ultra|lite)\b/;
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Rule-based KP matching: exact model tokens, no accessories, no other variants. */
export function templateKpSelect(product, candidates) {
  const pTokens = norm(product).split(" ");
  const pNumeric = new Set(pTokens.filter((t) => /\d/.test(t)));
  const matches = [], rejected = [];
  for (const c of candidates) {
    const t = norm(c.title); const tokens = t.split(" ");
    const reason =
      c.condition === "new-accessory" || ACCESSORY.test(t) ? "accessory, not the product" :
      VARIANT_WORDS.test(t) && !VARIANT_WORDS.test(norm(product)) ? "different variant (pro/max/slim…)" :
      tokens.some((x) => /\d/.test(x) && !pNumeric.has(x)) ? "different size/capacity/model number" :
      !pTokens.every((x) => tokens.includes(x)) ? "does not contain the full model name" : null;
    if (reason) rejected.push({ id: c.id, reason }); else matches.push({ id: c.id, reason: "same model name and capacity" });
  }
  return { matches, rejected };
}

export const templates = {
  search_kp_listings(out) {
    if (!out?.candidates) return JSON.stringify({ matches: [], rejected: [], note: "tool error" });
    return JSON.stringify(templateKpSelect(out.product || out.query, out.candidates));
  },
  audit_retailer(out) {
    if (out?.score === undefined) return "Audit unavailable.";
    return `${out.retailerName}: ${out.violations} of ${out.offersAudited} audited Black Friday offers advertise a "before" price above the retailer's own 30-day minimum, and ${out.hikes} offers had a price hike of 15% or more in the 21 days before Black Friday. Trust score ${out.score}/100${out.flagged ? " — flagged" : ""}.`;
  },
  compute_options(out) {
    if (!out?.options) return "Options unavailable.";
    const t = out.thirtyDay;
    const parts = [];
    if (t?.status === "likely-violation") parts.push(`The ad at ${out.adRetailer} shows a "before" price of ${fmtRSD(t.advertisedBefore.v)}, but the lowest price in the previous 30 days was ${fmtRSD(t.min30.v)} — a likely violation of the 30-day rule; ${fmtRSD(t.fakeDiscount.v)} of the advertised saving is not real.`);
    else if (t?.status === "real-discount") parts.push(`The ad at ${out.adRetailer} is a real discount: ${fmtRSD(t.realDiscount.v)} under the 30-day minimum of ${fmtRSD(t.min30.v)}.`);
    else if (t?.status === "no-real-discount") parts.push(`The ad at ${out.adRetailer} is not cheaper than its own 30-day minimum of ${fmtRSD(t.min30.v)}.`);
    const rec = out.options.find((o) => o.id === out.recommended);
    if (rec) parts.push(`Best option: ${rec.title} at ${fmtRSD(rec.price.v)}${rec.saving.v > 0 ? `, ${fmtRSD(rec.saving.v)} less than the ad you saw` : ""}. ${out.why}`);
    if (out.interception?.flagged?.length) parts.push(`ShopTrust excluded ${out.interception.flaggedNames.join(", ")} from this verdict.`);
    return parts.join(" ");
  },
};
