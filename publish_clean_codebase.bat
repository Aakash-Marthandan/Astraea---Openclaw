@echo off
echo [1/3] Destroying localized Git repository to reset history...
if exist .git rmdir /s /q .git

echo [2/3] Bootstrapping a fresh Git index...
git init
git config --local user.email "aakashemailbox@gmail.com"
git config --local user.name "Aakash"

echo [3/3] Staging fully sanitized codebase...
git add .
git commit -m "feat: cleanly initialized Phase 1 Substrate with Astraea and Supermemory"
git remote add origin https://github.com/Aakash-Marthandan/Astraea---Openclaw.git

echo Overwriting the remote main branch with the sanitized history...
git branch -M main
git push origin --delete release 2>nul
git push -u origin main --force

echo Remote GitHub repository has been securely purged of API leaks on the main branch!
pause
