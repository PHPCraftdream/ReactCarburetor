import {findEnclosingClassExtending} from "#src/Utils/Ast/Find/findEnclosingClassExtending.mts";
import {findEnclosingClassMember} from "#src/Utils/Ast/Find/findEnclosingClassMember.mts";
import {getPropertyKeyName} from "#src/Utils/Ast/getPropertyKeyName.mts";
import {ruleOptions} from "#src/Utils/Carburetor/ruleOptions.mts";
import type {
    IAssignmentExpressionNode,
    IAstNode,
    ICallExpressionNode,
    IClassMemberNode,
    IIdentifierNode,
    IMemberExpressionNode,
    IRule,
    IRuleContext,
    TRuleVisitor,
} from "#src/Models.mts";

interface IDecoratedNode extends IAstNode {
    decorators?: readonly IAstNode[];
}

interface IMethodRecord {
    bound: boolean;
    usesThis: boolean;
}

const identify = (node: IAstNode): string => `${node.start}:${node.end}`;

/** Whether the member carries `@bind`. */
const isBound = (member: IAstNode): boolean => {
    const decorators: readonly IAstNode[] = (member as IDecoratedNode).decorators || [];

    return decorators.some((decorator: IAstNode): boolean => {
        const expression: IAstNode = (decorator as unknown as {expression: IAstNode}).expression;

        return expression.type === 'Identifier' && (expression as IIdentifierNode).name === 'bind';
    });
};

/** Whether `this.x` is being used as a value rather than called or assigned. */
const isPassedAsValue = (node: IAstNode): boolean => {
    const parent: IAstNode | null | undefined = node.parent;

    if (!parent) {
        return false;
    }

    // `this.x()` keeps its receiver; only handing the function over loses it.
    if (parent.type === 'CallExpression') {
        const callee: IAstNode = (parent as ICallExpressionNode).callee;

        if (callee.start === node.start && callee.end === node.end) {
            return false;
        }
    }

    // `this.x = ...` declares it, and `this.x.y` reaches through it.
    if (parent.type === 'AssignmentExpression') {
        const target: IAstNode = (parent as IAssignmentExpressionNode).left;

        if (target.start === node.start && target.end === node.end) {
            return false;
        }
    }

    return parent.type !== 'MemberExpression';
};

/**
 * Reports a method of a component passed around without `@bind`.
 *
 * A prototype method handed over as a value loses its receiver, so `this` is undefined when the
 * handler fires. That throws rather than failing silently — but only once someone clicks, and the
 * two fixes people reach for, `.bind(this)` in render and an inline arrow, defeat the props gate
 * instead (H21). So the rule points at `@bind`, which binds once per instance and keeps the method
 * on the prototype.
 *
 * This replaces `typescript/unbound-method`, which cannot see the decorator and therefore reports
 * correct `@bind` usage as an error.
 *
 * See docs/hazards.md, H22.
 */
export const requireBindForPassedMethod: IRule = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Bind a component method with @bind before passing it as a value.',
        },
        schema: ruleOptions.schema(),
    },

    create(context: IRuleContext): TRuleVisitor {
        const {componentBases} = ruleOptions.read(context);

        /** `<class>:<member name>` -> what we know about it. */
        const methods = new Map<string, IMethodRecord>();
        const references: {node: IAstNode; key: string; name: string}[] = [];

        const keyOf = (classNode: IAstNode, name: string): string => `${identify(classNode)}:${name}`;

        return {
            MethodDefinition(node: IAstNode): void {
                const name = getPropertyKeyName((node as IClassMemberNode).key);
                const classNode = findEnclosingClassExtending(node, componentBases);

                if (!name || !classNode) {
                    return;
                }

                const key = keyOf(classNode, name);
                const known = methods.get(key);

                methods.set(key, {bound: isBound(node), usesThis: Boolean(known && known.usesThis)});
            },

            ThisExpression(node: IAstNode): void {
                const member = findEnclosingClassMember(node);

                if (!member || member.type !== 'MethodDefinition') {
                    return;
                }

                const name = getPropertyKeyName((member as IClassMemberNode).key);
                const classNode = findEnclosingClassExtending(member, componentBases);

                if (!name || !classNode) {
                    return;
                }

                const key = keyOf(classNode, name);
                const known = methods.get(key);

                methods.set(key, {bound: Boolean(known && known.bound), usesThis: true});
            },

            MemberExpression(node: IAstNode): void {
                const member = node as IMemberExpressionNode;

                if (member.object.type !== 'ThisExpression' || member.property.type !== 'Identifier') {
                    return;
                }

                if (!isPassedAsValue(node)) {
                    return;
                }

                const classNode = findEnclosingClassExtending(node, componentBases);

                if (!classNode) {
                    return;
                }

                const name = (member.property as IIdentifierNode).name;

                references.push({node, key: keyOf(classNode, name), name});
            },

            'Program:exit'(): void {
                references.forEach((reference: {node: IAstNode; key: string; name: string}): void => {
                    const method = methods.get(reference.key);

                    // Not a method of this class, already bound, or it never touches `this`.
                    if (!method || method.bound || !method.usesThis) {
                        return;
                    }

                    context.report({
                        node: reference.node,
                        message: `this.${reference.name} is a prototype method passed as a value, so `
                            + '`this` will be undefined when it runs. Decorate it with @bind, which '
                            + 'binds once per instance — binding here instead would build a new '
                            + 'function every render and defeat the props gate.',
                    });
                });
            },
        };
    },
};
