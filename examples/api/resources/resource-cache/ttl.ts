// #region ttl
import {EResourceStatus, IResourceCacheData, IResourceCacheOptions, IResourceEntry, ResourceCache} from 'react-carburetor';

interface Quote {
    text: string;
}

declare function fetchQuote(symbol: string): Promise<Quote>;

const quoteOptions: IResourceCacheOptions = {ttl: 30_000, maxEntries: 100, keyCacheSize: 256};

const quoteCache = new ResourceCache<Quote, string>(
    (symbol: string, _signal: AbortSignal) => fetchQuote(symbol),
    quoteOptions
);

export const quoteSnapshot = (symbol: string): IResourceCacheData<Quote>['entries'] => {
    const view = quoteCache.getEntry(symbol);
    const settled = view.isSuccess;
    const entry: IResourceEntry<Quote> = {
        status: settled ? EResourceStatus.Success : EResourceStatus.Idle,
        isIdle: !settled,
        isPending: false,
        isSuccess: settled,
        isError: false,
        data: view.data,
        error: view.error,
        updatedAt: view.updatedAt,
        refreshing: view.refreshing,
        invalidated: view.invalidated,
        failed: view.failed,
    };
    return {[symbol]: entry};
};
// #endregion ttl
