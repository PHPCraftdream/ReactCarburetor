// #region invalidate
import {AntiHookComponent, bind, ResourceCache} from 'react-carburetor';
import {Component, type JSX} from 'react';

interface Settings {
    displayName: string;
}

declare function fetchSettings(userId: string): Promise<Settings>;
declare function saveSettings(userId: string, next: Settings): Promise<void>;

const settingsCache = new ResourceCache<Settings, string>((userId: string) => fetchSettings(userId));

export class SettingsPanel extends AntiHookComponent<{userId: string}> {
    @bind
    private rename(nextName: string): void {
        void saveSettings(this.props.userId, {displayName: nextName}).then(this.invalidateSettings);
    }

    @bind
    private invalidateSettings(): void {
        settingsCache.invalidate(this.props.userId);
    }

    @bind
    private reloadEverything(): void {
        settingsCache.invalidateAll();
    }

    render(): JSX.Element {
        return (
            <div>
                <RenameForm onRename={this.rename} />
                <button type="button" onClick={this.reloadEverything}>Refresh all</button>
            </div>
        );
    }
}

class RenameForm extends Component<{onRename: (name: string) => void}> {
    render(): JSX.Element {
        return <span className="rename-form" data-name={this.props.onRename.name} />;
    }
}
// #endregion invalidate
