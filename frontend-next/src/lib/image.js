// 图片文件 → 缩放压缩 → base64 data URL(webp,回退 jpeg)。
// 用途:角色卡 头像/立绘、发布封面 直接把图存进卡/preset 字段(后端已支持 data-URI,见 /api/my/avatar、PresetReq.cover)。
// 压缩是为了别让 base64 撑爆 localStorage 草稿 / preset payload。
export function fileToCompressedDataURL(
  file,
  { maxW = 768, maxH = 1152, quality = 0.82, type = "image/webp" } = {}
) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("没有文件"));
    if (!/^image\//.test(file.type || "")) return reject(new Error("请选图片文件"));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxW / img.width, maxH / img.height);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas 不可用"));
      ctx.drawImage(img, 0, 0, w, h);
      let out = canvas.toDataURL(type, quality);
      // 部分环境不出 webp(toDataURL 回退成 png)→ 退 jpeg 以保证压缩。
      if (type === "image/webp" && !out.startsWith("data:image/webp")) {
        out = canvas.toDataURL("image/jpeg", quality);
      }
      resolve(out);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败"));
    };
    img.src = url;
  });
}

// 文件 → data URL(喂给 react-easy-crop 的 image 源,也给下面裁剪用)。
export function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("没有文件"));
    if (!/^image\//.test(file.type || "")) return reject(new Error("请选图片文件"));
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

// 按裁剪区域(react-easy-crop 给的 croppedAreaPixels:源图像素坐标 {x,y,width,height})
// 裁出该区域 → 缩到 maxW/maxH 内 → 压成 webp(回退 jpeg)data URL。
// 用途:头像/立绘 在固定框里拖动缩放定好取景后,输出裁剪图存进卡字段(沿用 base64 存法)。
export function getCroppedDataURL(
  imageSrc,
  cropPx,
  { maxW = 768, maxH = 1152, quality = 0.85, type = "image/webp" } = {}
) {
  return new Promise((resolve, reject) => {
    if (!imageSrc || !cropPx) return reject(new Error("缺少图片或裁剪区域"));
    const img = new Image();
    img.onload = () => {
      const { x, y, width, height } = cropPx;
      if (!width || !height) return reject(new Error("裁剪区域为空"));
      const scale = Math.min(1, maxW / width, maxH / height);
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas 不可用"));
      ctx.drawImage(img, x, y, width, height, 0, 0, w, h);
      let out = canvas.toDataURL(type, quality);
      if (type === "image/webp" && !out.startsWith("data:image/webp")) {
        out = canvas.toDataURL("image/jpeg", quality);
      }
      resolve(out);
    };
    img.onerror = () => reject(new Error("图片读取失败"));
    img.src = imageSrc;
  });
}
