/**
 * characters.theme_color as a CSS background for the admin swatches. The value is a palette name
 * (pink, yg …, from the v1 import), the token the editor saves (var(--c-pink)) or a #rrggbb colour;
 * a bare name resolves through its --c-* token (yg, peach are not CSS colours), falling back to the
 * name itself.
 */
export function swatch(v: string): string {
  const t = v.trim()
  return /^[a-z]+$/i.test(t) ? `var(--c-${t.toLowerCase()}, ${t})` : t
}
