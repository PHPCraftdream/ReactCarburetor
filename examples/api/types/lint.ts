import carburetor, {ICarburetorFlatConfig, ICarburetorPlugin, ICarburetorRule, TSeverity} from 'react-carburetor/lint';

const plugin: ICarburetorPlugin = carburetor;
const severity: TSeverity = 'error';
const config: ICarburetorFlatConfig = plugin.configs.recommended;
const rule: ICarburetorRule | undefined = plugin.rules['no-get-data-in-render'];
void [severity, config, rule];
export default plugin;
