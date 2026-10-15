import {computed} from 'react-carburetor';
import {activeCount} from './ActiveCount';

// #region summary
export const summary = computed<string>((read) => `${read(activeCount)} left`);
// #endregion summary
