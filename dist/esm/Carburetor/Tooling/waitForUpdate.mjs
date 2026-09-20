import { WILDCARD_PATH } from "../Store/Paths/WildcardPath.mjs";
const waitForUpdate = (source, timeout = 1000)=>new Promise((resolve, reject)=>{
        const id = source.subscribe(()=>{
            clearTimeout(timer);
            source.unsubscribe(id);
            resolve();
        }, {
            reads: new Set([
                WILDCARD_PATH
            ])
        });
        const timer = setTimeout(()=>{
            source.unsubscribe(id);
            reject(new Error('waitForUpdate: no update within ' + timeout + 'ms'));
        }, timeout);
    });
export { waitForUpdate };
