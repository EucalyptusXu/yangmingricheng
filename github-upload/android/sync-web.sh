#!/usr/bin/env bash
# 把 yangming-schedule/ 下的网页资源同步进 Android 工程的 assets。
# 每次改完网页，跑一次这个脚本再打包即可。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../yangming-schedule"
DST="$HERE/app/src/main/assets/www"

if [ ! -d "$SRC" ]; then
  echo "找不到网页源码目录: $SRC" >&2
  exit 1
fi

rm -rf "$DST"
mkdir -p "$DST"
cp -R "$SRC"/. "$DST"/

# 打包进 APK 的副本不需要这些开发期文件
# tools/ 和 tests/ 只在电脑上跑，塞进安装包纯属浪费体积
rm -f "$DST/README.md" "$DST/.DS_Store"
rm -rf "$DST/tools" "$DST/tests"

echo "已同步 -> $DST"
find "$DST" -type f | sed "s|$DST/||" | sort
