export type CronConfig = {
  enabled?: boolean;
  store?: string;
  maxConcurrentRuns?: number;
  webhook?: {
    url: string;
    secret?: string;
    timeoutMs?: number;
  };
};
