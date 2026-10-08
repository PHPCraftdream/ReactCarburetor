/** R39-05: bounded sparse probes avoid allocating dense own-key lists. */
export const probesSparse = (array: unknown[]): boolean => {
    const last = array.length - 1;
    for (let probe = 0; probe < 16; probe++) {
        const index = Math.floor(probe * last / 15);
        if (array[index] === undefined && !Object.prototype.hasOwnProperty.call(array, index)) return true;
    }
    return false;
};
