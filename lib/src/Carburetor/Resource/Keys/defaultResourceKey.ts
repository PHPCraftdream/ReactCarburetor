import {TResourceArgs} from "@/Carburetor/Models/Resource";

/** The default key: single-argument resources keep today's key, longer lists JSON-encode. */
export const defaultResourceKey = (args: TResourceArgs): string => {
    // Trailing undefined arguments are optional parameters, not different answers.
    let end = args.length;
    while (end > 0 && args[end - 1] === undefined) end -= 1;
    if (end === 0) return JSON.stringify(null);
    if (end === 1) return JSON.stringify(args[0] === undefined ? null : args[0]);
    return JSON.stringify(args.slice(0, end));
};
