// #region diagnostics
import {Diagnostics, diagnostics} from 'react-carburetor';

// The shared instance the engine reports misuse through.
diagnostics.setEnabled(true);
diagnostics.report('a demonstration complaint'); // console.error: 'Carburetor: ...'

// Or run an isolated channel of your own, e.g. for a test harness.
const quiet = new Diagnostics();
quiet.setEnabled(false);
quiet.report('never printed');
// #endregion diagnostics
