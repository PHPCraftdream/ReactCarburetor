const getComputedSnapshotVersion = (source)=>'getSnapshotVersion' in source && 'function' == typeof source.getSnapshotVersion ? source.getSnapshotVersion() : source.getVersion();
export { getComputedSnapshotVersion };
