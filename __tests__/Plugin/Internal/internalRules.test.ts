// oxlint's RuleTester reserves a ~6 GB ArrayBuffer once per process. rstest runs every test file
// in its own worker, so one file per rule multiplied that reservation until allocation failed
// under memory pressure. The rule suites stay in their own modules and register here, in one
// worker, sharing one buffer.
import {registerMaxLineLengthCases} from "./maxLineLength.cases";
import {registerNoBlankLineAfterTsdocCases} from "./noBlankLineAfterTsdoc.cases";
import {registerNoParentImportCases} from "./noParentImport.cases";
import {registerRequireTsdocCases} from "./requireTsdoc.cases";
import {registerTsdocBlankLineBeforeTagsCases} from "./tsdocBlankLineBeforeTags.cases";

registerMaxLineLengthCases();
registerNoBlankLineAfterTsdocCases();
registerNoParentImportCases();
registerRequireTsdocCases();
registerTsdocBlankLineBeforeTagsCases();
