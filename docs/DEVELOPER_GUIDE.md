# ACTRA Developer & Deployment Guide

This guide is intended for developers who wish to run, test, or contribute to ACTRA locally or deploy it to a self-hosted server environment.

---

## 1. Running with Docker Compose (Hosted Stack)

The most robust way to run the entire hosted web stack locally is using Docker Compose. This starts the Flask web app, a PostgreSQL database, an S3-compatible MinIO object store, and a local SMTP capture client (Mailpit).

### Step 1: Configure Environment Variables
Copy the template configuration file:
```bash
cp .env.hosted.example .env.hosted
```
Open `.env.hosted` and configure the following parameters:
- `ACTRA_SECRET_KEY` — A strong, random key used for encrypting user sessions.
- `ACTRA_AUTH_PUBLIC_BASE_URL` — The base URL of the service (e.g. `http://localhost:8000` or your public domain).
- `ACTRA_AUTH_SMTP_*` — SMTP server credentials (e.g. Brevo) for registration and recovery emails.
- `POSTGRES_PASSWORD` — Database root credentials.
- `ACTRA_S3_*` — Settings for connection to S3-compatible cloud storage for media attachments.

### Step 2: Spin Up the Stack
Run the build and start the containers in detached mode:
```bash
docker compose --env-file .env.hosted -f docker-compose.hosted.yml up -d --build
```

### Step 3: Access Interfaces
- **Web Application**: `http://localhost:8000`
- **Mailpit (Local SMTP Catch-all)**: `http://localhost:8025`

### Step 4: Tear Down
```bash
docker compose --env-file .env.hosted -f docker-compose.hosted.yml down
```

---

## 2. Local Development Setup (Without Docker)

If you are editing client code or debugging Flask backend services without spinning up containerized databases:

### Step 1: Python Virtual Environment
Create and activate a virtual environment:
```bash
python -m venv .venv

# Windows:
.venv\Scripts\activate

# macOS/Linux:
source .venv/bin/activate
```

### Step 2: Install Dependencies
Install Python libraries in editable mode and pull node modules for the client:
```bash
pip install -e ".[dev]"
npm ci
```

### Step 3: Compile Client Assets
Compile the Tailwind CSS styles:
```bash
npm run build:css
```

---

## 3. Automated Testing Suite

Ensure quality, contrast standards, and schema reliability across all system layers.

### Basic Test Suite Execution
```bash
# Run backend Python unit and integration tests
pytest

# Run frontend Vanilla JS/Tailwind tests (Vitest)
npm test

# Audit Tailwind theme custom CSS variable definitions
npm run validate:themes

# Run static analysis and secret detectors
python -m pre_commit run --all-files
```

### Hosted Smoke & Acceptance Tests
ACTRA includes automated end-to-end (smoke) checks using Playwright to ensure the hosted API, auth cycles, S3 imports, and database connections work flawlessly together:

```bash
# Verify component contracts and launch readiness
npm run smoke:launch-contract:hosted

# Run the complete user registration & practice loop acceptance test
npm run smoke:launch-acceptance:hosted

# Test specific modules individually
npm run smoke:main-quick-access:hosted
npm run smoke:statistics:hosted
npm run smoke:calendar:hosted
npm run smoke:complex-passage:hosted
npm run smoke:task-editor:hosted
npm run smoke:complex-editor:hosted
npm run smoke:theory-editor:hosted
npm run smoke:catalog-library:hosted
npm run smoke:linked-theory-open:hosted
npm run smoke:assets-media:hosted
npm run smoke:microcards:hosted
npm run smoke:ai-placeholder:hosted
npm run smoke:import-export:hosted
npm run smoke:readiness:hosted
```
