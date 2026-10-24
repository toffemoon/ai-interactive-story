import { useEffect } from "react";
import { L, isZh } from "../lib/i18n";
import "./OnboardingPaper.css";

// 新手登记的「纸」(画布「C 幕间 · 起名」):A = 入店证(默认),B = 访客登记簿(对比用,/test/onboarding 右上角切换)。
//   name / taste  已登记的称呼 / 最近在读;live = 正在输入的那一栏(field)和输入框里的字,边打边写上纸。
//   avatar        头像 dataURL(入店证照片位;没有就用称呼字头)
//   done          卡办好(落章 + 糖沐留言 message;message 为空用默认暖句)
// 手写字(日期 / 名字 / 留言)用 Long Cang,只在用到时加载;英文站用系统手写体回退。
const HAND_FONT_ID = "ais-hand-font";
function useHandFont() {
  useEffect(() => {
    if (!isZh || document.getElementById(HAND_FONT_ID)) return;
    const css = document.createElement("link");
    css.id = HAND_FONT_ID;
    css.rel = "stylesheet";
    css.href = "https://fonts.googleapis.com/css2?family=Long+Cang&display=swap";
    document.head.append(css);
  }, []);
}

function dateParts(d) {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return {
    long: isZh ? `${m} 月 ${day} 日` : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    short: `${m}/${day}`,
  };
}

const DEFAULT_NOTE = () => L("May you always find the page you want to read here.", "愿你在这儿,总能翻到想读的那一页。");

// 一栏:有值写值;正在填这一栏就写输入框里的字 + 闪烁光标;都没有留白(读屏念「还没填」)。
function Cell({ value, live, liveText }) {
  const text = live ? liveText : value;
  return (
    <>
      {text ? <span className="obp-hand">{text}</span> : null}
      {live ? <span className="obp-caret" aria-hidden="true" /> : null}
      {!text ? <span className="sr-only">{L("Not filled in yet", "还没填")}</span> : null}
    </>
  );
}

export function EntryPass({ name, taste, avatar, live, liveText, done, message, issuedAt = new Date() }) {
  useHandFont();
  const initial = Array.from((name || "").replace(/\s+/g, ""))[0] || "";
  const date = dateParts(issuedAt);
  return (
    <figure className={"obp obp-pass" + (done ? " is-done" : "")} aria-label={L("Muyan Bookshop entry pass", "沐言书坊入店证")}>
      <div className="obp-pass-head">
        <span className="obp-title">{L("Muyan Bookshop", "沐言书坊")}</span>
        <span className="obp-sub">{L("Entry pass", "入店证")}</span>
      </div>
      <div className="obp-pass-body">
        <div className="obp-photo" aria-hidden="true">
          {avatar ? <img src={avatar} alt="" /> : initial ? <span className="obp-photo-initial">{initial}</span> : <span>{L("Photo", "照片")}</span>}
        </div>
        <dl className="obp-fields">
          <div className="obp-field">
            <dt>{L("Name", "姓名")}</dt>
            <dd>
              <Cell value={name} live={live === "name"} liveText={liveText} />
            </dd>
          </div>
          <div className="obp-field">
            <dt>{L("Since", "入店")}</dt>
            <dd>
              <span className="obp-hand">{date.long}</span>
            </dd>
          </div>
          <div className="obp-field">
            <dt>{L("Reading", "最近在读")}</dt>
            <dd>
              <Cell value={taste} live={live === "taste"} liveText={liveText} />
            </dd>
          </div>
        </dl>
      </div>
      {done && (
        <p className="obp-note">
          <span className="obp-hand">{message || DEFAULT_NOTE()}</span>
          <span className="obp-sign">{L("— Tangmu", "—— 糖沐")}</span>
        </p>
      )}
      <img className="obp-seal" src="/brand/seal-192.png" alt="" />
    </figure>
  );
}

export function RegisterBook({ name, taste, live, liveText, done, message, issuedAt = new Date() }) {
  useHandFont();
  const date = dateParts(issuedAt);
  return (
    <figure className={"obp obp-book" + (done ? " is-done" : "")} aria-label={L("Muyan Bookshop guest register", "沐言书坊访客登记簿")}>
      <div className="obp-book-head">
        <span className="obp-title">{L("Guest register", "访客登记")}</span>
        <span className="obp-sub">{L("Muyan Bookshop", "沐言书坊")}</span>
      </div>
      <img className="obp-seal obp-seal--book" src="/brand/seal-192.png" alt="" />
      <table className="obp-table">
        <thead>
          <tr>
            <th scope="col">{L("Date", "日期")}</th>
            <th scope="col">{L("Name", "名字")}</th>
            <th scope="col">{L("Reading lately", "最近在读")}</th>
          </tr>
        </thead>
        <tbody>
          <tr className="obp-row-mine">
            <td>
              <span className="obp-hand">{date.short}</span>
            </td>
            <td>
              <Cell value={name} live={live === "name"} liveText={liveText} />
            </td>
            <td>
              <Cell value={taste} live={live === "taste"} liveText={liveText} />
            </td>
          </tr>
          {[1, 2, 3, 4].map((n) => (
            <tr key={n} aria-hidden="true">
              <td />
              <td />
              <td />
            </tr>
          ))}
        </tbody>
      </table>
      {done && (
        <p className="obp-note">
          <span className="obp-hand">{message || DEFAULT_NOTE()}</span>
          <span className="obp-sign">{L("— Tangmu", "—— 糖沐")}</span>
        </p>
      )}
    </figure>
  );
}
