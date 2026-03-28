import { ApifyClient } from "apify-client";

let client: ApifyClient | null = null;

export function getApifyClient(): ApifyClient {
  if (!client) {
    const token = process.env.APIFY_API_TOKEN;
    if (!token) {
      throw new Error(
        "APIFY_API_TOKEN is not set. Add it to your .env file."
      );
    }
    client = new ApifyClient({ token });
  }
  return client;
}
