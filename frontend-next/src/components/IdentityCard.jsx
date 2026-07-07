import { useState } from "react";
import "./IdentityCard.css";

// 身份卡(入店凭证)· 横版暖米白纸质 · 点一下翻面。onboarding 收尾:糖沐递给新客,印上称呼 + 口味 + 一句寄语。
// 翻转沿用统一 Card 的「两面各自 perspective()+rotateY」技术(不用父级 preserve-3d):
//   活动面落在 0°/360° 平面 → Chromium 命中测试正常(preserve-3d + 背面 rotateY(180) 会让背面点不动,YOR-47 教训)。
// props:
//   name     称呼(必)。正面主角。
//   taste    最近在看(口味);背面小字
//   message  糖沐给这位客人写的一句寄语(onboarding 时 AI 按感觉生成;空则用默认暖句)。长句前端会截断,生成侧另限字数。
//   avatar   头像图 URL;无则用称呼首字(印章式字头,只取一字当徽记,不与称呼复读)
//   issuedAt 发卡日期字符串;空则「今日」
//   shopName 发卡书坊名(默认 沐言书坊)
//   clerk    落款店员(默认 糖沐)
export function IdentityCard({ name, taste, message, avatar, issuedAt, shopName = "沐言书坊", clerk = "糖沐" }) {
  const [flipped, setFlipped] = useState(false);
  const nick = (name || "客人").trim();
  const initial = nick.replace(/\s+/g, "").slice(0, 1) || "客"; // 字头只取首字,当徽记不复读称呼
  const note = (message || "").trim() || "愿你在这儿,总能翻到想读的那一页。";
  const toggle = () => setFlipped((f) => !f);
  return (
    <div
      className={"idcard" + (flipped ? " is-flipped" : "")}
      onClick={toggle}
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      aria-label={`${nick} 的入店凭证,点按翻面`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      }}
    >
      <div className="idcard-inner">
        {/* 正面:三区 —— 眉标 / 头像+称呼(主角) / 底行(发卡日 · 翻面提示) */}
        <div className="idcard-face idcard-front">
          <img className="idcard-seal-img" src="/home/seal-muyan.png" alt="" aria-hidden="true" draggable="false" />
          <span className="idcard-eyebrow">{shopName} · 入店凭证</span>
          <div className="idcard-front-main">
            <div className="idcard-avatar">
              {avatar ? (
                <img src={avatar} alt="" draggable="false" />
              ) : (
                <span className="idcard-avatar-mono t-kai">{initial}</span>
              )}
            </div>
            <div className="idcard-name t-kai">{nick}</div>
          </div>
          <div className="idcard-front-foot">
            <span className="idcard-issued">发卡 {issuedAt || "今日"}</span>
            <span className="idcard-hint">点一下翻面 ↻</span>
          </div>
        </div>
        {/* 背面:糖沐寄语(主角)+ 落款 + 口味 + 归还语 */}
        <div className="idcard-face idcard-back">
          <span className="idcard-eyebrow">凭卡出入</span>
          <p className="idcard-message t-kai">{note}</p>
          <div className="idcard-sign t-kai">—— {clerk}</div>
          <div className="idcard-back-foot">
            {taste ? <div className="idcard-taste">最近在看 · {taste}</div> : null}
            <span className="idcard-lost">如果捡到此卡,请归还至{shopName}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default IdentityCard;
