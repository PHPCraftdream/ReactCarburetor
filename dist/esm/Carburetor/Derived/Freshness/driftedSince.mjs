const driftedSince = (record, current)=>{
    for (const cuid of Object.keys(record)){
        const recorded = record[cuid];
        if (recorded.source.getVersion() !== recorded.version) return true;
    }
    for (const cuid of Object.keys(current))if (!Object.prototype.hasOwnProperty.call(record, cuid)) return true;
    return false;
};
export { driftedSince };
