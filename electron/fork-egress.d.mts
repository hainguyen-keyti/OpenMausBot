export type DenylistRule = { suffix: string; host?: undefined; path?: undefined } | { host: string; path?: string; suffix?: undefined };

export declare const DENYLIST: readonly DenylistRule[];
export declare function isBlockedUrl(url: string | URL | undefined): boolean;
export declare function blockingFetch(fetchImpl?: typeof fetch): typeof fetch;
export declare function installEgressBlock(session: {
  webRequest: { onBeforeRequest(listener: (details: { url: string }, callback: (response: { cancel: boolean }) => void) => void): void };
}): void;
