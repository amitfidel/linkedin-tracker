/**
 * Run an async worker across a list of items with bounded concurrency.
 *
 * Returns settled results in input order, so one failure doesn't abort the batch.
 * Useful for Apify actor runs (account-level concurrency limits) and Playwright
 * scrapes (memory-heavy — don't run 10 in parallel on a 512 MB container).
 *
 * @example
 *   const results = await runPool(companies, scrapeJobs, 3);
 *   for (let i = 0; i < results.length; i++) {
 *     if (results[i].status === "rejected") console.error(companies[i].name, results[i].reason);
 *   }
 */
export async function runPool<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<PromiseSettledResult<R>[]> {
  if (concurrency < 1) concurrency = 1;
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const myIndex = nextIndex++;
      if (myIndex >= items.length) return;
      try {
        const value = await worker(items[myIndex], myIndex);
        results[myIndex] = { status: "fulfilled", value };
      } catch (reason) {
        results[myIndex] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () =>
    runWorker()
  );
  await Promise.all(workers);
  return results;
}
