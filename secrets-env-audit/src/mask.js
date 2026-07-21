// Masking — findings never contain the full secret value.

export function mask(secret) {
  const v = String(secret);
  if (v.length <= 8) return '****';
  if (v.length <= 14) return v.slice(0, 2) + '****' + v.slice(-2);
  return v.slice(0, 3) + '****' + v.slice(-4);
}

// Build a masked one-line preview of a rule match: the full matched text
// with the secret portion replaced by its mask.
export function maskedPreview(matchText, secret) {
  if (!secret || !matchText.includes(secret)) return mask(matchText);
  const preview = matchText.split(secret).join(mask(secret));
  return preview.length > 120 ? preview.slice(0, 117) + '...' : preview;
}
