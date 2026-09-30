import * as React from "react";
import {AntiHookComponent} from "@/Carburetor";
import {ITodoStats} from "./Models";

interface IStatsSummaryProps {
    stats: ITodoStats;
}

/**
 * One counter pill.
 *
 * @param label - caption before the count
 * @param value - the count
 * @param tone - color classes
 * @param testId - test selector
 */
function renderCounter(label: string, value: number, tone: string, testId: string) {
    return (
        <span className={'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ' + tone}>
            {label}
            <span className="tabular-nums" data-testid={testId}>{value}</span>
        </span>
    );
}

/**
 * Reads no store: it gets a `connectSelection()` snapshot from its parent, whose identity
 * changes only when the counters do — so the props gate skips it on every other parent render.
 */
export class StatsSummary extends AntiHookComponent<IStatsSummaryProps> {
    /** Demo instrumentation: how often the gate let this component through. */
    protected renders: number = 0;

    /** Draws the two counters from the snapshot. */
    public render() {
        const {stats} = this.props;

        this.renders++;

        return (
            <div className="flex items-center gap-2">
                {renderCounter(
                    'active:',
                    stats.active,
                    'bg-sky-100 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300',
                    'active-count'
                )}
                {renderCounter(
                    'done:',
                    stats.done,
                    'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300',
                    'done-count'
                )}
                <span className="font-mono text-[10px] text-slate-300 dark:text-slate-600" data-testid="stats-renders">
                    {this.renders}
                </span>
            </div>
        );
    }
}
