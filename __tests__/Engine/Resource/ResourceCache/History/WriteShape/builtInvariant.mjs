import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {checkWriteShape} from './checkWriteShape.mjs';
import {checkReentrant} from './reentrant.mjs';

const root = process.env.DIST_ROOT;
if (!root) throw new Error('DIST_ROOT is required');
const api = await import(pathToFileURL(path.join(root, 'Carburetor/index.mjs')).href);
const {WriteLog} = await import(pathToFileURL(path.join(root, 'Carburetor/Store/Paths/WriteLog.mjs')).href);
for (const mode of ['success', 'failure', 'refresh-failure', 'rollback']) {
    console.log(JSON.stringify({mode, ...await checkWriteShape(api, WriteLog, mode)}));
    if (process.env.CHECK_OPTIMIZED === '1') {
        await checkWriteShape(api, WriteLog, mode, true);
    }
}
for (const mode of ['success', 'failure']) {
    for (const action of ['throw', 'delete', 'dictionary', 'replace']) {
        console.log(JSON.stringify(await checkReentrant(api, mode, action)));
    }
}
