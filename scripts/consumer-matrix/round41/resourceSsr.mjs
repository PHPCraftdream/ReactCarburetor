import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import React from 'react';
import {renderToString} from 'react-dom/server';

const require = createRequire(resolve(process.cwd(), 'package.json'));
const {ResourceCache} = require('./dist/cjs/Carburetor/index.js');
const {useResourceValue} = require('./dist/cjs/Interop/index.js');
const mode = process.argv[2];
const calls = [];
let subscriptions = 0;
const cache = new ResourceCache(async args => {
    calls.push(args.id);
    return {id: args.id, name: 'server'};
}, {ttl: Infinity});
const subscribe = cache.subscribe;
cache.subscribe = (...args) => {
    subscriptions++;
    return subscribe.apply(cache, args);
};
if (mode !== 'missing') {
    await cache.load({id: 0});
    if (mode === 'invalidated') cache.invalidate({id: 0});
}
const Reader = () => React.createElement('span', null,
    useResourceValue(cache, {id: 0}, view => view.data?.name) ?? '…');
const markup = renderToString(React.createElement(Reader));
console.log(JSON.stringify({markup, data: cache.getData(), calls, subscriptions}));
