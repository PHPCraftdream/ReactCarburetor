class SyncUpdateScheduler {
    schedule = (_uid, updater)=>{
        updater();
    };
    cancel = (_uid)=>{};
}
export { SyncUpdateScheduler };
