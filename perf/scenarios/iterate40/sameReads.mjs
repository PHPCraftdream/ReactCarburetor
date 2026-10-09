/**
 * Compares path sets without depending on their insertion order.
 *
 * @param reads - Recorded paths.
 * @param expected - Expected paths.
 */
export const sameReads = (reads, expected) => {
    const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
    return JSON.stringify([...reads].sort(compare)) === JSON.stringify([...expected].sort(compare));
};
