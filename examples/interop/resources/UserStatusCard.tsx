// #region status
import type {ReactElement} from 'react';
import {ResourceCache} from 'react-carburetor';
import {useResourceValue} from 'react-carburetor/interop';

interface User {
    id: number;
    name: string;
}

declare function fetchUser(id: number): Promise<User>;

const userCache = new ResourceCache<User, [number]>(async (id) => fetchUser(id));

const selectPending = (entry: {isPending: boolean}): boolean => entry.isPending;

function UserStatus({userId}: {userId: number}): ReactElement | null {
    const isPending = useResourceValue(userCache, [userId], selectPending);
    if (isPending) return <div className="spinner" />;
    return null;
}

const selectCard = (entry: {isPending: boolean; data?: User}) => ({isPending: entry.isPending, name: entry.data?.name});

function UserCard({userId}: {userId: number}): ReactElement {
    const view = useResourceValue(userCache, [userId], selectCard);
    if (view.isPending) return <div className="spinner" />;
    return <span>{view.name ?? 'unknown'}</span>;
}
// #endregion status
void UserCard;
void UserStatus;
