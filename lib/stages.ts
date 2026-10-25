export const stages = {
  development: 'dev',
  production: 'prod',
} as const;

export type Stage = (typeof stages)[keyof typeof stages];

/** Hosted development is disabled; its constructs remain available for future use. */
export function deploymentStage(value: unknown = stages.production): typeof stages.production {
  // Future re-enablement: widen the return type to Stage and restore this case,
  // then update the progress wrapper, Makefile guards and GitHub workflows together.
  // if (value === stages.development) {
  //   return stages.development;
  // }
  if (value !== stages.production) {
    throw new Error('Hosted development is disabled. Only the prod deployment stage is supported.');
  }
  return stages.production;
}
