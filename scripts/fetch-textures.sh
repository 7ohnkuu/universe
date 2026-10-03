#!/usr/bin/env bash
# =============================================================================
#  fetch-textures.sh — 下載本倉庫未隨附的 8k 貼圖
#
#  為什麼需要這個腳本:
#    8k 貼圖共 7 檔、約 68 MB, 超過 GitHub 的建議上限, 所以沒有提交進倉庫。
#    倉庫已附 2k 與 4k 兩組解析度, 預設 4k 可直接執行, 不跑這個腳本也跑得起來;
#    只有在畫質下拉選單選到「8k」時才會需要這些檔案;
#    缺檔不會讓頁面掛掉 —— loadTex() 逐檔失敗會降級為程序化貼圖並印 console.warn,
#    但畫質會明顯變差, 所以要用 8k 就先把檔抓齊。
#
#  來源: Solar System Scope Texture Pack, CC BY 4.0 (見 LICENSE)
#  用法: ./scripts/fetch-textures.sh          # 只下載缺的
#        ./scripts/fetch-textures.sh -f       # 全部重下載
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="textures"
BASE="https://www.solarsystemscope.com/textures/download"
FORCE=0
[ "${1:-}" = "-f" ] && FORCE=1

# 檔名 <空白> SHA-256 <空白> 位元組數  (校驗值取自上游, 防止拿到損壞或被替換的檔案)
FILES=$(cat <<'MANIFEST'
8k_mercury.jpg 5c8bd885ae3571c6ba2cd34b3446b9c6d767e314bf0ee8c1d5c147cadd388fc3 15035740
8k_venus_surface.jpg 9bc21a50577ed8ac734cda91058724c7a741c19427aa276224ce349351432c5b 12523129
8k_mars.jpg 4cc52149924abc6ae507d63032f994e1d42a55cb82c09e002d1a567ff66c23ee 8396951
8k_moon.jpg d1875bcec83588ca25e4802e576f6bb9f88b39e1e403cb41ff55867419c54796 15030356
8k_earth_daymap.jpg 88ab060b6e7d241cfc590c69f528fab2b3247b738d40124cb590999a6fe44abc 4565076
8k_earth_clouds.jpg c792eca228989d36ebb45d3ea6ff1198be5e21a25d70d2fbcb2124ffd14ba7f5 11619184
8k_saturn_ring_alpha.png f1f826933c9ff87d64ecf0518d6256b8ed990b003722794f67e96e3d2b876ae4 64790
MANIFEST
)

mkdir -p "$DEST"
# sha256sum (GNU) 或 shasum -a 256 (macOS 內建)
if command -v sha256sum >/dev/null 2>&1; then
  checksum() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  checksum() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  echo "找不到 sha256sum 或 shasum, 無法校驗檔案" >&2; exit 2
fi

got=0; skipped=0; failed=0
while IFS=$' \t' read -r name sum size _; do
  [ -z "${sum:-}" ] && continue
  out="$DEST/$name"
  if [ -f "$out" ] && [ "$FORCE" -eq 0 ]; then
    if [ "$(checksum "$out")" = "$sum" ]; then
      echo "  已存在, 跳過      $name"
      skipped=$((skipped+1)); continue
    fi
    echo "  校驗不符, 重新下載  $name"
  fi
  echo "  下載中 …            $name  ($(awk -v b="$size" 'BEGIN{printf "%.1f MB", b/1048576}'))"
  # -s: 不顯示 curl 進度表 (會把逐行輸出弄亂); -S: 但錯誤照樣報
  if ! curl -fsSL --retry 3 --connect-timeout 20 -o "$out.part" "$BASE/$name"; then
    echo "  !! 下載失敗: $name" >&2; rm -f "$out.part"; failed=$((failed+1)); continue
  fi
  actual=$(checksum "$out.part")
  if [ "$actual" != "$sum" ]; then
    echo "  !! SHA-256 不符: $name (期望 ${sum:0:12}…, 實際 ${actual:0:12}…)" >&2
    rm -f "$out.part"; failed=$((failed+1)); continue
  fi
  mv "$out.part" "$out"
  got=$((got+1))
done <<< "$FILES"

echo
echo "完成: 新下載 $got, 已存在 $skipped, 失敗 $failed"
if [ "$failed" -gt 0 ]; then
  echo "有檔案未取得。8k 為選用, 缺檔不影響執行; 但選 8k 時會降級成程序化貼圖。" >&2
  exit 1
fi
