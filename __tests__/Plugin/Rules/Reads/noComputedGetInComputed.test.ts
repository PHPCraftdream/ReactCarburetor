import {RuleTester} from "oxlint/plugins-dev";
import {noComputedGetInComputed} from "@plugin/Rules/Reads/noComputedGetInComputed.mts";

const rule = noComputedGetInComputed as unknown as Parameters<RuleTester['run']>[1];
const tester = new RuleTester({languageOptions: {parserOptions: {lang: 'ts'}}});

tester.run('no-computed-get-in-computed', rule, {
    valid: [
        {
            name: 'reading sources through the reader',
            code: `export const total = computed(read => read(orders).count + read(visibleCount));`,
        },
        {
            name: 'a keyed get inside a computed body is somebody else\'s get',
            code: `export const label = computed(read => titles.get(read(current).id));`,
        },
        {
            name: 'reading the reader itself under another name',
            code: `export const total = computed(pull => pull(orders).count);`,
        },
        {
            name: 'get outside any computed is a different rule\'s business',
            code: `export const dump = () => visibleCount.get();`,
        },
        {
            name: 'a date method that merely starts with get',
            code: `export const age = computed(read => Date.now() - read(order).when.getTime());`,
        },
    ],
    invalid: [
        {
            name: 'a computed reading another computed with get',
            code: `export const total = computed(() => visibleCount.get() * 2);`,
            errors: [{message: /first value forever/}],
        },
        {
            name: 'a computed reading a store with getData',
            code: `export const total = computed(() => orders.getData().count);`,
            errors: 1,
        },
        {
            name: 'a reader is available but a source is read directly anyway',
            code: `export const total = computed(read => read(orders).count + visibleCount.get());`,
            errors: 1,
        },
        {
            name: 'the inner computed of a nested pair',
            code: `export const total = computed(read => read(computed(() => visibleCount.get())));`,
            errors: 1,
        },
        {
            name: 'every direct read is reported, not just the first',
            code: `export const total = computed(() => visibleCount.get() + orders.getData().count);`,
            errors: 2,
        },
    ],
});
