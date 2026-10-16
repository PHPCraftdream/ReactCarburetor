// #region failure
import {IResourceView, ResourceCache} from 'react-carburetor';

interface Report {
    rows: string[];
}

declare function fetchReport(period: string): Promise<Report>;

const reportCache = new ResourceCache<Report, [string]>((period: string) => fetchReport(period));

export const describeReportFailure = (period: string): string => {
    const view: IResourceView<Report> = reportCache.getEntry(period);
    if (!view.isError || !view.failed) {
        return 'no failure';
    }
    const failure: unknown = reportCache.getFailure(period);
    return failure instanceof Error ? failure.message : String(failure);
};
// #endregion failure
