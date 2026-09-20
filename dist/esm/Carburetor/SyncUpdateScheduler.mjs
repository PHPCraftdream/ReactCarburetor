class SyncUpdateScheduler {
    schedule = (_uid, updater)=>{
        updater();
    };
    cancel = (_uid)=>{};
}
const syncUpdateScheduler = new SyncUpdateScheduler();
export { SyncUpdateScheduler, syncUpdateScheduler };
