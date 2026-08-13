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

The private S3 bucket uses S3-managed encryption, blocks public access, and expires uploads after one day and reports after seven days. The standard queue has a 720-second visibility timeout and a DLQ. The processor runs with 256 MB, a 120-second timeout, x86_64 architecture, batch size 1, and reserved concurrency 1 by default.

No database, API Gateway, frontend hosting, authentication, or application processing logic is included.

## Prerequisites and bootstrap

- Node.js and npm
- AWS CLI credentials for the target account
- AWS CDK v2 (provided as a local development dependency)
- A packaged Lambda artifact built by `3d-processor`

The default region is `eu-west-2`; account IDs are read from the active AWS credentials.

```bash
npm install
npx cdk bootstrap aws://ACCOUNT_ID/eu-west-2
```

## Processor artifact boundary

`3d-processor` owns build, test, and packaging. It produces a Lambda-ready ZIP file or asset directory. `3d-infra` receives that artifact and deploys it; CDK does not compile C#.

```bash
export PROCESSOR_ARTIFACT_PATH=/absolute/path/to/processor.zip
# or append: -c processorArtifactPath=/absolute/path/to/processor.zip
```

The configured handler is `3d-processor::Processor.Function::FunctionHandler`; adjust it if the processor assembly, type, or method differs.

## Build, test, and deploy

Stage comes from `-c stage=...` or `STAGE` and defaults to `dev`.

```bash
npm run build
npm test
npx cdk synth -c stage=dev
npx cdk diff -c stage=dev
npx cdk deploy -c stage=dev
npx cdk destroy -c stage=dev
```

The npm wrappers work as `npm run synth -- -c stage=dev`, `npm run diff -- -c stage=dev`, and `npm run deploy -- -c stage=dev`.

| Setting | Context | Environment | Default |
|---|---|---|---|
| Artifact | `processorArtifactPath` | `PROCESSOR_ARTIFACT_PATH` | required |
| Memory (MB) | `processorMemory` | `PROCESSOR_MEMORY_MB` | `256` |
| Reserved concurrency | `processorConcurrency` | `PROCESSOR_RESERVED_CONCURRENCY` | `1` |
| Browser origin | `corsOrigin` | `CORS_ORIGIN` | localhost in dev; none in prod |

For production, use `-c stage=prod` and explicitly set the production browser origin when needed. Production retains the bucket and its contents when the stack is deleted; development enables bucket cleanup. Review the CloudFormation diff and concurrency setting before every production deployment.

The stack outputs the bucket name, queue URL, DLQ URL, and processor function name.
