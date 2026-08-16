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
