import {Carburetor, computed} from '@react-carburetor/core';

class SettingsCarburetor extends Carburetor<{theme: string}> {}

const settings = new SettingsCarburetor({theme: 'light'});
const theme = computed((read) => read(settings).theme);

console.log(theme.get()); // 'light'
settings.setData({theme: 'dark'});
console.log(theme.get()); // 'dark'
