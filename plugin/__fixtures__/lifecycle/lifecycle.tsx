import {AntiHookComponent} from "@react-carburetor/core";
import {store} from "./sources";

/**
 * Fixture for the end-to-end host check: every rule in the lifecycle group must fire exactly once
 * here. This file is linted by a test, not by `npm run lint`.
 */
export class Row extends AntiHookComponent<{id: string}> {
    // no-lifecycle-class-property
    public componentDidUpdate = (): void => {
        this.sync();
    };

    // require-super-in-lifecycle
    public componentDidMount(): void {
        this.sync();
    }

    // require-bind-for-passed-method
    protected onToggle(): void {
        store.toggle(this.props.id);
    }

    protected sync(): void {
        store.getData(this.props.id);
    }

    public render() {
        const data = this.useCarburetor(store);

        return <div>
            <button onClick={this.onToggle}>toggle</button>
            {/* no-handler-created-in-render */}
            <TodoRow onDelete={() => store.deleteTodo(this.props.id)} title={data.title}/>
            {/* max-render-depth: the fourth component level in this render */}
            <Branch><Twig><Leaf><Needle/></Leaf></Twig></Branch>
        </div>;
    }
}

// max-render-lines: 33 lines of code in one render
export class LongList extends AntiHookComponent {
    public render() {
        return <ul>
            <li>0</li>
            <li>1</li>
            <li>2</li>
            <li>3</li>
            <li>4</li>
            <li>5</li>
            <li>6</li>
            <li>7</li>
            <li>8</li>
            <li>9</li>
            <li>10</li>
            <li>11</li>
            <li>12</li>
            <li>13</li>
            <li>14</li>
            <li>15</li>
            <li>16</li>
            <li>17</li>
            <li>18</li>
            <li>19</li>
            <li>20</li>
            <li>21</li>
            <li>22</li>
            <li>23</li>
            <li>24</li>
            <li>25</li>
            <li>26</li>
            <li>27</li>
            <li>28</li>
            <li>29</li>
            <li>30</li>
        </ul>;
    }
}

// no-unrecognized-base: a project base imported from another file and not listed in componentBases
import {AppComponent} from "./app-component";

class Panel extends AppComponent {
    public render() {
        return this.useCarburetor(store).title;
    }
}

void Panel;
