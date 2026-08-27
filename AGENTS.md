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

## CloudWatch alarms

- Keep this stack at no more than 10 CloudWatch alarms. Before adding an alarm,
  count the existing alarms in the synthesized stack; if the change would exceed
  10, stop and warn the user before making the change.
