export const SYSTEM_QUEUE = "system";
export const PING_JOB = "ping";

export async function processSystemJob(job: { name: string }): Promise<{ pong: true }> {
  if (job.name === PING_JOB) {
    return { pong: true };
  }
  throw new Error(`unknown system job: ${job.name}`);
}
