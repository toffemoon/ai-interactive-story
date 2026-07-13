const LEGACY_TANGMU_MAIN = /(?:^|\/)assets\/cards\/tangmu-main\.jpg(?:[?#].*)?$/i;
const LEGACY_TANGMU_AVATAR = /(?:^|\/)assets\/cards\/tangmu-avatar\.jpg(?:[?#].*)?$/i;

// The API can still return two pre-redesign Tangmu paths. Keep that compatibility
// at the display boundary so dev requests do not fall through Vite's /assets proxy.
export function resolveMediaUrl(value) {
  if (typeof value !== "string" || !value) return value;
  const normalized = value.replace(/\\/g, "/");
  if (LEGACY_TANGMU_MAIN.test(normalized)) return "/home/tangmu01.png";
  if (LEGACY_TANGMU_AVATAR.test(normalized)) return "";
  return value;
}
