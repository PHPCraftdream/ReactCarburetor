// #region doc
import carburetor, {
    ICarburetorFlatConfig,
    ICarburetorPlugin,
    ICarburetorRule,
    TSeverity,
} from 'react-carburetor/lint';

const plugin: ICarburetorPlugin = carburetor;
const severity: TSeverity = 'error';
const configs: ICarburetorFlatConfig[] = [plugin.configs.recommended, plugin.configs['no-hooks']];
const describeRule = (rule: ICarburetorRule): string => rule.meta?.docs?.description ?? '';
const catalogue = Object.entries(plugin.rules).map(([id, rule]) => `${id}: ${describeRule(rule)}`);
// #endregion doc

void [severity, configs, catalogue];
export default plugin;
