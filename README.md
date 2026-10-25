# 3d-infra

AWS CDK v2 infrastructure for the 3d-quality processing pipeline. This repository contains infrastructure only; application code remains in `3d-frontend`, `3d-api`, and `3d-processor`.

## Architecture

```text
Angular → Go API → presigned POST → S3 jobs/{jobId}/input/input.stl
                                                ↓ object-created event
                                               SQS → .NET 10 Lambda
                                                ↓             ↓
                                               DLQ   jobs/{jobId}/output/report.json
```

The private S3 bucket uses S3-managed encryption, blocks public access, and expires complete job subtrees after one day. The standard queue has a 720-second visibility timeout and a DLQ. The processor runs with 256 MB, a 120-second timeout, x86_64 architecture, batch size 1, and a fixed SQS event-source maximum concurrency of 2. Reserved concurrency is intentionally not configured because small account concurrency quotas may not leave AWS's required unreserved concurrency capacity.

No database or authentication is introduced. Job metadata, inputs, reports, and
terminal failure results live in S3. The Go API runs in Lambda behind a throttled
HTTP API. CloudFront serves the private frontend bucket and proxies `/api/*` to
API Gateway.

Production API Gateway allows 2 requests per second with a burst of 4; rejected requests
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

Hosted deployments use the production frontend build only. `ng serve` retains its
local development configuration and local development remains noindex.

```bash
export PROCESSOR_ARTIFACT_PATH=/absolute/path/to/processor.zip
export API_ARTIFACT_PATH=/absolute/path/to/3d-api.zip
export FRONTEND_ARTIFACT_PATH=/absolute/path/to/frontend/browser
```

The configured handler is `Processor::Processor.Function::FunctionHandler`: the
`Processor` assembly, `Processor.Function` type, and `FunctionHandler` method. The
processor repository provides this SQS/S3 Lambda adapter alongside its CLI.

## Build, test, and deploy

Hosted deployment is production-only. Stage defaults to `prod`; the CDK entry point
and Makefiles reject `dev` and other stage values. Legacy development construct cases
remain available for tests and future re-enablement; the entry point currently blocks them.

```bash
npm run build
npm test
npm run format:check
npm run lint
export PROCESSOR_ARTIFACT_PATH=/absolute/path/to/processor.zip
export API_ARTIFACT_PATH=/absolute/path/to/3d-api.zip
export FRONTEND_ARTIFACT_PATH=/absolute/path/to/frontend/browser
npx cdk synth -c stage=prod
npx cdk diff -c stage=prod
npx cdk deploy -c stage=prod --parameters RateLimitSecret="$RATE_LIMIT_SECRET" --parameters TurnstileSecret="$TURNSTILE_SECRET"
```

All three artifact paths are required by the CDK entry point for these direct commands.
Production synthesis requires `GOOGLE_SITE_VERIFICATION`. Deployments also require
a random `RATE_LIMIT_SECRET` of at least 32 characters and `TURNSTILE_SECRET`. The npm wrappers
work as `npm run synth -- -c stage=prod`, `npm run diff -- -c stage=prod`, and
`npm run deploy -- -c stage=prod --parameters RateLimitSecret="$RATE_LIMIT_SECRET"`.

## Production contact delivery

The production contact form sends directly through Amazon SES to `hello@inspectmesh.com`; it does not use SQS. Before the first production deployment:

1. Create a free Cloudflare Turnstile widget for `www.inspectmesh.com` and add its public site key as `contactCaptchaSiteKey` in `3d-frontend/src/environments/site-config.production.json`.
2. Store its private secret as `TURNSTILE_SECRET` in the protected production GitHub Environment and pass it to CDK as the no-echo `TurnstileSecret` parameter.
3. After deployment, open the SES verification message received at `hello@inspectmesh.com` and confirm the identity.

The Turnstile secret is never included in the browser bundle or committed to the repository. SES usage is pay-as-you-go; no SQS queue is created for contact delivery.

Before SES is called, the API enforces two accepted-message limits: 10 per viewer address per UTC day and 1,000 globally per UTC day. The global limit is a deliberate cost ceiling for contact delivery.

| Setting                | Context                 | Environment               | Default                           |
| ---------------------- | ----------------------- | ------------------------- | --------------------------------- |
| Processor artifact     | `processorArtifactPath` | `PROCESSOR_ARTIFACT_PATH` | required                          |
| API artifact           | `apiArtifactPath`       | `API_ARTIFACT_PATH`       | required                          |
| Frontend artifact      | `frontendArtifactPath`  | `FRONTEND_ARTIFACT_PATH`  | required                          |
| Memory (MB)            | `processorMemory`       | `PROCESSOR_MEMORY_MB`     | `256`                             |
| Browser upload origin  | `corsOrigin`            | `CORS_ORIGIN`             | canonical production URL          |
| Monthly budget (USD)   | `monthlyBudgetUsd`      | `MONTHLY_BUDGET_USD`      | `10` when alerts are enabled      |
| Budget alert email     | `budgetAlertEmail`      | `BUDGET_ALERT_EMAIL`      | disabled when omitted             |
| Operations alert email | `operationsAlertEmail`  | `OPERATIONS_ALERT_EMAIL`  | alarms have no email when omitted |
| Create-job burst limit | `createJobBurstLimit`   | `CREATE_JOB_BURST_LIMIT`  | `4`                               |
| Create-job rate/second | `createJobRateLimit`    | `CREATE_JOB_RATE_LIMIT`   | `2`                               |

Production CORS is fixed to `https://www.inspectmesh.com`; a different non-empty
`CORS_ORIGIN` fails synthesis. This does not make the bucket public or authorize
unsigned requests. Production retains its storage buckets and contents when the
stack is deleted. Review the CloudFormation diff before every production deployment.

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
`/stl-quality-check` with caching disabled at the edge. The deployment workflow
uploads fingerprinted JavaScript, CSS and font assets with a one-year immutable
browser cache policy, while HTML and stable public files revalidate on every
refresh. CloudFront optimizes JavaScript and CSS cache delivery; `/api/*` is
forwarded to API Gateway with caching disabled. Frontend deployments do not request invalidations or delete hashed chunks. To clear a document manually, use the `FrontendDistributionId` stack
output:

```sh
aws cloudfront create-invalidation \
  --distribution-id DISTRIBUTION_ID \
  --paths '/' '/index.html' '/*/index.html'
```

Production defines a CloudFront-scope WAF Web ACL named `3d-prod-cloudfront`. Its
single IP-based rule blocks a source after 3,000 requests in five minutes across the
whole distribution; this includes frontend assets and `/api/*`. It has no URI
byte-match scope because that condition is not available on CloudFront's Free plan.

The production ACL is managed by this stack and is retained if the stack is removed.

In
**3d-prod CloudFront - Manage plan**, select the Free plan and attach the
`inspectmesh.com` hosted zone in the same account to the distribution using that
domain.

The API's default `execute-api` hostname remains public because it is currently the
CloudFront API origin. It can bypass the CloudFront WAF. Do not disable it until a
production API custom domain has been created, mapped to the `$default` stage, used
as the CloudFront `api/*` origin, and verified with a job creation and direct S3
POST upload. Then disable the default execute-api endpoint in a separate deployment.
API Gateway throttling and the application DynamoDB quotas remain active on either
path.

## Code quality and pre-commit checks

Run `npm run format` to format the repository with Prettier. `npm run lint` runs ESLint
with type-aware TypeScript rules, and `npm run precommit` runs formatting validation,
linting, the TypeScript build, and all tests.

Tests use Node's native `node:test` runner. The test script compiles TypeScript into the
ignored `dist/` directory before running `node --test`; no external test framework is used.

`npm run test:synth` exercises the real CDK entry point with a test-only placeholder
artifact. It is included in the pre-commit checks and never deploys anything.

## Workspace validation

From the workspace root, `make check` checks all four repositories; `make synth-fast`
synthesizes production with fixture artifacts and a fixture verification token, without
calling deploy. `make synth` builds real application artifacts before synthesis and
`make diff-prod` compares production with AWS. In this repository the equivalent real
synthesis command is `make synth-real`. Provide `GOOGLE_SITE_VERIFICATION` for real
production synthesis. The old `deploy-dev` and `destroy-dev` Make targets are removed.
Production publishing uses the protected manual GitHub workflows below.

## GitHub deployment

`.github/workflows/deploy.yml` (`deploy-all`) is started manually with
`workflow_dispatch`. Select a branch, tag or commit for each application repository;
the default reference is `main`. The workflow verifies all four repositories and
deploys to the protected `prod` GitHub Environment using temporary AWS credentials.
All deployment workflows target production explicitly; there is no environment picker.
Pushes do not start a deployment. `npm run verify` builds and checks the production
frontend once and that same artifact is deployed.

For frontend-only changes, use `deploy-frontend` in `3d-frontend`. It uploads directly
from the GitHub runner, avoiding the CDK bucket-deployment Lambda. Use `deploy-all`
for coordinated releases and `deploy-infra` for infrastructure configuration changes.

`deploy-all` and `deploy-infra` share one repository-wide `infrastructure` concurrency
queue. Production infrastructure updates execute one at a time and running updates
are never automatically cancelled. The queue does not cover local CLI deployments
or workflows in other repositories; avoid running those against a stack being updated.

Both workflows use `bin/deploy-with-progress.ts`. It checks that the target stack
has no operation in progress before invoking CDK, uses line-oriented CDK events,
and prints an independent CloudFormation status/event snapshot every 60 seconds.
After ten minutes it prints a diagnostic warning and the upload helper's log group
when available. The warning is based on total elapsed time, not proof of a stalled
resource. Diagnostic API calls have bounded timeouts and do not turn a successful
deployment into a failure if a status refresh is unavailable. CDK's exit status is
preserved. Raw Lambda logs and deployment parameter values are not echoed by the
monitor.

If GitHub output is quiet, compare the reported AWS event timestamps. A resource
still marked `UPDATE_IN_PROGRESS` in CloudFormation is an AWS-side wait, not merely
a lost GitHub progress display. Inspect the helper log group for timeouts, memory
errors, throttling, S3 failures or a failed custom-resource response. These are
possible causes, not diagnoses from elapsed time alone. Cancelling a GitHub run
does not cancel the CloudFormation operation; inspect its state before retrying.
The wrapper never requests stack cancellation, rollback or deletion automatically.

These controls create no AWS resources, alarms, log groups, invalidations or
provisioned capacity. They add bounded read-only CloudFormation API requests and
GitHub log output. They do not repair or interrupt an update already running.

Configure the `prod` GitHub Environment in each component repository and
`3d-infra`, with reviewer approval and deployment branch restrictions.

Set the following production environment variables as appropriate:

| GitHub environment value | Kind     | Purpose                                                                  |
| ------------------------ | -------- | ------------------------------------------------------------------------ |
| `AWS_DEPLOY_ROLE_ARN`    | Variable | IAM role assumed through GitHub OIDC                                     |
| `AWS_ACCOUNT_ID`         | Variable | Expected AWS account; prevents accidental cross-account deployment       |
| `MONTHLY_BUDGET_USD`     | Variable | Monthly project budget; for example `10`                                 |
| `CORS_ORIGIN`            | Variable | Production origin is fixed in CDK                                        |
| `BUDGET_ALERT_EMAIL`     | Variable | Recipient for AWS Budget notifications                                   |
| `OPERATIONS_ALERT_EMAIL` | Variable | Recipient for CloudWatch alarm notifications                             |
| `RATE_LIMIT_SECRET`      | Secret   | Random, stage-specific rate-limit signing secret; at least 32 characters |

If the component repositories are public, the workflow's normal GitHub token can read
them. If any are private, create `COMPONENT_REPOSITORIES_TOKEN` as an environment secret
using a fine-grained token or GitHub App token with read-only Contents access to
`3d-processor`, `3d-api`, and `3d-frontend`.

In AWS, create the GitHub OIDC provider for
`https://token.actions.githubusercontent.com` with audience `sts.amazonaws.com`, then
create a deployment role whose trust policy is restricted to this repository and the
`prod` GitHub Environment. Grant that role only the CDK bootstrap and
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

## Re-enable hosted development in future

Development infrastructure constructs and their tests are preserved. The workflow
files keep the environment selector commented out, with `prod` as its default.
The frontend retains its dormant `build:deployment-development` script and optimized,
noindex Angular configuration. Nothing in the current workflows selects or deploys dev.

To re-enable it deliberately, restore the commented selector in each deployment
workflow (merge it into the existing component inputs in `deploy-all`), wire job
`environment`, `STAGE` and concurrency to that selection, and update the production-only
guards in `lib/stages.ts`, `bin/deploy-with-progress.ts` and both Makefiles together.
The stage helper and Makefiles include commented development cases. For `deploy-all`,
keep reusing the verified build for prod; dev needs its own noindex build after verification.

Restore the `dev` GitHub Environment and dev-only OIDC trust, plus the private hosting
secret for infrastructure deployments. The preserved `DevBasicAuthAuthorization`
parameter expects the full `Basic <base64(username:password)>` authorization header;
pass it only for dev via the `DEV_BASIC_AUTHORIZATION` GitHub Environment secret.
Keep production Turnstile configuration scoped to prod and verify the development
robots/canonical output before publishing. Review AWS costs and the stack diff first:
a hosted dev stack can incur storage, requests, transfer, Lambda and logging charges.

## Optional cleanup of the existing hosted development environment

Source changes disable new dev deployments but do not delete resources already in AWS
or remove external GitHub Environments. Using authenticated access to the correct AWS
account and `us-east-1`, inspect `three-d-infra-dev` and its resources, outputs, status
and retention policies before deletion. Do not target `three-d-infra-prod`.

The legacy dev bucket definitions enable automatic object deletion. Deleting the dev
stack can therefore permanently remove uploaded jobs, reports and frontend files.
After confirming its inventory and resolving any active stack operation, delete only
the identified dev stack through CloudFormation and wait for `DELETE_COMPLETE`.
Inspect retained dev log groups separately; do not delete shared CDK bootstrap assets,
OIDC providers, account-wide budgets or production resources. Retained logs may continue
to incur storage charges. Cleanup can incur ordinary deletion/helper invocation usage;
it creates no replacement hosted environment and removes ongoing dev resource usage.

After no old dev deployment is running, remove the `dev` GitHub Environment and its
secrets from all four repositories, and revoke dev-only deployment-role trust. Keep the
`prod` GitHub Environment, its approval rules, secrets and OIDC trust intact. GitHub
settings and AWS deletion require live authenticated access; do not infer completion
from changed source files. Local `ng serve` and local API/processor workflows remain
available. Private/noindex behaviour in local development remains intentional.
