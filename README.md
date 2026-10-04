# SmartSize — Intelligent AWS Cloud Cost Optimization

SmartSize demonstrates a cloud-cost optimization workflow: utilization context, transparent prioritization, illustrative savings estimates, human review, scheduling, and an audit trail. New accounts choose a workspace environment before entering the product.

> **Environment boundary:** Demo uses illustrative fixtures; AWS workspaces use backend-only read access through the AWS SDK credential chain. AWS sync reads EC2/EBS inventory, CloudWatch metrics, Compute Optimizer recommendations, and Cost Explorer totals when the identity has those permissions. Missing fields remain unavailable, and SmartSize never modifies AWS resources.

## Current architecture

- **Frontend:** React 19, Vite, TypeScript, Tailwind CSS, Recharts, Lucide
- **Backend:** Express 4, TypeScript, `tsx`
- **Persistence:** MySQL stores accounts, workspace memberships, workspace-scoped Demo and Manual Analysis workflows, AWS inventory/metrics/recommendations, costs, and audit events when `DATABASE_URL` is configured; local development can fall back to JSON
- **Recommendation analysis:** deterministic TypeScript service in `server/services/rightsizingEngine.ts`
- **Workspace setup:** new accounts choose a workspace name and select Demo, Manual Analysis, or verified AWS; the environment is stored with the workspace

The project already used a React/Express architecture. This implementation extends it instead of introducing a separate FastAPI/MySQL deployment that would require additional services and setup. The JSON store is suitable for a single-user local demo only; it is not a production database.

## Features implemented

- Synthetic inventory of 24 resources and 10 recommendation fixtures, clearly shown as demo data.
- API-backed resource inventory/detail, recommendation list/detail, simulator, utilization summary, and cost analysis screens.
- Recommendation detail with current/recommended configuration, utilization facts, cost estimate, risk, confidence, score reasons, and source disclaimer.
- Explainable 0–100 opportunity score using estimated savings, confidence, supplied risk, and observed peak CPU/memory.
- Demo-session entry from the landing page; no account registration is needed for the walkthrough.
- First-login onboarding for registered accounts. Demo mode is an explicit choice and is not silently selected for new accounts.
- Workspace rename and environment preference persistence in MySQL when configured (or the development JSON account store).
- Complete Manual Analysis workflow that accepts user-supplied resource, utilization, storage, cost, workload, and availability details without AWS credentials.
- Transparent heuristic estimates with recorded assumptions, missing-data handling, peak-load safeguards, simulations, review decisions, savings summaries, reports, and audit events. Manual approval records an action only; it never changes infrastructure.
- AWS connection verifies the backend credential chain with STS; the UI shows account identity and individual service permissions.
- AWS synchronization persists only read results and is unavailable without MySQL, so tenant data is not silently discarded.
- Persistent approve/reject decisions, optional rejection note, simulation records, scheduled actions, and audit events.
- Simulation-only completion flow; never invokes an AWS write API.
- Policy settings and a test-policy preview.
- Savings page distinguishing projected opportunity, demo-simulated savings, and verified savings (currently zero).
- Saved report snapshots generated from current backend data and CSV export for recommendation data; PDF export is clearly unavailable.
- AWS status/sync panel with STS identity verification and per-service health, plus a live overview of the last persisted AWS snapshot.
- Password-reset and email-verification token hashes, single-use tokens, development-only reset tokens, SendGrid delivery, and session invalidation on logout/password reset.

## Requirements

- Node.js 22 or later
- npm

## Install and run

The current dependency tree has an upstream peer-dependency mismatch: `@builder.io/vite-plugin-jsx-loc` declares Vite 4/5 support while the project uses Vite 7. Install the committed lockfile with:

```powershell
npm ci --legacy-peer-deps
```

Configure the local environment by copying `.env.example` to `.env`. To persist registered accounts in MySQL, set `DATABASE_URL` to a URL such as `mysql://user:password@localhost:3306/smartsize`; the API checks the connection and creates the account table at startup. Existing local JSON account records are copied into MySQL at startup without overwriting any accounts already there. Keep the real connection string in `.env` and never commit it. When `DATABASE_URL` is absent in development, accounts use the local JSON fallback. Production startup requires a configured MySQL database.

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
2. Choose **Explore the demo** for a local demo session, or register/sign in to use an account.
3. For a new account, name the workspace and explicitly choose **Explore Demo Environment**, **Manual Analysis**, or verified AWS.
4. Open **Recommendations**, then inspect a resource.
5. Run **Simulate** to review a no-write savings and risk estimate.
6. Choose **Approve** and confirm. The API records the approval and creates an action.
7. Open **Action Center**, choose a future date/time, and schedule the action.
8. Choose **Simulate completion**. This marks the local demo action simulated; it does not touch AWS.
9. Review **Savings** and **Audit Trail**. Simulated savings are not reported as verified savings.

For Manual Analysis, choose **Manual Analysis** during workspace setup (or change the workspace environment in settings). Open **Infrastructure analysis**, create a resource analysis, and enter only the utilization, storage, cost, workload, and availability facts you know. Unknown measurements remain unavailable; where storage size is known but utilization is not, the estimate records its explicit conservative assumption. Run the simulation before approving or rejecting a recommendation. Cost and savings are estimates derived from the supplied cost and SmartSize's heuristic model, not provider quotes or verified savings.

## Environment variables

See `.env.example`. AWS SDK v3 uses the standard credential provider chain on the backend (environment credentials, shared profile, container credentials, or an instance/workload role). Set `AWS_REGION`; Cost Explorer defaults to its `us-east-1` endpoint unless `AWS_COST_EXPLORER_REGION` is set. CloudWatch period/lookback and Cost Explorer lookback can also be configured. Do not put AWS credentials in frontend code or commit them.

Google OAuth is disabled in the sign-in UI unless both OAuth credentials are configured. Production email verification and password-reset delivery require `EMAIL_PROVIDER=sendgrid`, `EMAIL_FROM`, and `SENDGRID_API_KEY`. In development without email delivery, password reset returns a clearly marked development-only token; production never returns reset or verification tokens.

Production startup requires a unique `SESSION_SECRET` (at least 32 characters), an `APP_ORIGIN`, and `DATABASE_URL`. The MySQL account table is created if missing. Registered users, password hashes, verification/reset token hashes, and session versions are stored in MySQL when configured; password reset and logout invalidate prior sessions. Authentication endpoints are rate-limited, cookies are HTTP-only and secure in production, and the API applies security headers and an explicit credentialed CORS allowlist. Keep real secrets in `.env`, never in frontend source or committed files.

## AWS and IAM

AWS access is optional for Demo. Live connection verifies identity with `sts:GetCallerIdentity`. Read-only sync requires EC2 describe permissions (`ec2:DescribeInstances`, `ec2:DescribeVolumes`), CloudWatch metric access (`cloudwatch:GetMetricData`), Compute Optimizer enrollment/recommendation access, and Cost Explorer `ce:GetCostAndUsage`. Service-level permission or enrollment failures are shown independently; no AWS write permissions are used. Live sync requires MySQL so all data remains workspace-scoped.

## Persistence and data reset

With MySQL configured, workspace-scoped accounts, memberships, Demo and Manual Analysis workflows, AWS account metadata, inventory, metrics, recommendations, cost snapshots, and audit data are stored in MySQL. In local development without MySQL, accounts and Demo and Manual Analysis workflows fall back to `data/smartsize.json`; AWS sync explicitly requires MySQL. Demo fixtures are synthetic and seeded independently per workspace. Stop the API before manually backing up or removing the development JSON state file.

## Validation

```powershell
npm run check
npx vitest run server/services/rightsizingEngine.test.ts
npm run build
```

`npm audit` currently reports vulnerabilities in development dependencies; `npm audit --omit=dev` reported none in the production dependency set at the time this prototype was checked.

## Limitations and next steps

- The current workspace selector uses each user's default membership; switching between multiple memberships is not yet exposed.
- AWS live sync is read-only and limited to EC2/EBS, CloudWatch, Compute Optimizer, and Cost Explorer data; it does not discover other AWS services or execute optimizations.
- No live savings can be claimed; the demo fixtures and their estimates are synthetic.
- Manual Analysis is a heuristic planning aid. It is not a cloud-pricing API, capacity guarantee, or substitute for validating production telemetry and provider constraints.
- Password authentication exists for registered users, while the one-click demo session is intended for local demonstration.
- The live overview presents the saved AWS snapshot; detailed live rightsizing workflow actions and execution are intentionally unavailable.
- JSON persistence is a local-development fallback, not safe for concurrent production use; production requires MySQL.
- No AWS write permissions are implemented or required. Any future execution should be separately permissioned and designed around explicit human approval.
