# Astraea OpenClaw: Phase 1 Substrate

## Overview
This repository contains the **System 2 Substrate Architecture** for the OpenClaw framework. It introduces deep computational orchestration, memory persistence, and modular routing to maximize context efficiency and pipeline performance. 

This deployment is engineered for maximum efficiency and continuous Telegram pairing using Google's Gemini models.

## Core Features

### 1. Astraea Stateful MLFQ (Multi-Level Feedback Queue)
A custom scheduling middleware that dynamically routes and organizes LLM generation requests:
- **Token-Based Queuing**: Automatically classifies incoming jobs into a 6-tier priority matrix (Q0 to Q5) based on predicted token complexity.
- **HRRN Scoring (Highest Response Ratio Next)**: Prevents queue starvation for large prompt evaluations by gracefully aging them against lightweight tasks.
- **Idempotency Shunting**: Safely identifies read-only parallelizable tasks (like time/weather checks) and shunts them past serial session locks to maximize asynchronous I/O void-filling.

### 2. Persistent Contextual Supermemory
Natively wires the `openclaw-supermemory` plugin into the substrate:
- Autonomously captures zero-state profile hooks and continuous message exchanges.
- Dynamically retrieves global semantic memory fragments to enrich context windows without manual human intervention.

### 3. Modular System 2 Injection
Astraea exists inside the `system2-core` tracking directory, completely decoupled from the OpenClaw native codebase.
- A dynamic routing patch is injected at runtime, preserving the `openclaw-main` folder so it can be updated safely via upstream `git pull` without merge collisions.
- The queue is 100% loss-less. You can toggle the experimental MLFQ on and off between reboots without deleting active execution tasks.

---

## Environment Configuration
Before deploying, you must satisfy the environment configurations. Create a new file named `deploy_secrets.bat` in the root directory (this is automatically ignored by git to prevent leaks).

**`deploy_secrets.bat` format:**
```bat
set TELEGRAM_TOKEN=your_telegram_bot_token_here
set SM_TOKEN=sm_your_supermemory_key_here
set GEMINI_TOKEN=your_gemini_api_key_here
```

**Remote Validation**: If you are using `master_deploy.bat`, the script will automatically translate these variables into a secure `.env` file on your target server.

### Toggle System 2
You can cleanly toggle the Astraea middleware via the `.env` file:
`SYSTEM2_ENABLED=true` (Routes through Astraea MLFQ)
`SYSTEM2_ENABLED=false` (Bypasses Astraea; falls back to native OpenClaw chronological queues)

---

## Deployment Instructions

### Method 1: Master Deployment (Remote VM)
If you have a remote VM configured as your OpenClaw gateway, `master_deploy.bat` completely automates the pipeline:
1. Ensure your `deploy_secrets.bat` is configured locally.
2. Run `master_deploy.bat`.
3. The script will securely transfer your `.env` keys via SSH.
4. It will copy `openclaw.json`, transfer the `system2-core` module, and push updates to Git.
5. It invokes `node system2-core/installer.js --install` natively on the VM daemon to safely proxy the hooks, then executes `pnpm build`.

### Method 2: Manual Local Execution
If you wish to spin up the substrate locally on your own machine:
1. Ensure you have the `openclaw-main` directory installed via `pnpm i`.
2. Run `node system2-core/installer.js --install` from the root directory to inject the routing hooks into OpenClaw.
3. Copy `openclaw.json` into `~/.openclaw/openclaw.json` (or `%USERPROFILE%\.openclaw\openclaw.json` on Windows).
4. Establish your `.env` file containing: `TELEGRAM_BOT_TOKEN`, `SUPERMEMORY_OPENCLAW_API_KEY`, `GOOGLE_API_KEY`, and `SYSTEM2_ENABLED=true`.
5. Run the build and boot sequence:
```bash
cd openclaw-main
pnpm build
pnpm openclaw gateway start
```

## Initialization (Telegram)
To establish bidirectional interaction and finalize the boot sequence, open your provided Telegram bot chat and explicitly send `/start` once the gateway is completely online.
