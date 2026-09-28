import { PATH_SEPARATOR } from "./PathSeparator.mjs";
import { WILDCARD_PATH } from "./WildcardPath.mjs";
const DEFAULT_CAPACITY = 8192;
class WriteLog {
    capacity;
    last = new Map();
    under = new Map();
    wildcardVersion = 0;
    watermark = 0;
    constructor(capacity = DEFAULT_CAPACITY){
        this.capacity = capacity;
    }
    record(version, writes) {
        for (const path of writes){
            if (path === WILDCARD_PATH) {
                this.wildcardVersion = version;
                continue;
            }
            this.last.set(path, version);
            let cut = path.lastIndexOf(PATH_SEPARATOR);
            while(cut > 0){
                this.under.set(path.slice(0, cut), version);
                cut = path.lastIndexOf(PATH_SEPARATOR, cut - 1);
            }
        }
        if (this.last.size + this.under.size > this.capacity) {
            this.last.clear();
            this.under.clear();
            this.watermark = version;
        }
    }
    matches(baselineVersion, reads) {
        if (baselineVersion < this.watermark || this.wildcardVersion > baselineVersion) return true;
        if (reads.has(WILDCARD_PATH)) return true;
        for (const path of reads){
            if ((this.last.get(path) ?? 0) > baselineVersion || (this.under.get(path) ?? 0) > baselineVersion) return true;
            let cut = path.lastIndexOf(PATH_SEPARATOR);
            while(cut > 0){
                if ((this.last.get(path.slice(0, cut)) ?? 0) > baselineVersion) return true;
                cut = path.lastIndexOf(PATH_SEPARATOR, cut - 1);
            }
        }
        return false;
    }
}
export { WriteLog };
