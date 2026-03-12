@echo off
call deploy_secrets.bat

echo [1/3] Securing remote environment variables...
ssh %SSH_USER%@%SSH_HOST% "mkdir -p ~/.openclaw && echo TELEGRAM_BOT_TOKEN=%TELEGRAM_TOKEN% > ~/.openclaw/.env && echo SUPERMEMORY_OPENCLAW_API_KEY=%SM_TOKEN% >> ~/.openclaw/.env && echo GOOGLE_API_KEY=%GEMINI_TOKEN% >> ~/.openclaw/.env"

echo [2/3] Deploying sanitized architecture...
scp openclaw.json %SSH_USER%@%SSH_HOST%:~/.openclaw/openclaw.json
scp -r system2-core %SSH_USER%@%SSH_HOST%:~/openclaw/
scp openclaw-main\src\process\command-queue.ts %SSH_USER%@%SSH_HOST%:~/openclaw/src/process/
ssh %SSH_USER%@%SSH_HOST% "cd ~/openclaw && node system2-core/installer.js --install && pnpm build"

echo [3/3] Configuring Git and Publishing...
git init
git config --local user.email "%GIT_EMAIL%"
git config --local user.name "%GIT_NAME%"
git add .
git commit -m "feat: finalized clean Phase 1 architecture"
git branch -M main
git remote remove origin 2>nul
git remote add origin %GIT_URL%
git push -u origin main --force
