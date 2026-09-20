import {Carburetor, transaction} from "react-carburetor";
import {api, reads} from "./sources";

/**
 * Fixture for the end-to-end host check: every rule in the boundaries group must fire exactly once
 * here. This file is linted by a test, not by `npm run lint`.
 */

// no-untrackable-store-data
interface IProfileData {
    name: string;
    seen: Set<string>;
}

export class ProfileCarburetor extends Carburetor<IProfileData> {
    public rename = (name: string) => {
        this.update(draft => {
            draft.name = name;
        });
    };
}

// no-module-level-store
export const profileCarburetor = new ProfileCarburetor({name: '', seen: new Set()});

// no-async-transaction
export const save = async (name: string): Promise<void> => {
    await transaction(async () => {
        await api.save(name);

        profileCarburetor.rename(name);
    });
};

// require-subscription-disposal
profileCarburetor.subscribe(() => api.log(profileCarburetor.getData().name), {reads});
