import { useLayoutEffect, useState } from "react";
import "./IdentityCard.css";

// 身份卡(入店凭证)· 横版暖米白纸质 · 点一下翻面。onboarding 收尾:糖沐递给新客,印上称呼 + 口味 + 一句寄语。
// 翻转沿用统一 Card 的「两面各自 perspective()+rotateY」技术(不用父级 preserve-3d):
//   活动面落在 0°/360° 平面 → Chromium 命中测试正常(preserve-3d + 背面 rotateY(180) 会让背面点不动,YOR-47 教训)。
// props:
//   name     称呼(必)。正面主角。
//   taste    最近在看(口味);办好态在背面小字,登记态临时上正面(报口味时正面可见成形)
//   message  糖沐给这位客人写的一句寄语(onboarding 时 AI 按感觉生成;空则用默认暖句)。长句前端会截断,生成侧另限字数。
//   avatar   头像图 URL;无则用称呼首字(印章式字头,只取一字当徽记,不与称呼复读)
//   issuedAt 发卡日期字符串;空则「今日」
//   shopName 发卡书坊名(默认 沐言书坊)
//   clerk    落款店员(默认 糖沐)
//   forming  登记态(边填边成形):不可翻面(还没办好)、正面临时显口味行、名字/口味用 key 触发浮现动画。
export function IdentityCard({ name, taste, message, avatar, issuedAt, shopName = "沐言书坊", clerk = "糖沐", forming = false }) {
  const [flipped, setFlipped] = useState(false);
  useLayoutEffect(() => {
    if (forming) setFlipped(false);
  }, [forming]);
  const nick = (name || "").trim();
  const hasName = !!nick;
  const shownNick = nick || "客人";
  // 字头只取首字当徽记(不复读称呼)。用 Array.from 按 Unicode code point 拆,避免 emoji/代理对被 slice 截半成乱码。
  const initial = Array.from(shownNick.replace(/\s+/g, ""))[0] || "客";
  const note = (message || "").trim() || "愿你在这儿,总能翻到想读的那一页。";
  const canFlip = !forming; // 登记态锁翻面:卡还没办好,别急着翻
  const toggle = () => canFlip && setFlipped((f) => !f);
  return (
    <div
      className={"idcard" + (flipped ? " is-flipped" : "") + (forming ? " is-forming" : "")}
      onClick={toggle}
      role={canFlip ? "button" : undefined}
      tabIndex={canFlip ? 0 : -1}
      aria-pressed={canFlip ? flipped : undefined}
      aria-label={forming ? `${shownNick} 的入店凭证(登记中)` : `${shownNick} 的入店凭证,点按翻面`}
      onKeyDown={
        canFlip
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle();
              }
            }
          : undefined
      }
    >
      <div className="idcard-inner">
        {/* 正面:眉标 / 头像+称呼(主角) / 底行。登记态底行=口味成形行;办好态底行=发卡日·翻面提示。 */}
        <div className="idcard-face idcard-front">
          <img className="idcard-seal-img" src="/home/seal-muyan.png" alt="" aria-hidden="true" draggable="false" />
          <span className="idcard-eyebrow">{shopName} · 入店凭证</span>
          <div className="idcard-front-main">
            <div className="idcard-avatar">
              {avatar ? (
                <img src={avatar} alt="" draggable="false" />
              ) : (
                <span className="idcard-avatar-mono t-kai">{hasName ? initial : ""}</span>
              )}
            </div>
            {/* key 绑值:报名/改名时重挂 → 触发浮现动画(CSS)。空态显占位。 */}
            <div key={nick} className={"idcard-name t-kai" + (hasName ? "" : " is-empty")}>
              {hasName ? nick : "待登记"}
            </div>
          </div>
          {forming ? (
            <div className="idcard-forming-line t-kai">
              最近在看 · <span key={taste || "_"} className={"idcard-forming-taste" + (taste ? "" : " is-empty")}>{taste || "…"}</span>
            </div>
          ) : (
            <div className="idcard-front-foot">
              <span className="idcard-issued">发卡 {issuedAt || "今日"}</span>
              <span className="idcard-hint">点一下翻面 ↻</span>
            </div>
          )}
        </div>
        {/* 背面:糖沐寄语(主角)+ 落款 + 口味 + 归还语 */}
        <div className="idcard-face idcard-back">
          <span className="idcard-eyebrow">凭卡出入</span>
          <p className="idcard-message t-kai">{note}</p>
          <div className="idcard-sign t-kai">—— {clerk}</div>
          <div className="idcard-back-foot">
            {taste ? (
              <div className="idcard-taste">最近在看 · {taste}</div>
            ) : (
              <div className="idcard-taste">来日方长 · 总有一本等着你</div>
            )}
            <span className="idcard-lost">如果捡到此卡,请归还至{shopName}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default IdentityCard;
