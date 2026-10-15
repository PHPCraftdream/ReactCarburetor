// #region doc
import * as React from 'react';
import {createPortal} from 'react-dom';
import {
    carburetorToken,
    CarburetorContext,
    CarburetorScope,
    ScopedAntiHookComponent,
} from 'react-carburetor';

const statusToken = carburetorToken(
    () => ({message: 'ready'}),
    'examples-portal-status',
);

class StatusBar extends ScopedAntiHookComponent {
    public render() {
        return <span>{this.resolve(statusToken).message}</span>;
    }
}

interface IPortalPanelProps {
    scope: CarburetorScope;
    container: HTMLElement;
}

class PortalPanel extends React.Component<IPortalPanelProps> {
    public render() {
        return createPortal(
            <CarburetorContext.Provider value={this.props.scope}>
                <StatusBar/>
            </CarburetorContext.Provider>,
            this.props.container,
        );
    }
}
// #endregion doc

void PortalPanel;
