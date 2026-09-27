import {Carburetor} from "@/Carburetor";
import {ETodoFilter} from "@/ToDo/Models/Enums/ETodoFilter";
import {IFilterData} from "./Models";

/** The list's view settings: small, user-owned, worth persisting between visits. */
export class FilterCarburetor extends Carburetor<IFilterData> {
    /**
     * Starts on the given filter.
     *
     * @param filter - the filter shown before the user picks one
     */
    constructor(filter: ETodoFilter = ETodoFilter.All) {
        super({filter});
    }

    /**
     * Switches which todos the list shows.
     *
     * @param filter - the filter to show from now on
     */
    public setFilter = (filter: ETodoFilter): void => {
        if (this.data.filter === filter) {
            return;
        }

        this.update((draft: IFilterData) => {
            draft.filter = filter;
        });
    };
}
