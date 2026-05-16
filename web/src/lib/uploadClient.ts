import axios, { type AxiosResponse } from "axios";

/** No timeout — large folder uploads can run for hours. */
export const storageUploadClient = axios.create({ timeout: 0 });

const RETRYABLE_CODES = new Set(["ERR_NETWORK", "ECONNABORTED", "ETIMEDOUT"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function putWithRetry<T = unknown>(
  url: string,
  data: Blob,
  config: Parameters<typeof storageUploadClient.put>[2]
): Promise<AxiosResponse<T>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await storageUploadClient.put<T>(url, data, config);
    } catch (err) {
      lastError = err;
      if (!axios.isAxiosError(err)) throw err;
      if (axios.isCancel(err) || err.code === "ERR_CANCELED") throw err;
      const retryable =
        !err.response ||
        err.response.status >= 500 ||
        RETRYABLE_CODES.has(err.code ?? "");
      if (!retryable || attempt === 3) throw err;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastError;
}
