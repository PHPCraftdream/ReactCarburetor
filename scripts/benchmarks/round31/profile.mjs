import {Session} from 'node:inspector';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const script = resolve(process.argv[2]);
const distribution = resolve(process.argv[3]);
const session = new Session();
session.connect();
const post = (method, parameters = {}) => new Promise((resolveReply, reject) => {
    session.post(method, parameters, (error, result) => error ? reject(error) : resolveReply(result));
});
const matchesLibrary = url => {
    const normalized = url.replace(/\\/g, '/');
    const prefix = distribution.replace(/\\/g, '/');
    return normalized.startsWith(prefix + '/') || normalized.startsWith(pathToFileURL(distribution).href + '/');
};
try {
    await post('HeapProfiler.enable');
    await post('HeapProfiler.startSampling', {samplingInterval: 4096,
        includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true});
    process.argv = [process.argv[0], script, distribution, ...process.argv.slice(4)];
    await import(pathToFileURL(script).href);
    const {profile} = await post('HeapProfiler.stopSampling');
    let totalSelfBytes = 0, librarySelfBytes = 0;
    const visit = node => {
        totalSelfBytes += node.selfSize;
        if (matchesLibrary(node.callFrame.url)) librarySelfBytes += node.selfSize;
        for (const child of node.children) visit(child);
    };
    visit(profile.head);
    console.log(JSON.stringify({allocationSampling: {distribution, script, samplingInterval: 4096,
        totalSelfBytes, librarySelfBytes, samples: profile.samples.length,
        caveat: 'V8 sampled allocation estimates include workload setup; not exact bytes or retained heap.'}}));
} finally {
    session.disconnect();
}
