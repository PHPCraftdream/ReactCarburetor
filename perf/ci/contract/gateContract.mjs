/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
/** Classifies a gate file hash against the frozen baseline and its registered amendment. */
export const gateContractStatus = (file, expected, actual, amendment) => {
    if (actual === expected) return {file, amended: false};
    if (amendment && actual === amendment) return {file, amended: true};
    return {file, error: amendment ? 'Amendment hash mismatch: ' + file : 'Gate contract changed without amendment: ' + file};
};
