#!/bin/sh
# 画面のファイルを直したあと、コミットの前に実行する。
# index.html の読み込みに版の印（?v=…）を付け直し、ブラウザに古いファイルを使わせないようにする
cd "$(dirname "$0")/.." || exit 1
V=$(date +%Y%m%d%H%M)
sed -i -E "s#(src|href)=\"(style\.css|config\.js|templates\.js|app\.js|studio\.js|publish\.js|strategy\.js|records.js|guide.js)(\?v=[a-z0-9]+)?\"#\1=\"\2?v=$V\"#g" docs/index.html
echo "版の印を $V にしました"
