import { useCallback, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import { fileToDataURL, getCroppedDataURL } from "../lib/image";
import "./ImageCropField.css";

// 头像 / 立绘上传 + 固定框裁剪(react-easy-crop)。
//   - 点缩略图 → 选图 → 全屏裁剪层(图在固定比例框里拖动 + 滚轮/滑杆缩放)→ 确定 → onChange(裁剪后 webp base64)。
//   - round=true 头像圆形 1:1;否则按 aspect 矩形(立绘 2:3)。
//   - 「自动生成」= 禁用占位(留位,后期接 AI 出图,现不接)。
//   - 不新增端点;裁剪图沿用 base64 data-URI 存进卡字段(前端压缩,见 lib/image.js)。
export default function ImageCropField({
  label,
  hint,
  value,
  aspect = 1,
  round = false,
  output = { maxW: 768, maxH: 1152, quality: 0.85 },
  onChange,
}) {
  const fileRef = useRef(null);
  const [src, setSrc] = useState(null); // 正在裁剪的源图 data-url(非空 = 裁剪层打开)
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPx, setAreaPx] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const onCropComplete = useCallback((_area, areaPixels) => setAreaPx(areaPixels), []);

  async function onPick(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    setErr("");
    try {
      const dataUrl = await fileToDataURL(file);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setAreaPx(null);
      setSrc(dataUrl);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function confirmCrop() {
    if (!src || !areaPx || busy) return;
    setBusy(true);
    try {
      const out = await getCroppedDataURL(src, areaPx, output);
      onChange && onChange(out);
      setSrc(null);
    } catch (e) {
      setErr("裁剪失败:" + e.message);
    } finally {
      setBusy(false);
    }
  }

  function cancelCrop() {
    setSrc(null);
    setErr("");
  }

  return (
    <div className="icf">
      <div className="icf-head">
        <span className="icf-label t-ui-sm">{label}</span>
        <button
          type="button"
          className="icf-gen t-meta"
          disabled
          title="自动生成图片(暂未开放,留位)"
        >
          自动生成
        </button>
      </div>
      <button
        type="button"
        className={"icf-thumb" + (round ? " icf-thumb--round" : "") + (value ? " has-img" : "")}
        style={{ aspectRatio: String(aspect), ...(value ? { backgroundImage: `url("${value}")` } : {}) }}
        onClick={() => fileRef.current && fileRef.current.click()}
        title={value ? "换图 / 重裁" : "上传"}
      >
        {!value && <span className="t-meta">+ 上传</span>}
      </button>
      <div className="icf-foot">
        {value && (
          <button type="button" className="icf-clear t-meta" onClick={() => onChange && onChange("")}>
            移除
          </button>
        )}
        {hint && <span className="icf-hint t-meta">{hint}</span>}
        {/* 选图失败(如非图片文件)时裁剪层不会打开,错误要在字段本体这里给人看见(YOR-156) */}
        {err && !src && <span className="icf-err t-meta">{err}</span>}
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} />

      {src && (
        <div className="icf-cropper" role="dialog" aria-modal="true" aria-label="裁剪图片">
          <div className="icf-cropper-stage">
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              minZoom={1}
              maxZoom={4}
              aspect={aspect}
              cropShape={round ? "round" : "rect"}
              showGrid={!round}
              restrictPosition
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          </div>
          <div className="icf-cropper-bar">
            <div className="icf-cropper-tip t-meta">拖动取景 · 滑杆或滚轮缩放</div>
            <input
              className="icf-zoom"
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label="缩放"
            />
            {err && <div className="icf-err t-meta">{err}</div>}
            <div className="icf-cropper-actions">
              <button type="button" className="btn btn--line btn--sm" onClick={cancelCrop} disabled={busy}>
                取消
              </button>
              <button type="button" className="btn btn--primary btn--sm" onClick={confirmCrop} disabled={busy || !areaPx}>
                {busy ? "处理中…" : "确定"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
