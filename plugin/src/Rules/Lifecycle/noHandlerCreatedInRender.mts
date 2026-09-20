import {getMemberCallName} from "#src/Utils/Ast/getMemberCallName.mts";
import {isInsideRender} from "#src/Utils/Carburetor/isInsideRender.mts";
import {ruleOptions} from "#src/Utils/Carburetor/ruleOptions.mts";
import type {IAstNode, IIdentifierNode, IRule, IRuleContext, TRuleVisitor} from "#src/Models.mts";

interface IOptions {
    ignoreComponents?: readonly string[];
}

interface IJsxAttributeNode extends IAstNode {
    name: IAstNode;
    value: IAstNode | null;
}

const FUNCTION_TYPES: readonly string[] = ['ArrowFunctionExpression', 'FunctionExpression'];

/** The element a prop belongs to, by name, when it is a plain element name. */
const getElementName = (attribute: IAstNode): string | undefined => {
    const opening: IAstNode | null | undefined = attribute.parent;

    if (!opening || opening.type !== 'JSXOpeningElement') {
        return undefined;
    }

    const name: IAstNode = (opening as unknown as {name: IAstNode}).name;

    return name.type === 'JSXIdentifier' ? (name as unknown as IIdentifierNode).name : undefined;
};

/** Whether the prop's value is a function this render just built. */
const isFreshFunction = (value: IAstNode | null): boolean => {
    if (!value || value.type !== 'JSXExpressionContainer') {
        return false;
    }

    const expression: IAstNode = (value as unknown as {expression: IAstNode}).expression;

    if (FUNCTION_TYPES.includes(expression.type)) {
        return true;
    }

    return expression.type === 'CallExpression' && getMemberCallName(expression) === 'bind';
};

/**
 * Reports a handler built in render and passed to a child component.
 *
 * An arrow or a `.bind(this)` in a prop produces a new function on every render of the parent, so
 * the child's props always compare as changed, `shouldComponentUpdate` never bails out, and the
 * props gate — the thing that stops a parent render from cascading through the tree — quietly stops
 * working. Nothing breaks; the application just re-renders as much as it would without the library.
 *
 * `@bind` binds a method once per instance, which keeps the reference stable for the component's
 * lifetime. When a child needs a per-row argument, let it pass one back or give it the id as a prop.
 *
 * DOM elements are not reported: a fresh `onClick` on a `<button>` costs an attribute update, not a
 * subtree render.
 *
 * See docs/hazards.md, H21.
 */
export const noHandlerCreatedInRender: IRule = {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Pass a stable handler to a child component, bound once with @bind.',
        },
        schema: ruleOptions.schema({
            ignoreComponents: {
                type: 'array',
                items: {type: 'string'},
            },
        }),
    },

    create(context: IRuleContext): TRuleVisitor {
        const {componentBases, renderMethods} = ruleOptions.read(context);
        const ignored: readonly string[] = (context.options[0] as IOptions)?.ignoreComponents || [];

        return {
            JSXAttribute(node: IAstNode): void {
                const attribute = node as IJsxAttributeNode;

                if (!isFreshFunction(attribute.value)) {
                    return;
                }

                const element = getElementName(node);

                // A lowercase name is a DOM element; only a component re-renders a subtree.
                if (!element || element[0] !== element[0].toUpperCase() || ignored.includes(element)) {
                    return;
                }

                if (!isInsideRender(node, componentBases, renderMethods)) {
                    return;
                }

                context.report({
                    node,
                    message: `this prop is a new function on every render, so <${element}>'s props `
                        + 'always compare as changed and the props gate stops bailing out — the '
                        + 'cascade the engine exists to prevent comes back through the props. '
                        + 'Declare the handler as a method with @bind and pass it by reference.',
                });
            },
        };
    },
};
