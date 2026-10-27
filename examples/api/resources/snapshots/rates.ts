// #region rates
import {IResourceSnapshot, ResourceCarburetor} from '@react-carburetor/core';

interface Currency {
    code: string;
    rate: number;
}

declare function fetchRate(code: string): Promise<Currency>;

const rateResource = new ResourceCarburetor<Currency, [string]>((code: string) => fetchRate(code));

export function exportRates(): Array<{id: string; snapshot: IResourceSnapshot<Currency>}> {
    void rateResource.load('EUR');
    return [{id: 'rates', snapshot: rateResource.snapshot()}];
}

export function importRates(payload: IResourceSnapshot<Currency>): void {
    rateResource.restore(payload);
}
// #endregion rates
void importRates;
