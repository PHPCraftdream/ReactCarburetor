import {Carburetor, ComponentUpdateThrottle} from 'react-carburetor';

interface IPresence {online: string[]}

class PresenceCarburetor extends Carburetor<IPresence> {}

const initial: IPresence = {online: []};

// #region presence
// A socket pushing hundreds of messages per second: collapse them into ~25 renders/sec.
export const presenceCarburetor = new PresenceCarburetor(initial, new ComponentUpdateThrottle(40));
// #endregion presence
