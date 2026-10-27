import {AntiHookComponent} from '@react-carburetor/core';

class Vein extends AntiHookComponent {
    public render() {
        return <span>vein</span>;
    }
}

class Leaf extends AntiHookComponent {
    public render() {
        return <span>leaf</span>;
    }
}

class Twig extends AntiHookComponent {
    public render() {
        return <Leaf/>;
    }
}

class Branch extends AntiHookComponent {
    public render() {
        return <Twig/>;
    }
}

export class DeepTree extends AntiHookComponent {
    public render() {
        return (
            // #region doc
            <Branch>
                <Twig>
                    <Leaf/>
                    <Leaf>
                        <Vein/>
                    </Leaf>
                </Twig>
            </Branch>
            // #endregion doc
        );
    }
}
