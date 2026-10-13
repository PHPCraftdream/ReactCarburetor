/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Task-only adaptation of selection44/timing: independent lanes; defects never terminate controls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {median} from '../../harness/lib.mjs';
const [m,l] = process.argv.slice(2).map(Number), root = process.env.DIST_ROOT;
const esm = `${root}/Carburetor/index.mjs`;
const api = fs.existsSync(esm)?await import(pathToFileURL(esm).href):createRequire(import.meta.url)(`${root}/Carburetor/index.js`);
class Store extends api.Carburetor {run(fn){this.update(fn);}}
const results=[], metrics={samples:7,uninstrumented:true,controlsCorrect:true};
function lane(prototype,shape,kind,diagnostic=false) {
    const name=prototype===null?'null':prototype===Array.prototype?'array':'object';
    const rows=[]; rows.length=shape==='dense'?m:l;
    const keys=Array.from({length:m},(_,i)=>String(shape==='dense'?i:i*Math.floor(l/m)));
    for(let i=0;i<m;i++) rows[keys[i]]={n:i};
    Object.setPrototypeOf(rows,prototype);
    const store=new Store({rows,spare:7}), events=[], unrelated=[], errors=[], times=[];
    const selector=kind==='scalar'?d=>d.rows[0].n:kind==='projection'?d=>({rows:d.rows}):d=>d.rows;
    const stop=store.watch(selector,(next,previous)=>events.push({next,previous}));
    const quiet=store.watch(d=>d.spare,next=>unrelated.push(next));
    const saved=console.error;
    let defect=null,checksum=0;
    try {
        // Console diagnostics are intercepted ONLY in the separate, untimed graph defect pass.
        if(diagnostic) console.error=(...args)=>{errors.push(args.map(String).join(' '));saved(...args);};
        const batches=diagnostic?1:9, batch=diagnostic?2:128;
        for(let s=0;s<batches;s++) {
            const start=diagnostic?null:performance.now();
            for(let i=0;i<batch;i++) store.run(d=>{d.rows[0].n=kind==='noop'?0:s*batch+i+1;});
            if(!diagnostic) {const elapsed=performance.now()-start;if(s>=2) times.push(elapsed);}
        }
        const total=batches*batch, final=kind==='noop'?0:total;
        const data=store.getData();
        assert.equal(data.spare,7);assert.equal(Object.getPrototypeOf(data.rows),prototype);
        assert.equal(data.rows.length,rows.length);assert.deepEqual(Object.keys(data.rows),keys);
        for(let i=0;i<m;i++) assert.equal(data.rows[keys[i]].n,i===0?final:i);
        assert.equal(unrelated.length,0);assert.equal(events.length,kind==='noop'?0:total);
        for(let j=0;j<events.length;j++) {
            const {next,previous}=events[j];
            if(kind==='scalar') {assert.equal(next,j+1);assert.equal(previous,j);checksum+=next;continue;}
            const after=kind==='projection'?next.rows:next, before=kind==='projection'?previous.rows:previous;
            for(const [value,n] of [[after,j+1],[before,j]]) {
                assert.equal(Object.getPrototypeOf(value),prototype);assert.equal(value.length,rows.length);
                assert.deepEqual(Object.keys(value),keys);
                for(let i=0;i<m;i++) assert.equal(value[keys[i]].n,i===0?n:i);
            }
            for(let i=1;i<m;i++) assert.equal(after[keys[i]],before[keys[i]]);
            if(j>0) assert.equal(before,kind==='projection'?events[j-1].next.rows:events[j-1].next);
            checksum+=after[0].n;
        }
        assert.equal(checksum,kind==='noop'?0:total*(total+1)/2);
        const count=events.length;
        store.run(d=>{d.rows[0].n=final;});assert.equal(events.length,count);
        assert.equal(errors.length,0);
    } catch(error) {
        if(error.code!=='ERR_ASSERTION') throw error;
        defect={code:error.code,operator:error.operator,message:error.message};
    } finally {console.error=saved;stop();quiet();}
    const correct=defect===null;
    const row={prototype:name,shape,lane:kind,diagnostic,correct,defect,diagnostics:errors,callbacks:events.length,checksum,rawSamples:times,ms:times.length?median(times):null,classification:correct?'whole-semantics-completed':'correctness defect; NOT a completed correct speedup'};
    results.push(row);
    if(!diagnostic && correct) metrics[`${name}_${shape}_${kind}Ms`]=row.ms;
    // Every timed lane, including null/object projection, is an independent required positive.
    // Only the explicitly untimed null/object graph diagnostics can be classified separately.
    if(!correct&&!diagnostic) metrics.controlsCorrect=false;
}
for(const prototype of [Array.prototype,null,Object.prototype]) for(const shape of ['dense','sparse']) {
    for(const kind of prototype===Array.prototype?['graph','projection','scalar','noop']:['projection','scalar','noop']) lane(prototype,shape,kind);
    if(prototype!==Array.prototype) lane(prototype,shape,'graph',true);
}
console.log('@@ '+JSON.stringify({...metrics,occupied:m,length:l,results,semanticFlags:results.map(({prototype,shape,lane,diagnostic,correct})=>({prototype,shape,lane,diagnostic,correct}))}));
if(!metrics.controlsCorrect) process.exitCode=1;
