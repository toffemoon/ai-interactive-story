-- 用户头像:客户端裁切压缩后的 data URI(256×256 JPEG,~20KB),存列不存盘
-- (Render 磁盘易失,DB 持久)。附加列,幂等。
alter table users add column if not exists avatar text;
