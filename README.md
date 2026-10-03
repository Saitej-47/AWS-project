# SmartSize — Intelligent AWS Cloud Cost Optimization

SmartSize is a demo-first prototype for the workflow around AWS rightsizing recommendations: utilization context, transparent prioritization, savings estimates, human review, scheduling, and an audit trail.

> **Demo data only:** this repository currently uses synthetic fixtures. It does not connect to AWS Compute Optimizer, CloudWatch, Cost Explorer, EC2, or MySQL, and it does not change AWS resources. The UI and API identify this boundary explicitly.

## Current architecture

- **Frontend:** React 19, Vite, TypeScript, Tailwind CSS, Recharts, Lucide
- **Backend:** Express 4, TypeScript, `tsx`
- **Demo persistence:** local JSON file at `data/smartsize.json` (ignored by Git)
- **Recommendation analysis:** deterministic TypeScript service in `server/services/rightsizingEngine.ts`

The project already used a React/Express architecture. This implementation extends it instead of introducing a separate FastAPI/MySQL deployment that would require additional services and setup. The JSON store is suitable for a single-user local demo only; it is not a production database.

## Features implemented

- Synthetic inventory of 24 resources and 10 recommendation fixtures, clearly shown as demo data.
- API-backed resource inventory/detail, recommendation list/detail, simulator, utilization summary, and cost analysis screens.
- Recommendation detail with current/recommended configuration, utilization facts, cost estimate, risk, confidence, score reasons, and source disclaimer.
- Explainable 0–100 opportunity score using estimated savings, confidence, supplied risk, and observed peak CPU/memory.
- Demo-session entry from the landing page; no account registration is needed for the walkthrough.
- Persistent approve/reject decisions, optional rejection note, simulation records, scheduled actions, and audit events.
- Simulation-only completion flow; never invokes an AWS write API.
- Policy settings and a test-policy preview.
- Savings page distinguishing projected opportunity, demo-simulated savings, and verified savings (currently zero).
- Saved report snapshots generated from current backend data and CSV export for recommendation data; PDF export is clearly unavailable.
- AWS status/sync panel that reports live AWS as unconnected instead of claiming a successful AWS operation.
- Password-reset and email-verification token hashes, single-use tokens, development-only reset tokens, SendGrid delivery, and session invalidation on logout/password reset.

## Requirements

- Node.js 22 or later
- npm

## Install and run

The current dependency tree has an upstream peer-dependency mismatch: `@builder.io/vite-plugin-jsx-loc` declares Vite 4/5 support while the project uses Vite 7. Install the committed lockfile with:

```powershell
npm ci --legacy-peer-deps
```

Configure the local environment by copying `.env.example` to `.env` if you need to change defaults. No AWS credentials or database are needed for demo mode.

Start the frontend and API together:

```powershell
npm run dev:full
```

- Frontend: <http://localhost:3000>
- API: <http://localhost:3001>
- Health: <http://localhost:3001/api/health>

You can also start them separately with `npm run dev` and `npm run dev:server`.

Build for production with `npm run build`, then start with `npm start`. Production startup requires `SESSION_SECRET` and `APP_ORIGIN`.

## Demo walkthrough

1. Open <http://localhost:3000>.
2. Choose **Explore the demo**. SmartSize creates a local demo session and opens the workspace.
3. Open **Recommendations**, then inspect a resource.
4. Run **Simulate** to review a no-write savings and risk estimate.
5. Choose **Approve** and confirm. The API records the approval and creates an action.
6. Open **Action Center**, choose a future date/time, and schedule the action.
7. Choose **Simulate completion**. This marks the local demo action simulated; it does not touch AWS.
8. Review **Savings** and **Audit Trail**. Simulated savings are not reported as verified savings.

## Environment variables

See `.env.example`. `AWS_MODE=demo` is the supported demo configuration. `AWS_MODE=live` currently reports `not_connected`; setting it does not enable an AWS integration.

Google OAuth is disabled in the sign-in UI unless both OAuth credentials are configured. Production email verification and password-reset delivery require `EMAIL_PROVIDER=sendgrid`, `EMAIL_FROM`, and `SENDGRID_API_KEY`. In development without email delivery, password reset returns a clearly marked development-only token; production never returns reset or verification tokens.

Production startup requires a unique `SESSION_SECRET` (at least 32 characters) and an `APP_ORIGIN`. Authentication endpoints are rate-limited, cookies are HTTP-only and secure in production, logout/password reset invalidate prior sessions, and the API applies security headers and an explicit credentialed CORS allowlist. Keep real secrets in `.env`, never in frontend source or committed files.

## AWS and IAM

There is currently no AWS SDK integration, AWS account connection, or IAM role assumed by the application. Therefore no AWS permissions are required to run the demo. Live integration remains future work and should use backend-only credentials/roles with least-privilege read access for discovery, Compute Optimizer, CloudWatch, and Cost Explorer. Any future execution permissions must be separately configured and guarded by approval.

## Persistence and data reset

Workspace account/workflow state is written to `data/smartsize.json`; the directory is ignored by Git. Recommendation/resource fixtures are source-controlled synthetic data. Stop the API before manually removing or backing up the JSON file. If no state file exists, the API initializes demo defaults.

## Validation

```powershell
npm run check
npx vitest run server/services/rightsizingEngine.test.ts
npm run build
```

`npm audit` currently reports vulnerabilities in development dependencies; `npm audit --omit=dev` reported none in the production dependency set at the time this prototype was checked.

## Limitations and next steps

- No FastAPI/Python backend, MySQL schema/migrations, or multi-user persistence.
- No real AWS discovery, metrics, recommendation ingestion, pricing, sync, execution, or post-change verification.
- No live savings can be claimed; the demo fixtures and their estimates are synthetic.
- Password authentication exists for registered users, while the one-click demo session is intended for local demonstration.
- Authentication data and workspace actions still use the local JSON store. The production-ready MySQL repository, per-workspace data isolation, and MySQL-backed user/session storage are not implemented yet; do not deploy this JSON-backed store for multiple users.
- JSON persistence is not safe for concurrent production use and has no database backup/migration strategy.
- Add a real AWS read-only integration and MySQL persistence before any live account use. Add separately permissioned, explicitly approved execution only after a staged safety design.
