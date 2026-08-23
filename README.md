# 3d-infra

AWS CDK v2 infrastructure for the 3d-quality processing pipeline. This repository contains infrastructure only; application code remains in `3d-frontend`, `3d-api`, and `3d-processor`.

## Architecture

```text
Angular → Go API → presigned POST → S3 jobs/{jobId}/input.stl
                                                ↓ object-created event
                                               SQS → .NET 10 Lambda
                                                ↓             ↓
                                               DLQ   jobs/{jobId}/report.json
```

The private S3 bucket uses S3-managed encryption, blocks public access, and expires complete job subtrees after one day. The standard queue has a 720-second visibility timeout and a DLQ. The processor runs with 256 MB, a 120-second timeout, x86_64 architecture, batch size 1, and a fixed SQS event-source maximum concurrency of 2. Reserved concurrency is intentionally not configured because small account concurrency quotas may not leave AWS's required unreserved concurrency capacity.

No database or authentication is introduced. Job metadata, inputs, reports, and
terminal failure results live in S3. The Go API runs in Lambda behind a throttled
HTTP API. CloudFront serves the private frontend bucket and proxies `/api/*` to
API Gateway.

API Gateway allows 5 requests per second with a burst of 10; rejected requests
receive HTTP 429 before Lambda runs or an S3 upload form is issued. Reserved
concurrency is not configured for the API Lambda because accounts with small
concurrency quotas must retain AWS's minimum unreserved pool. These API Gateway
controls are stage-wide, not per-client quotas.
The browser uploads directly to S3, where the signed POST restricts the object key,
expiry, and declared size. For hostile public traffic, add authentication and an
edge WAF rule as well: throttling limits form issuance but is not a per-IP DDoS or
cost-abuse control, and a valid signed POST remains usable until it expires.

## Prerequisites and bootstrap

- Node.js and npm
- AWS CLI credentials for the target account
- AWS CDK v2 (provided as a local development dependency)
- Node.js 22 or newer for the built-in test runner
- Packaged processor and API Lambda artifacts plus the frontend browser build

The default region is `us-east-1`; account IDs are read from the active AWS credentials.

```bash
npm install
AWS_PROFILE=your-profile make bootstrap
```

Test placeholders are supplied because this repository validates application artifact
paths whenever CDK loads the app, including during `cdk bootstrap`. Bootstrap creates
only the regional CDK support stack; it does not deploy the placeholders. The
Make target obtains the account ID from the active AWS credentials and defaults to
`us-east-1`. Override the region with `AWS_REGION=...` if needed.

## Application artifact boundary

Each application repository owns its build artifact. `3d-processor` and `3d-api`
produce Lambda ZIP files; `3d-frontend` produces a static browser directory.
`3d-infra` receives and deploys those artifacts without compiling application code.

The frontend artifact uses Angular's optimized `deployment-development`
configuration for `STAGE=dev` and its `production` configuration for `STAGE=prod`.
The dev deployment configuration uses `environment.development.ts` without local
debug source maps, while `ng serve` continues to use the full `development`
configuration.

```bash
export PROCESSOR_ARTIFACT_PATH=/absolute/path/to/processor.zip
export API_ARTIFACT_PATH=/absolute/path/to/3d-api.zip
export FRONTEND_ARTIFACT_PATH=/absolute/path/to/frontend/browser
```

The configured handler is `Processor::Processor.Function::FunctionHandler`: the
`Processor` assembly, `Processor.Function` type, and `FunctionHandler` method. The
processor repository provides this SQS/S3 Lambda adapter alongside its CLI.

## Build, test, and deploy

Stage comes from `-c stage=...` or `STAGE` and defaults to `dev`.

```bash
npm run build
npm test
npm run format:check
npm run lint
export PROCESSOR_ARTIFACT_PATH=/absolute/path/to/processor.zip
export API_ARTIFACT_PATH=/absolute/path/to/3d-api.zip
export FRONTEND_ARTIFACT_PATH=/absolute/path/to/frontend/browser
npx cdk synth -c stage=dev
npx cdk diff -c stage=dev
npx cdk deploy -c stage=dev --parameters RateLimitSecret="$RATE_LIMIT_SECRET"
npx cdk destroy -c stage=dev
```

All three artifact paths are required by the CDK entry point for these direct commands.
Deployments also require a random `RATE_LIMIT_SECRET` of at least 32 characters. The npm wrappers
work as `npm run synth -- -c stage=dev`, `npm run diff -- -c stage=dev`, and
`npm run deploy -- -c stage=dev --parameters RateLimitSecret="$RATE_LIMIT_SECRET"`.

| Setting                | Context                 | Environment               | Default                               |
| ---------------------- | ----------------------- | ------------------------- | ------------------------------------- |
| Processor artifact     | `processorArtifactPath` | `PROCESSOR_ARTIFACT_PATH` | required                              |
| API artifact           | `apiArtifactPath`       | `API_ARTIFACT_PATH`       | required                              |
| Frontend artifact      | `frontendArtifactPath`  | `FRONTEND_ARTIFACT_PATH`  | required                              |
| Memory (MB)            | `processorMemory`       | `PROCESSOR_MEMORY_MB`     | `256`                                 |
| Browser upload origin  | `corsOrigin`            | `CORS_ORIGIN`             | localhost (dev), canonical URL (prod) |
| Monthly budget (USD)   | `monthlyBudgetUsd`      | `MONTHLY_BUDGET_USD`      | `10` when alerts are enabled          |
| Budget alert email     | `budgetAlertEmail`      | `BUDGET_ALERT_EMAIL`      | disabled when omitted                 |
| Operations alert email | `operationsAlertEmail`  | `OPERATIONS_ALERT_EMAIL`  | alarms have no email when omitted     |
| Create-job burst limit | `createJobBurstLimit`   | `CREATE_JOB_BURST_LIMIT`  | `2`                                   |
| Create-job rate/second | `createJobRateLimit`    | `CREATE_JOB_RATE_LIMIT`   | `1`                                   |

Development always permits uploads from `http://localhost:4200`, including when another
non-wildcard `CORS_ORIGIN` is configured. Production CORS is fixed to
`https://www.inspectmesh.com`; a different non-empty `CORS_ORIGIN` fails synthesis. This
does not make the bucket public or authorize unsigned requests. Production retains the bucket
and its contents when the stack is deleted; development enables bucket cleanup. Review the
CloudFormation diff before every production deployment.

Processor logs use the same lifecycle policy in every stage. A newly created log group is
deleted if its initial deployment rolls back, preventing an empty orphan from blocking a
retry. Once successfully deployed, the log group and its diagnostic history are retained
if the stack is deleted or the resource is replaced.

Set `BUDGET_ALERT_EMAIL` to create a project-tag-filtered monthly AWS Budget with
forecasted 50% and actual 80%/100% email notifications. AWS sends the notifications
to that address after deployment; budget alerts report spend but do not automatically
disable resources. The `Project` cost-allocation tag must be activated in the billing
account for tag-filtered costs to appear in the budget.

Seven standard-resolution CloudWatch alarms monitor processor errors, throttles,
near-timeout duration, queue age, DLQ messages, API errors, and API Gateway 5xx
responses. Set `OPERATIONS_ALERT_EMAIL`
to route them through an SNS email subscription. AWS sends a confirmation message;
the recipient must confirm the subscription before operational emails are delivered.

The stack outputs storage and queue identifiers, Lambda names, the API URL, and
the CloudFront frontend URL and distribution ID.

CloudFront serves Angular's prerendered HTML for clean routes such as
`/stl-quality-check` without caching HTML responses. Hashed JavaScript and CSS
assets use CloudFront's managed optimized cache policy (24-hour default TTL and
one-year maximum), while `/api/*` is forwarded to API Gateway with caching disabled.
No custom cache policy is created, keeping the distribution compatible with
CloudFront flat-rate tiers that do not include custom caching rules. Each frontend
deployment invalidates `/*` automatically. To clear the distribution manually, use
the `FrontendDistributionId` stack output:

```sh
aws cloudfront create-invalidation \
  --distribution-id DISTRIBUTION_ID \
  --paths '/*'
```

## Code quality and pre-commit checks

Run `npm run format` to format the repository with Prettier. `npm run lint` runs ESLint
with type-aware TypeScript rules, and `npm run precommit` runs formatting validation,
linting, the TypeScript build, and all tests.

Tests use Node's native `node:test` runner. The test script compiles TypeScript into the
ignored `dist/` directory before running `node --test`; no external test framework is used.

`npm run test:synth` exercises the real CDK entry point with a test-only placeholder
artifact. It is included in the pre-commit checks and never deploys anything.

## Simplified workspace deployment

When all application repositories are checked out as siblings, use the versioned Makefile:

```sh
make bootstrap
make synth-fast
make synth-real
make diff-dev
make deploy-dev
make destroy-dev
```

These are separate operations:

- `make deploy-dev` builds all three applications, then creates or updates the development stack.
- `make destroy-dev` deletes the development stack. It passes test artifacts only because
  the shared CDK entry point validates artifact paths; it does not build applications.

`make synth-real`, `make diff-dev`, and `make deploy-dev` build all application artifacts
and pass them to CDK. There is no manual ZIP creation or copying. Direct npm commands
remain available for standalone or CI usage and intentionally require all three artifact
path variables.

The default sibling path can be overridden when repositories live elsewhere:

```sh
make deploy-dev \
  PROCESSOR_DIR=/absolute/path/to/3d-processor \
  API_DIR=/absolute/path/to/3d-api \
  FRONTEND_DIR=/absolute/path/to/3d-frontend
```

## GitHub deployment

`.github/workflows/deploy.yml` provides continuous deployment without storing
long-lived AWS access keys. A push to `3d-infra/main` verifies all four repositories
and deploys the `dev` stage. The workflow can also be started manually with
`workflow_dispatch`; manual runs can select `dev` or `prod` and a branch, tag, or commit for
each application repository.

The workflow checks out `main` from each application repository for an automatic dev
deployment. A change pushed only to an application repository does not trigger this
infrastructure workflow. Until cross-repository release dispatch is added, start the
deployment manually after such a change or update `3d-infra/main` as part of the
coordinated release.

Configure these GitHub Environments in the `3d-infra` repository:

- `dev` — optionally require reviewer approval while the deployment is new.
- `prod` — require reviewer approval and restrict which branches may deploy.

Set the following environment variables in both environments as appropriate:

| GitHub environment value | Kind     | Purpose                                                                  |
| ------------------------ | -------- | ------------------------------------------------------------------------ |
| `AWS_DEPLOY_ROLE_ARN`    | Variable | IAM role assumed through GitHub OIDC                                     |
| `AWS_ACCOUNT_ID`         | Variable | Expected AWS account; prevents accidental cross-account deployment       |
| `MONTHLY_BUDGET_USD`     | Variable | Monthly project budget; for example `10`                                 |
| `CORS_ORIGIN`            | Variable | Optional development upload origin; production is fixed in CDK           |
| `BUDGET_ALERT_EMAIL`     | Variable | Recipient for AWS Budget notifications                                   |
| `OPERATIONS_ALERT_EMAIL` | Variable | Recipient for CloudWatch alarm notifications                             |
| `CLOUDFRONT_WEB_ACL_ARN` | Variable | Required dev pricing-plan WAF Web ACL ARN                                |
| `RATE_LIMIT_SECRET`      | Secret   | Random, stage-specific rate-limit signing secret; at least 32 characters |

If the component repositories are public, the workflow's normal GitHub token can read
them. If any are private, create `COMPONENT_REPOSITORIES_TOKEN` as an environment secret
using a fine-grained token or GitHub App token with read-only Contents access to
`3d-processor`, `3d-api`, and `3d-frontend`.

In AWS, create the GitHub OIDC provider for
`https://token.actions.githubusercontent.com` with audience `sts.amazonaws.com`, then
create a deployment role whose trust policy is restricted to this repository and the
`dev`/`prod` GitHub environments. Grant that role only the CDK bootstrap and
CloudFormation deployment permissions required by this stack. The workflow's
`id-token: write` permission lets it request a signed GitHub identity token; AWS STS
validates the token and returns temporary credentials for that workflow run. GitHub
does not store a permanent AWS access key.

GitHub Environment approval rules and the AWS OIDC provider/role are one-time external
settings and are deliberately not created by the application stack it will deploy.
Creating the deployment role from the deployable stack would introduce a bootstrap
dependency and allow that stack to modify its own deployment identity.

`npm install` configures Git to use the tracked `.githooks` directory. Every commit then
runs the same `npm run precommit` checks automatically.
