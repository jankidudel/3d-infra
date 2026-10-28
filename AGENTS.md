# 3D Infrastructure

## Coding guidelines

- Use explicit `{}` blocks for every `if`, `else`, loop, and other control-flow
  body, including single-statement bodies. Do not write braceless control flow.
- Keep AWS CDK constructs focused and preserve established resource names unless a
  migration is intentional.
- Do not deploy or change AWS resources unless the user explicitly requests it.

## Validation

Before completing implementation work, run:

    npm run precommit

## Preserve working cache policies

- Do not change CloudFront cache policies, cache behaviors, TTLs, compression settings, S3 Cache-Control metadata, or the CloudFront pricing plan unless the user explicitly requests that specific caching change.
- SEO audits, performance findings, general implementation requests, and deployment requests do not authorize cache-policy changes. Report findings without modifying the working configuration.
- Preserve managed `CachingDisabled` for frontend documents and API requests, and managed `CachingOptimized` for JavaScript and CSS. The production CloudFront Free plan does not support custom cache policies; do not add them or upgrade the plan to bypass this restriction.

## CloudWatch alarms

- Keep this stack at no more than 10 CloudWatch alarms. Before adding an alarm,
  count the existing alarms in the synthesized stack; if the change would exceed
  10, stop and warn the user before making the change.
