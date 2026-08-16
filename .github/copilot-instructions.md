# GitHub Copilot Instructions

Follow the repository architecture and development guidelines documented in
`AGENTS.md`.

- Use explicit `{}` blocks for every `if`, `else`, loop, and other control-flow
  body, including single-statement bodies. Do not write braceless control flow.
- Keep infrastructure changes small and reviewable.
- Do not deploy from generated code or instructions.

Before completing implementation work, ensure:

    npm run precommit
