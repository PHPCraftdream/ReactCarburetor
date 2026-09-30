import {TPath} from "@/Carburetor/Models/Paths";

/** Refuse symbol-keyed writes: state is string-keyed data only (R6-02/R6-03). */
export const forbidSymbolKey = (path: TPath): never => {
    throw new Error(
        'Carburetor: "' + (path || 'the root') + '" cannot take a symbol-keyed write — state is ' +
        'string-keyed data only. Use a string key.'
    );
};
