/** Internal store identities; deliberately absent from package exports (R40-01). */
export class S {
    /** Freshness counter shared with publication ports. */
    public static readonly version = Symbol('store.version');
    /** Unique dependency identity, independent of application fields. */
    public static readonly uid = Symbol('store.uid');
    /** Internal data slot. */
    public static readonly data = Symbol("store.data");
    /** Internal scheduler slot. */
    public static readonly scheduler = Symbol("store.scheduler");
    /** Internal subscribers slot. */
    public static readonly subscribers = Symbol("store.subscribers");
    /** Internal subscriptionGeneration slot. */
    public static readonly subscriptionGeneration = Symbol("store.subscriptionGeneration");
    /** Internal subscriberIndex slot. */
    public static readonly subscriberIndex = Symbol("store.subscriberIndex");
    /** Internal aliases slot. */
    public static readonly aliases = Symbol("store.aliases");
    /** Internal patchPort slot. */
    public static readonly patchPort = Symbol("store.patchPort");
    /** Internal patchObservers slot. */
    public static readonly patchObservers = Symbol("store.patchObservers");
    /** Internal notifiedVersion slot. */
    public static readonly notifiedVersion = Symbol("store.notifiedVersion");
    /** Internal subscriptionByReads slot. */
    public static readonly subscriptionByReads = Symbol("store.subscriptionByReads");
    /** Internal writes slot. */
    public static readonly writes = Symbol("store.writes");
    /** Internal writeTargets slot. */
    public static readonly writeTargets = Symbol("store.writeTargets");
    /** Internal writeLog slot. */
    public static readonly writeLog = Symbol("store.writeLog");
    /** Internal targetOwners slot. */
    public static readonly targetOwners = Symbol("store.targetOwners");
    /** Internal draftTouched slot. */
    public static readonly draftTouched = Symbol("store.draftTouched");
    /** Internal pendingEmit slot. */
    public static readonly pendingEmit = Symbol("store.pendingEmit");
    /** Internal unpublishedDraftCheck slot. */
    public static readonly unpublishedDraftCheck = Symbol("store.unpublishedDraftCheck");
    /** Internal draftProxy slot. */
    public static readonly draftProxy = Symbol("store.draftProxy");
    /** Internal publicationPending slot. */
    public static readonly publicationPending = Symbol("store.publicationPending");
    /** Internal pendingPublication slot. */
    public static readonly pendingPublication = Symbol("store.pendingPublication");
    /** Internal activeInstallation slot. */
    public static readonly activeInstallation = Symbol("store.activeInstallation");
    /** Internal writeRecorder slot. */
    public static readonly writeRecorder = Symbol("store.writeRecorder");
    /** Internal commitState slot. */
    public static readonly commitState = Symbol("store.commitState");
    /** Internal port slot. */
    public static readonly port = Symbol("store.port");
    /** Internal retract slot. */
    public static readonly retract = Symbol("store.retract");
    /** Internal rememberPublication slot. */
    public static readonly rememberPublication = Symbol("store.rememberPublication");
    /** Internal touchDraft slot. */
    public static readonly touchDraft = Symbol("store.touchDraft");
    /** Internal recordWrite slot. */
    public static readonly recordWrite = Symbol("store.recordWrite");
}
