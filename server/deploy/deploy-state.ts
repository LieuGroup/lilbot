export interface Deployment {
  id: string
  releaseRoot: string
  releaseLink: string
  release: string
  previousRelease?: string
  dataDir: string
  unit: string
  watchdogUnit: string
  healthUrl: string
  previous?: string
  commit: string
  startedAt: string
  status: 'pending' | 'deploying' | 'healthy' | 'rolling-back' | 'rolled-back' | 'manual-recovery' | 'refused'
  message?: string
  logs?: string
  finishedAt?: string
}
