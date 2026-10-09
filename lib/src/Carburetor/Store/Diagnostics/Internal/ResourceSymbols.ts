/** Internal resource state and plumbing; absent from package exports (R40-01). */
export class R {
    /** Internal abortKey slot. */
    public static readonly abortKey = Symbol("resource.abortKey");
    /** Internal bulkDepth slot. */
    public static readonly bulkDepth = Symbol("resource.bulkDepth");
    /** Internal cancelInFlight slot. */
    public static readonly cancelInFlight = Symbol("resource.cancelInFlight");
    /** Internal ensureRuntime slot. */
    public static readonly ensureRuntime = Symbol("resource.ensureRuntime");
    /** Internal evict slot. */
    public static readonly evict = Symbol("resource.evict");
    /** Internal eviction slot. */
    public static readonly eviction = Symbol("resource.eviction");
    /** Internal fetch slot. */
    public static readonly fetch = Symbol("resource.fetch");
    /** Internal finishBulk slot. */
    public static readonly finishBulk = Symbol("resource.finishBulk");
    /** Internal forgetKey slot. */
    public static readonly forgetKey = Symbol("resource.forgetKey");
    /** Internal getEntryByKey slot. */
    public static readonly getEntryByKey = Symbol("resource.getEntryByKey");
    /** Internal hasRequest slot. */
    public static readonly hasRequest = Symbol("resource.hasRequest");
    /** Internal installState slot. */
    public static readonly installState = Symbol("resource.installState");
    /** Internal isCurrent slot. */
    public static readonly isCurrent = Symbol("resource.isCurrent");
    /** Internal isRetentionFree slot. */
    public static readonly isRetentionFree = Symbol("resource.isRetentionFree");
    /** Internal isStale slot. */
    public static readonly isStale = Symbol("resource.isStale");
    /** Internal keyCacheSize slot. */
    public static readonly keyCacheSize = Symbol("resource.keyCacheSize");
    /** Internal keyMutationReported slot. */
    public static readonly keyMutationReported = Symbol("resource.keyMutationReported");
    /** Internal keyOf slot. */
    public static readonly keyOf = Symbol("resource.keyOf");
    /** Internal lastKeyArgs slot. */
    public static readonly lastKeyArgs = Symbol("resource.lastKeyArgs");
    /** Internal lastKeyJson slot. */
    public static readonly lastKeyJson = Symbol("resource.lastKeyJson");
    /** Internal lastKeyValue slot. */
    public static readonly lastKeyValue = Symbol("resource.lastKeyValue");
    /** Internal loader slot. */
    public static readonly loader = Symbol("resource.loader");
    /** Internal markLoading slot. */
    public static readonly markLoading = Symbol("resource.markLoading");
    /** Internal maxEntries slot. */
    public static readonly maxEntries = Symbol("resource.maxEntries");
    /** Internal operationVersion slot. */
    public static readonly operationVersion = Symbol("resource.operationVersion");
    /** Internal pathOf slot. */
    public static readonly pathOf = Symbol("resource.pathOf");
    /** Internal pathOfKey slot. */
    public static readonly pathOfKey = Symbol("resource.pathOfKey");
    /** Internal primed slot. */
    public static readonly primed = Symbol("resource.primed");
    /** Internal primedHead slot. */
    public static readonly primedHead = Symbol("resource.primedHead");
    /** Internal primedKeys slot. */
    public static readonly primedKeys = Symbol("resource.primedKeys");
    /** Internal primedTail slot. */
    public static readonly primedTail = Symbol("resource.primedTail");
    /** Internal reconcileError slot. */
    public static readonly reconcileError = Symbol("resource.reconcileError");
    /** Internal reconcileFailure slot. */
    public static readonly reconcileFailure = Symbol("resource.reconcileFailure");
    /** Internal reconcileFailureWrite slot. */
    public static readonly reconcileFailureWrite = Symbol("resource.reconcileFailureWrite");
    /** Internal removalEpoch slot. */
    public static readonly removalEpoch = Symbol("resource.removalEpoch");
    /** Internal removeEntries slot. */
    public static readonly removeEntries = Symbol("resource.removeEntries");
    /** Internal restoreGeneration slot. */
    public static readonly restoreGeneration = Symbol("resource.restoreGeneration");
    /** Internal runtime slot. */
    public static readonly runtime = Symbol("resource.runtime");
    /** Internal runtimeFor slot. */
    public static readonly runtimeFor = Symbol("resource.runtimeFor");
    /** Internal runtimeRecords slot. */
    public static readonly runtimeRecords = Symbol("resource.runtimeRecords");
    /** Internal settleError slot. */
    public static readonly settleError = Symbol("resource.settleError");
    /** Internal settleFailure slot. */
    public static readonly settleFailure = Symbol("resource.settleFailure");
    /** Internal settleSuccess slot. */
    public static readonly settleSuccess = Symbol("resource.settleSuccess");
    /** Internal start slot. */
    public static readonly start = Symbol("resource.start");
    /** Internal touch slot. */
    public static readonly touch = Symbol("resource.touch");
    /** Internal touchPrimed slot. */
    public static readonly touchPrimed = Symbol("resource.touchPrimed");
    /** Internal ttl slot. */
    public static readonly ttl = Symbol("resource.ttl");
    /** Internal viewCache slot. */
    public static readonly viewCache = Symbol("resource.viewCache");
}
