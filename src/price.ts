// Normalize the JOKE_PRICE_USD env value into a consistent "$N.NN" display
// string. Accepts inputs with or without a leading "$" and treats values
// starting with "." as missing the leading zero.
export function formatPrice(raw: string): string {
  const stripped = raw.replace(/^\$/, '')
  const normalized = stripped.startsWith('.') ? `0${stripped}` : stripped
  return `$${normalized}`
}
