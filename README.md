# 3d-infra

AWS CDK v2 infrastructure for the 3d-quality processing pipeline. This repository contains infrastructure only; application code remains in `3d-frontend`, `3d-api`, and `3d-processor`.

## Architecture

```text
Angular → Go API → presigned PUT → S3 uploads/
                                      ↓ object-created event
                                     SQS → .NET 10 Lambda → S3 reports/
                                      ↓
                                     DLQ
```

The private S3 bucket uses S3-managed encryption, blocks public access, and expires uploads after one day and reports after seven days. The standard queue has a 720-second visibility timeout and a DLQ. The processor runs with 256 MB, a 120-second timeout, x86_64 architecture, batch size 1, and an SQS event-source maximum concurrency of 2 by default. Reserved concurrency is intentionally not configured because small account concurrency quotas may not leave AWS's required unreserved concurrency capacity.

No database, API Gateway, frontend hosting, authentication, or application processing logic is included.

## Prerequisites and bootstrap

- Node.js and npm
- AWS CLI credentials for the target account
- AWS CDK v2 (provided as a local development dependency)
- Node.js 22 or newer for the built-in test runner
- A packaged Lambda artifact built by `3d-processor`

The default region is `us-east-1`; account IDs are read from the active AWS credentials.

```bash
npm install
AWS_PROFILE=your-profile make bootstrap
```

The placeholder artifact is supplied because this repository validates the processor
artifact whenever CDK loads the app, including during `cdk bootstrap`. Bootstrap creates
only the regional CDK support stack; it does not deploy this placeholder processor. The
Make target obtains the account ID from the active AWS credentials and defaults to
`us-east-1`. Override the region with `AWS_REGION=...` if needed.

## Processor artifact boundary

`3d-processor` owns build, test, and packaging. It produces a Lambda-ready ZIP file or asset directory. `3d-infra` receives that artifact and deploys it; CDK does not compile C#.

```bash
export PROCESSOR_ARTIFACT_PATH=/absolute/path/to/processor.zip
# or append: -c processorArtifactPath=/absolute/path/to/processor.zip
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
npx cdk synth -c stage=dev
npx cdk diff -c stage=dev
npx cdk deploy -c stage=dev
npx cdk destroy -c stage=dev
```

The artifact path is required by the CDK entry point for these direct commands. The npm
wrappers work as `npm run synth -- -c stage=dev`, `npm run diff -- -c stage=dev`, and
`npm run deploy -- -c stage=dev`.

| Setting                          | Context                              | Environment                              | Default                        |
| -------------------------------- | ------------------------------------ | ---------------------------------------- | ------------------------------ |
| Artifact                         | `processorArtifactPath`              | `PROCESSOR_ARTIFACT_PATH`                | required                       |
| Memory (MB)                      | `processorMemory`                    | `PROCESSOR_MEMORY_MB`                    | `256`                          |
| Event-source maximum concurrency | `processorEventSourceMaxConcurrency` | `PROCESSOR_EVENT_SOURCE_MAX_CONCURRENCY` | `2`                            |
| Browser origin                   | `corsOrigin`                         | `CORS_ORIGIN`                            | localhost in dev; none in prod |
| Monthly budget (USD)             | `monthlyBudgetUsd`                   | `MONTHLY_BUDGET_USD`                     | `10` when alerts are enabled   |
| Budget alert email               | `budgetAlertEmail`                   | `BUDGET_ALERT_EMAIL`                     | disabled when omitted          |

For production, use `-c stage=prod` and explicitly set the production browser origin when needed. Production retains the bucket and its contents when the stack is deleted; development enables bucket cleanup. Review the CloudFormation diff and concurrency setting before every production deployment.

Processor logs use the same lifecycle policy in every stage. A newly created log group is
deleted if its initial deployment rolls back, preventing an empty orphan from blocking a
retry. Once successfully deployed, the log group and its diagnostic history are retained
if the stack is deleted or the resource is replaced.

Set `BUDGET_ALERT_EMAIL` to create a project-tag-filtered monthly AWS Budget with
forecasted 50% and actual 80%/100% email notifications. AWS sends the notifications
to that address after deployment; budget alerts report spend but do not automatically
disable resources. The `Project` cost-allocation tag must be activated in the billing
account for tag-filtered costs to appear in the budget.

The stack outputs the bucket name, queue URL, DLQ URL, and processor function name.

## Code quality and pre-commit checks

Run `npm run format` to format the repository with Prettier. `npm run lint` runs ESLint
with type-aware TypeScript rules, and `npm run precommit` runs formatting validation,
linting, the TypeScript build, and all tests.

Tests use Node's native `node:test` runner. The test script compiles TypeScript into the
ignored `dist/` directory before running `node --test`; no external test framework is used.

`npm run test:synth` exercises the real CDK entry point with a test-only placeholder
artifact. It is included in the pre-commit checks and never deploys anything.

## Simplified workspace deployment

When this repository is checked out beside `3d-processor`, use its versioned
Makefile:

```sh
make bootstrap
make synth-fast
make synth-real
make diff-dev
make deploy-dev
make destroy-dev
```

These are separate operations:

- `make deploy-dev` packages the processor, then creates or updates the development stack.
- `make destroy-dev` deletes the development stack. It passes the test artifact only
  because the shared CDK entry point requires an artifact path; it does not package or
  deploy the processor.

`make synth-real`, `make diff-dev`, and `make deploy-dev` package the processor
automatically, then pass `3d-processor/artifacts/3d-processor.zip` to CDK. There is no
manual ZIP creation, copying, or artifact-path configuration. Direct `npm run synth`,
`npm run diff`, and `npm run deploy` remain available for standalone or CI usage and
intentionally require `PROCESSOR_ARTIFACT_PATH`.

The default sibling path can be overridden when repositories live elsewhere:

```sh
make deploy-dev PROCESSOR_DIR=/absolute/path/to/3d-processor
```

`npm install` configures Git to use the tracked `.githooks` directory. Every commit then
runs the same `npm run precommit` checks automatically.
