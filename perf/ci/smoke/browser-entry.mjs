/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Carburetor, AntiHookComponent} from '../../../dist/esm-prod/Carburetor/index.mjs';
import {useCarburetorValue} from '../../../dist/esm-prod/Interop/index.mjs';

const h = React.createElement;
const selectRows = data => data.rows;
const selectScalar = data => data.rows[0].n;
const errors = [];
window.addEventListener('error', event => errors.push(String(event.error ?? event.message)));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
class Store extends Carburetor {edit() {this.update(data => {data.rows[0].n++;});}}
function GraphHook({store, id}) {return h('output', {id}, useCarburetorValue(store, selectRows)[0].n);}
function ScalarHook({store, id}) {return h('output', {id}, useCarburetorValue(store, selectScalar));}
class GraphClass extends AntiHookComponent {
    constructor(props) {super(props); this.pick = this.connectSelection(props.store, selectRows);}
    render() {return h('output', {id: this.props.id}, this.pick()[0].n);}
}
class RawClass extends AntiHookComponent {
    render() {return h('output', {id: this.props.id}, this.useCarburetor(this.props.store).rows[0].n);}
}
const kinds = ['array', 'null', 'object'];
const lanes = kinds.map(kind => {
    const rows = [{n: 0}];
    Object.setPrototypeOf(rows, kind === 'array' ? Array.prototype : kind === 'null' ? null : Object.prototype);
    const store = new Store({rows});
    const lane = {kind, store, deliveries: 0};
    lane.stop = store.watch(selectRows, () => {lane.deliveries++;});
    return lane;
});
const root = createRoot(document.getElementById('app'));
flushSync(() => root.render(h('main', null, ...lanes.map(lane => h('section', {key: lane.kind},
    h('h2', null, lane.kind), h('button', {id: 'edit-' + lane.kind, onClick: () => flushSync(() => lane.store.edit())}, 'Edit'),
    h(GraphHook, {store: lane.store, id: lane.kind + '-graph-hook'}),
    h(ScalarHook, {store: lane.store, id: lane.kind + '-scalar-hook'}),
    h(GraphClass, {store: lane.store, id: lane.kind + '-graph-class'}),
    h(RawClass, {store: lane.store, id: lane.kind + '-raw-class'}))))));
requestAnimationFrame(() => {
    try {
        for (const lane of lanes) document.getElementById('edit-' + lane.kind).click();
        const proof = lanes.map(lane => ({prototype: lane.kind, source: lane.store.getData().rows[0].n,
            deliveries: lane.deliveries, outputs: ['graph-hook', 'scalar-hook', 'graph-class', 'raw-class']
                .map(kind => document.getElementById(lane.kind + '-' + kind).textContent)}));
        if (errors.length || proof.some(lane => lane.source !== 1 || lane.deliveries !== 1
            || lane.outputs.some(value => value !== '1'))) throw new Error(JSON.stringify({proof, errors}));
        document.body.dataset.smoke = 'passed';
        const data = document.createElement('pre'); data.id = 'smoke-proof';
        data.textContent = JSON.stringify({proof, errors}); document.body.appendChild(data);
    } catch (error) {document.body.dataset.smoke = 'failed'; document.body.append(String(error));}
});
