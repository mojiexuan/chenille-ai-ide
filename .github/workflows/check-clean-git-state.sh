R=`git status --porcelain | wc -l`
if [ "$R" -ne "0" ]; then
  echo "构建完成后 Git 仓库不是干净状态。是否忘记提交由 .ts 编译生成的 .js 文件，或 /build 目录中的产物？";
  git status --porcelain
  exit 1;
fi
