const isViewCurrent = (view, entry, stale)=>view.stale === stale && view.status === entry.status && Object.is(view.data, entry.data) && view.error === entry.error && view.updatedAt === entry.updatedAt && view.refreshing === entry.refreshing && view.invalidated === entry.invalidated && view.failed === entry.failed;
export { isViewCurrent };
