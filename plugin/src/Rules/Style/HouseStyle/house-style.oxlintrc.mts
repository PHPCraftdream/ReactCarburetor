import {HOUSE_STYLE} from './houseStyle.mts';

/**
 * Generate an oxlint preset for the supplied plugin entry path.
 *
 * @param pluginPath - Plugin module path resolved relative to the generated config.
 */
export const generateHouseStyleOxlintJson = (pluginPath = './index.mjs'): string => {
    return `${JSON.stringify({jsPlugins: [pluginPath], rules: HOUSE_STYLE}, null, 2)}\n`;
};
