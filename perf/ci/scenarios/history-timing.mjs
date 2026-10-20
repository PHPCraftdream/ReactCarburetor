/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
// Isolated stronger endpoint assertions; permanent history44 gates/scenarios are untouched.
import assert from 'node:assert/strict';
import {opaqueFixture,scalarFixture} from '../../scenarios/history44/fixture.mjs';
import gates from '../../gates/history44.mjs';
import {median} from '../../harness/lib.mjs';
const args=process.argv.slice(2);
const entry=gates.find(e=>e.scenario==='history44/timing'&&JSON.stringify(e.args.map(String))===JSON.stringify(args));
if (!entry) throw new Error('Expected a registered history44 timing argument tuple');
const [family,ns,ks,ps,mode]=args, n=Number(ns),k=Number(ks),padding=Number(ps);
const updates=[],undos=[],redos=[],checksums=[];
function expected(stage) {
    if(family==='opaque') return {
        stamp:mode!=='plain'&&mode!=='noop'&&stage!=='before'?new Date(1000):null,
        slot:mode!=='noop'&&stage!=='before'?{rows:Array.from({length:n},(_,i)=>({n:k+i}))}:null,
        keep:7,padding:Array.from({length:padding},(_,value)=>({value}))};
    let box=mode==='distinct'?Object.fromEntries(Array.from({length:n},(_,i)=>['n'+i,stage==='before'?0:i+1])):{n:stage==='before'?0:stage==='undo'&&mode==='separate'?n-1:n};
    for(let i=1;i<k;i++) box={child:box};
    return {box,spare:7,stamp:null};
}
function checksum(data) {
    if(family==='opaque') return (data.stamp?.getTime()??0)+(data.slot?.rows.reduce((sum,row)=>sum+row.n,0)??0)+data.keep+data.padding.reduce((sum,row)=>sum+row.value,0);
    let leaf=data.box;for(let i=1;i<k;i++) leaf=leaf.child;
    return Object.values(leaf).reduce((sum,value)=>sum+value,0)+data.spare;
}
for(let i=0;i<10;i++) {
    const fixture=family==='opaque'?opaqueFixture(n,k,padding,mode):scalarFixture(n,k,mode);
    const {store,history,write}=fixture;
    let wakes=0;const id=store.subscribe(()=>wakes++);
    const verify=stage=>{const want=expected(stage);assert.deepEqual(store.getData(),want);assert.equal(checksum(store.getData()),checksum(want));return checksum(want);};
    try {
        const before=verify('before');assert.equal(history.canUndo(),false);assert.equal(history.canRedo(),false);
        let start=performance.now();write();const update=performance.now()-start;
        const after=verify('after');assert.equal(wakes,mode==='noop'?0:mode==='separate'?n:1);
        assert.equal(history.canUndo(),mode!=='noop');assert.equal(history.canRedo(),false);
        start=performance.now();const undone=history.undo();const undo=performance.now()-start;
        assert.equal(undone,mode!=='noop');
        const undoChecksum=verify(family==='scalar'&&mode==='separate'?'undo':'before');
        assert.equal(history.canRedo(),mode!=='noop');
        assert.equal(history.canUndo(),family==='scalar'&&mode==='separate'&&n>1);
        start=performance.now();const redone=history.redo();const redo=performance.now()-start;
        assert.equal(redone,mode!=='noop');const redoChecksum=verify('after');
        assert.equal(history.canRedo(),false);assert.equal(history.canUndo(),mode!=='noop');
        assert.equal(wakes,mode==='noop'?0:(mode==='separate'?n:1)+2);
        checksums.push({before,after,undo:undoChecksum,redo:redoChecksum,wakes});
        if(i>=3){updates.push(update);undos.push(undo);redos.push(redo);}
    } finally {store.unsubscribe(id);history.disconnect();}
}
assert.equal(updates.length, 7);assert.equal(undos.length, 7);assert.equal(redos.length, 7);
console.log('@@ '+JSON.stringify({family,n,k,padding,mode,samples:updates.length,updateMs:median(updates),undoMs:median(undos),redoMs:median(redos),rawSamples:{updates,undos,redos},checksums,wholeEndpointsCorrect:true,publicationCorrect:true,uninstrumented:true,completedOperations:true}));
