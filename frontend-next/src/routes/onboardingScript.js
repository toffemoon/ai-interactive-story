// 新手引导的本机记录。引导本身(柜台两边:糖沐 + 3D 访客登记簿)在 components/onboarding。
// 2026-10-25 起旧的对话式引导(入场演出、称呼 / 头像 / 口味、入店证、五站导览)整套换掉,这里只留两把钥匙。

export const OB_KEY = "ais_onboarded_v1"; // 首访完成标记(有它 = 老用户,不再引导)
export const ECHO_KEY = "ais_ob_echo_v1"; // 回声:登记簿上写下的名字(name),后续对话可复用

// 读/写回声(容错)。
export function loadEcho() {
  try {
    return JSON.parse(localStorage.getItem(ECHO_KEY) || "null") || {};
  } catch (e) {
    return {};
  }
}
export function saveEcho(echo) {
  try {
    localStorage.setItem(ECHO_KEY, JSON.stringify(echo || {}));
  } catch (e) {}
}
export function isOnboarded() {
  try {
    return !!localStorage.getItem(OB_KEY);
  } catch (e) {
    return false;
  }
}
export function markOnboarded() {
  try {
    localStorage.setItem(OB_KEY, "1");
  } catch (e) {}
}
