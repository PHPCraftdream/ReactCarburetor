import * as api from '@/Carburetor';
import {WriteLog} from '@/Carburetor/Store/Paths/WriteLog';
import {checkWriteShape} from './checkWriteShape.mjs';
import {checkReentrant} from './reentrant.mjs';

describe('R40-05 cache publication write shape', () => {
    test.each(['success', 'failure'])('%s preserves reentrant baseline behavior', async mode => {
        for (const action of ['replace', 'dictionary', 'delete', 'throw']) await checkReentrant(api, mode, action);
    });
    test.each(['success', 'failure', 'refresh-failure', 'rollback'])(
        '%s preserves ordered paths and history patches', async mode => {
            await checkWriteShape(api, WriteLog, mode);
        }
    );
    test.each(['success', 'failure', 'refresh-failure', 'rollback'])(
        '%s takes the draft entry once', async mode => {
            await checkWriteShape(api, WriteLog, mode, true);
        }
    );
});
