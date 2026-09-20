import {describeChainRoot} from "#src/Utils/Ast/describeChainRoot.mts";
import {findEnclosingClassExtending} from "#src/Utils/Ast/Find/findEnclosingClassExtending.mts";
import {findEnclosingClassMember} from "#src/Utils/Ast/Find/findEnclosingClassMember.mts";
import {getMemberCallName} from "#src/Utils/Ast/getMemberCallName.mts";
import {getPropertyKeyName} from "#src/Utils/Ast/getPropertyKeyName.mts";
import {visitMutations} from "#src/Utils/Ast/visitMutations.mts";
import {ruleOptions} from "#src/Utils/Carburetor/ruleOptions.mts";
import type {
    IAstNode,
    ICallExpressionNode,
    IClassMemberNode,
    IRule,
    IRuleContext,
    TRuleVisitor,
} from "#src/Models.mts";

interface IOptions {
    deferredEmitMethods?: readonly string[];
}

const EMIT_METHODS: readonly string[] = ['emitUpdate', 'emitSoon', 'emitByKey'];

/**
 * Methods that run while an update is already being published.
 *
 * `preEmit` is called by `emitUpdate` itself, right before subscribers are notified — deriving
 * state there is what it is for, and calling `emitUpdate()` inside it would recurse. Whatever
 * `preEmit` delegates to is in the same position, which is why the exemption follows `this.x()`
 * calls outward from these roots.
 */
const PUBLISHING_CONTEXT: readonly string[] = ['preEmit'];

/** A method identity that survives being visited twice: its source range. */
const identify = (member: IAstNode): string => `${member.start}:${member.end}`;

/** Whether the write is inside a `this.update(...)` callback, which publishes on return. */
const isInsideUpdateCall = (node: IAstNode): boolean => {
    let current: IAstNode | null | undefined = node.parent;

    while (current) {
        if (current.type === 'CallExpression' && getMemberCallName(current) === 'update') {
            return true;
        }

        current = current.parent;
    }

    return false;
};

/**
 * Reports a method that writes through `draft` and never publishes.
 *
 * The data changes and nobody is notified, so the interface keeps showing the previous value until
 * some unrelated write happens to wake the same subscribers. Development reports this at runtime,
 * but only for code paths that actually executed; the rule sees the ones that did not.
 *
 * A method that deliberately leaves publishing to its caller is named in `deferredEmitMethods`.
 *
 * See docs/hazards.md, H6.
 */
export const requireEmitAfterDraftWrite: IRule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Publish a draft write, ideally through update(draft => ...).',
        },
        schema: ruleOptions.schema({
            deferredEmitMethods: {
                type: 'array',
                items: {type: 'string'},
            },
        }),
    },

    create(context: IRuleContext): TRuleVisitor {
        const {carburetorBases} = ruleOptions.read(context);
        const deferred: readonly string[] = (context.options[0] as IOptions)?.deferredEmitMethods || [];

        /** Method identity -> the first unpublished write in it, and the method's name. */
        const writes = new Map<string, {node: IAstNode; member: string | undefined}>();
        const publishes = new Set<string>();

        /** Method name -> the methods of the same class it calls, for spreading the exemption. */
        const callsFrom = new Map<string, Set<string>>();

        /** The names that never have to publish, following calls out of a publishing context. */
        const collectExempt = (): Set<string> => {
            const exempt = new Set<string>([...PUBLISHING_CONTEXT, ...deferred]);
            const queue: string[] = [...exempt];

            while (queue.length > 0) {
                const name = queue.shift() as string;
                const called = callsFrom.get(name);

                if (!called) {
                    continue;
                }

                called.forEach((callee: string): void => {
                    if (exempt.has(callee)) {
                        return;
                    }

                    exempt.add(callee);
                    queue.push(callee);
                });
            }

            return exempt;
        };

        const mutations = visitMutations((target: IAstNode, node: IAstNode): void => {
            const {base, baseProperty} = describeChainRoot(target);

            if (base.type !== 'ThisExpression' || baseProperty !== 'draft') {
                return;
            }

            if (!findEnclosingClassExtending(node, carburetorBases) || isInsideUpdateCall(node)) {
                return;
            }

            const member = findEnclosingClassMember(node);

            if (!member) {
                return;
            }

            const key = identify(member);

            if (!writes.has(key)) {
                writes.set(key, {node, member: getPropertyKeyName((member as IClassMemberNode).key)});
            }
        });

        return {
            ...mutations,

            CallExpression(node: IAstNode): void {
                // An in-place array method is a write; the shared visitor decides that.
                if (mutations.CallExpression) {
                    mutations.CallExpression(node);
                }

                const method = getMemberCallName(node);

                if (!method) {
                    return;
                }

                const callee = (node as ICallExpressionNode).callee;
                const receiver = (callee as unknown as {object: IAstNode}).object;

                if (receiver.type !== 'ThisExpression') {
                    return;
                }

                const member = findEnclosingClassMember(node);

                if (!member) {
                    return;
                }

                if (EMIT_METHODS.includes(method)) {
                    publishes.add(identify(member));

                    return;
                }

                // `this.x()` — remember the edge so an exemption can travel along it.
                const caller = getPropertyKeyName((member as IClassMemberNode).key);

                if (!caller) {
                    return;
                }

                const called = callsFrom.get(caller) || new Set<string>();

                called.add(method);
                callsFrom.set(caller, called);
            },

            'Program:exit'(): void {
                const exempt = collectExempt();

                writes.forEach((write: {node: IAstNode; member: string | undefined}, key: string): void => {
                    if (publishes.has(key) || (write.member && exempt.has(write.member))) {
                        return;
                    }

                    context.report({
                        node: write.node,
                        message: 'this writes through draft but never publishes: the data changes '
                            + 'while nobody is notified, so the interface keeps showing the previous '
                            + 'value. Use this.update(draft => ...), which mutates and publishes in '
                            + 'one step, or call this.emitUpdate() before returning.',
                    });
                });
            },
        };
    },
};
