export const stages = {
  development: 'dev',
  production: 'prod',
} as const;

export type Stage = (typeof stages)[keyof typeof stages];
