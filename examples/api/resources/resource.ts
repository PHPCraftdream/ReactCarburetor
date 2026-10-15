import {
    EResourceStatus, IResourceCacheData, IResourceCacheOptions, IResourceData, IResourceEntry, IResourceResolution,
    IResourceSnapshot, IResourceSource, IResourceView, ResourceCache, ResourceCarburetor, TResourceLoader,
} from 'react-carburetor';

const loader: TResourceLoader<string, string> = async key => key.toUpperCase();
const cache = new ResourceCache<string, string>(loader);
const options: IResourceCacheOptions = {};
const loadReady = async (): Promise<string> => 'ready';
class SingleResource extends ResourceCarburetor<string> {
    constructor() { super(loadReady); }
}
const resource = new SingleResource();
const data: IResourceData<string> = {
    status: EResourceStatus.Success,
    isIdle: false,
    isPending: false,
    isSuccess: true,
    isError: false,
    data: 'ready',
    error: undefined,
    updatedAt: Date.now(),
};
const entry: IResourceEntry<string> = {...data, refreshing: false, invalidated: false, failed: false};
const view: IResourceView<string> = {...entry, stale: false};
const snapshot: IResourceSnapshot<string> = {...data};
const resolution: IResourceResolution<string> = {key: 'ready', path: 'entries.ready', view};
const source: IResourceSource<string, string> = {
    getUID: () => 'source',
    getVersion: () => 0,
    subscribe: () => 'id',
    unsubscribe: () => undefined,
    resolve: () => resolution,
    load: async () => undefined,
};
const cacheData: IResourceCacheData<string> = {entries: {ready: entry}};
void [cache, options, resource, snapshot, source, cacheData];
