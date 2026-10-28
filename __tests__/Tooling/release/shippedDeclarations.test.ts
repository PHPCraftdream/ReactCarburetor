import {readFileSync} from 'node:fs';
import path from 'node:path';

const read = (file: string): string => readFileSync(path.join(process.cwd(), 'dist', file), 'utf8');

describe('the shipped declarations', () => {
    // createTestScope returns a type keyed by Symbol.dispose; without the preserved reference a
    // consumer whose lib stops short of ESNext gets TS2550 in our declaration file.
    test.each(['esm/Testing/createTestScope.d.mts', 'cjs/Testing/createTestScope.d.ts'])(
        '%s keeps the lib reference Symbol.dispose needs', file => {
            expect(read(file)).toMatch(/^\/\/\/ <reference lib="esnext\.disposable"/m);
        },
    );
});
