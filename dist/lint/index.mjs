const RECOMMENDED = {
    'carburetor/no-async-effect': 'error',
    'carburetor/no-async-transaction': 'error',
    'carburetor/no-computed-get-in-computed': 'error',
    'carburetor/no-computed-get-in-render': 'error',
    'carburetor/no-direct-data-write': 'warn',
    'carburetor/no-duplicate-effect-name': 'error',
    'carburetor/no-escaping-tracked-data': 'warn',
    'carburetor/no-external-data-mutation': 'error',
    'carburetor/no-get-data-in-render': 'error',
    'carburetor/no-handler-created-in-render': 'warn',
    'carburetor/no-lifecycle-class-property': 'error',
    'carburetor/no-module-level-store': 'off',
    'carburetor/no-store-write-in-render': 'error',
    'carburetor/no-tracked-data-mutation': 'error',
    'carburetor/no-untrackable-draft-mutation': 'warn',
    'carburetor/no-untrackable-store-data': 'warn',
    'carburetor/no-use-carburetor-outside-render': 'error',
    'carburetor/require-bind-for-passed-method': 'error',
    'carburetor/require-effect-deps': 'warn',
    'carburetor/require-emit-after-draft-write': 'error',
    "carburetor/require-subscription-disposal": 'warn',
    'carburetor/require-super-in-lifecycle': 'error'
};
const FUNCTION_TYPES = [
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression'
];
const findEnclosingFunction = (node)=>{
    let current = node.parent;
    while(current){
        if (FUNCTION_TYPES.includes(current.type)) return current;
        current = current.parent;
    }
};
const getMemberCallName = (node)=>{
    const callee = node.callee;
    if ('MemberExpression' !== callee.type) return;
    const member = callee;
    if (member.computed || 'Identifier' !== member.property.type) return;
    return member.property.name;
};
const noAsyncTransaction_FUNCTION_TYPES = [
    'ArrowFunctionExpression',
    'FunctionExpression'
];
const getBatchingName = (node)=>{
    const callee = node.callee;
    if ('Identifier' === callee.type && 'transaction' === callee.name) return 'transaction';
    return 'update' === getMemberCallName(node) ? 'update' : void 0;
};
const getBatchingCallFor = (fn)=>{
    const call = fn.parent;
    if (!call || 'CallExpression' !== call.type) return;
    const first = call.arguments[0];
    if (!first || first.start !== fn.start || first.end !== fn.end) return;
    const name = getBatchingName(call);
    return name ? {
        node: call,
        name
    } : void 0;
};
const noAsyncTransaction = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Keep a transaction or update body synchronous.'
        },
        schema: []
    },
    create (context) {
        const reported = new Set();
        const report = (node, name)=>{
            const key = `${node.start}:${node.end}`;
            if (reported.has(key)) return;
            reported.add(key);
            context.report({
                node,
                message: `${name}() is open only while its body runs synchronously: at the first await the body returns a promise and the batch closes, so the writes that follow are delivered separately — or, for update(), never published at all. Do the asynchronous work first, then ${name}() the synchronous writes.`
            });
        };
        return {
            CallExpression (node) {
                const name = getBatchingName(node);
                const body = name ? node.arguments[0] : void 0;
                if (!name || !body || !noAsyncTransaction_FUNCTION_TYPES.includes(body.type)) return;
                if (body.async) report(node, name);
            },
            AwaitExpression (node) {
                const fn = findEnclosingFunction(node);
                if (!fn) return;
                const batching = getBatchingCallFor(fn);
                if (batching) report(batching.node, batching.name);
            }
        };
    }
};
const CLASS_TYPES = [
    'ClassDeclaration',
    'ClassExpression'
];
const getSuperClassName = (superClass)=>{
    if (!superClass) return;
    if ('Identifier' === superClass.type) return superClass.name;
    if ('MemberExpression' === superClass.type) {
        const property = superClass.property;
        return 'Identifier' === property.type ? property.name : void 0;
    }
};
const findEnclosingClassExtending = (node, baseNames)=>{
    let current = node.parent;
    while(current){
        if (CLASS_TYPES.includes(current.type)) {
            const name = getSuperClassName(current.superClass);
            return name && baseNames.includes(name) ? current : void 0;
        }
        current = current.parent;
    }
};
const CARBURETOR_BASES = [
    'Carburetor',
    'ResourceCarburetor'
];
const COMPONENT_BASES = [
    'AntiHookComponent',
    'ScopedAntiHookComponent'
];
const DEFAULT_RENDER_METHODS = [
    'render'
];
const NAME_LIST = {
    type: 'array',
    items: {
        type: 'string'
    }
};
const ruleOptions = {
    schema: (extra = {})=>[
            {
                type: 'object',
                properties: {
                    componentBases: NAME_LIST,
                    carburetorBases: NAME_LIST,
                    renderMethods: NAME_LIST,
                    ...extra
                },
                additionalProperties: false
            }
        ],
    read: (context)=>{
        const given = context.options[0] || {};
        return {
            componentBases: given.componentBases || COMPONENT_BASES,
            carburetorBases: given.carburetorBases || CARBURETOR_BASES,
            renderMethods: given.renderMethods || DEFAULT_RENDER_METHODS
        };
    }
};
const STORE_NAME_PATTERN = /Carburetor$/;
const SCOPE_TYPES = [
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
    'ClassBody'
];
const isModuleLevel = (node)=>{
    let current = node.parent;
    while(current){
        if (SCOPE_TYPES.includes(current.type)) return false;
        current = current.parent;
    }
    return true;
};
const noModuleLevelStore = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Create stores per request through a scope, not once per module.'
        },
        schema: ruleOptions.schema({
            storeConstructors: {
                type: 'array',
                items: {
                    type: 'string'
                }
            }
        })
    },
    create (context) {
        const { carburetorBases } = ruleOptions.read(context);
        const named = context.options[0]?.storeConstructors || [];
        const localStores = new Set();
        const suspects = [];
        return {
            ClassDeclaration (node) {
                const id = node.id;
                if (!id || 'Identifier' !== id.type) return;
                const body = node.body;
                if (findEnclosingClassExtending(body, carburetorBases)) localStores.add(id.name);
            },
            NewExpression (node) {
                const callee = node.callee;
                if ('Identifier' !== callee.type) return;
                if (!isModuleLevel(node)) return;
                suspects.push({
                    node,
                    name: callee.name
                });
            },
            'Program:exit' () {
                suspects.forEach((suspect)=>{
                    const isStore = localStores.has(suspect.name) || named.includes(suspect.name) || STORE_NAME_PATTERN.test(suspect.name);
                    if (!isStore) return;
                    context.report({
                        node: suspect.node,
                        message: `${suspect.name} is created once per module, so on a server every request shares this instance and one user\'s state appears in another user\'s render. Create it in a CarburetorScope per request and resolve it by token.`
                    });
                });
            }
        };
    }
};
const isWithin = (node, container)=>node.start >= container.start && node.end <= container.end;
const UNTRACKABLE = [
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
    'Date'
];
const getReferencedName = (node)=>{
    if ('Identifier' === node.type) return node.name;
    if ('TSTypeReference' !== node.type) return;
    const typeName = node.typeName;
    return 'Identifier' === typeName.type ? typeName.name : void 0;
};
const FACTORY_NAME_PATTERN = /^(get|create|make)(Initial|Default)/;
const isInsideInitialData = (node)=>{
    let current = node.parent;
    while(current){
        if ('CallExpression' === current.type) {
            const callee = current.callee;
            if ('Super' === callee.type) return true;
        }
        if ('VariableDeclarator' === current.type || 'FunctionDeclaration' === current.type) {
            const id = current.id;
            const name = id && 'Identifier' === id.type ? id.name : void 0;
            if (name && FACTORY_NAME_PATTERN.test(name)) return true;
        }
        current = current.parent;
    }
    return false;
};
const noUntrackableStoreData = {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Keep plain objects and arrays in a store; convert at the edges.'
        },
        schema: ruleOptions.schema({
            allowedTypes: {
                type: 'array',
                items: {
                    type: 'string'
                }
            }
        })
    },
    create (context) {
        const { carburetorBases } = ruleOptions.read(context);
        const allowed = context.options[0]?.allowedTypes || [];
        const dataTypes = new Set();
        const declarations = new Map();
        const annotations = [];
        const constructions = [];
        const isReportable = (name)=>UNTRACKABLE.includes(name) && !allowed.includes(name);
        const report = (node, name)=>{
            context.report({
                node,
                message: `${name} is not tracked field by field: reading it is one coarse leaf, and changing it in place is invisible to the proxies, so the whole value — or the whole store — is invalidated instead of what changed. snapshot() shares it by reference too, so undo will not restore it. Keep plain objects and arrays in the store and convert at the edges.`
            });
        };
        return {
            ClassDeclaration (node) {
                const body = node.body;
                if (!findEnclosingClassExtending(body, carburetorBases)) return;
                const args = node.superTypeArguments;
                const params = args?.params || [];
                const name = params[0] && getReferencedName(params[0]);
                if (name) dataTypes.add(name);
            },
            TSInterfaceDeclaration (node) {
                const id = node.id;
                const name = 'Identifier' === id.type ? id.name : void 0;
                if (name) declarations.set(name, node);
            },
            TSTypeReference (node) {
                const name = getReferencedName(node);
                if (!name || !isReportable(name)) return;
                const property = node.parent && node.parent.parent;
                if (!property || 'TSPropertySignature' !== property.type) return;
                annotations.push({
                    node,
                    name,
                    owner: property
                });
            },
            NewExpression (node) {
                const callee = node.callee;
                const name = getReferencedName(callee);
                if (!name || !isReportable(name) || !node.parent || 'Property' !== node.parent.type) return;
                if (!isInsideInitialData(node)) return;
                constructions.push({
                    node,
                    name
                });
            },
            'Program:exit' () {
                const bodies = [];
                dataTypes.forEach((name)=>{
                    const declaration = declarations.get(name);
                    if (declaration) bodies.push(declaration);
                });
                annotations.forEach((annotation)=>{
                    const inStoreData = bodies.some((body)=>isWithin(annotation.owner, body));
                    if (inStoreData) report(annotation.node, annotation.name);
                });
                constructions.forEach((construction)=>{
                    report(construction.node, construction.name);
                });
            }
        };
    }
};
const getPropertyKeyName = (key)=>{
    if (!key) return;
    if ('Identifier' === key.type) return key.name;
    if ('Literal' === key.type) {
        const value = key.value;
        return 'string' == typeof value ? value : void 0;
    }
};
const hasStableId = (node)=>{
    const options = node.arguments[1];
    if (!options || 'ObjectExpression' !== options.type) return false;
    const properties = options.properties;
    return properties.some((property)=>{
        if ('Property' !== property.type) return false;
        return 'id' === getPropertyKeyName(property.key);
    });
};
const requireSubscriptionDisposal = {
    meta: {
        type: 'suggestion',
        docs: {
            description: "Keep a way to release a subscription — prefer watch(), which returns one."
        },
        schema: []
    },
    create (context) {
        return {
            CallExpression (node) {
                if ('subscribe' !== getMemberCallName(node)) return;
                if (!node.parent || 'ExpressionStatement' !== node.parent.type) return;
                if (hasStableId(node)) return;
                context.report({
                    node,
                    message: "this subscription's id is discarded, so it can never be released: the store keeps the callback, and everything it closed over, for the lifetime of the process. Use watch(paths, callback), which returns a disposer, or keep the id and unsubscribe."
                });
            }
        };
    }
};
const noAsyncEffect_FUNCTION_TYPES = [
    'ArrowFunctionExpression',
    'FunctionExpression'
];
const getReturnedCall = (fn)=>{
    const body = fn.body;
    if (!body) return;
    if ('CallExpression' === body.type) return body;
    if ('BlockStatement' !== body.type) return;
    const statements = body.body;
    if (1 !== statements.length || 'ReturnStatement' !== statements[0].type) return;
    const returned = statements[0].argument;
    return returned && 'CallExpression' === returned.type ? returned : void 0;
};
const noAsyncEffect = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Keep an effect body synchronous so its cleanup survives.'
        },
        schema: []
    },
    create (context) {
        const asyncLocals = new Set();
        const suspects = [];
        const report = (node)=>{
            context.report({
                node,
                message: "an async effect body returns a promise, and the engine treats what an effect returns as its cleanup: the promise is not a function, so this effect can never clean up after itself and nothing is aborted on unmount. Start the work in a synchronous body and return a cleanup, for example one that aborts an AbortController."
            });
        };
        return {
            FunctionDeclaration (node) {
                const id = node.id;
                if (node.async && id && 'Identifier' === id.type) asyncLocals.add(id.name);
            },
            VariableDeclarator (node) {
                const declarator = node;
                const init = declarator.init;
                if (!init || !noAsyncEffect_FUNCTION_TYPES.includes(init.type) || !init.async) return;
                if ('Identifier' === declarator.id.type) asyncLocals.add(declarator.id.name);
            },
            CallExpression (node) {
                if ('useEffect' !== getMemberCallName(node)) return;
                const body = node.arguments[0];
                if (!body || !noAsyncEffect_FUNCTION_TYPES.includes(body.type)) return;
                if (body.async) return void report(body);
                const returned = getReturnedCall(body);
                const callee = returned && returned.callee;
                if (callee && 'Identifier' === callee.type) suspects.push({
                    node: body,
                    callee: callee.name
                });
            },
            'Program:exit' () {
                suspects.forEach((suspect)=>{
                    if (asyncLocals.has(suspect.callee)) report(suspect.node);
                });
            }
        };
    }
};
const noDuplicateEffectName = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Give every effect in a component a name of its own.'
        },
        schema: ruleOptions.schema()
    },
    create (context) {
        const { componentBases } = ruleOptions.read(context);
        const seen = new Set();
        return {
            CallExpression (node) {
                if ('useEffect' !== getMemberCallName(node)) return;
                const name = node.arguments[1];
                if (!name || 'Literal' !== name.type || 'string' != typeof name.value) return;
                const owner = findEnclosingClassExtending(node, componentBases);
                if (!owner) return;
                const key = `${owner.start}:${owner.end}:${name.value}`;
                if (!seen.has(key)) return void seen.add(key);
                context.report({
                    node: name,
                    message: `two effects in this component are registered as "${name.value}". The name is the effect's identity, so the second registration overwrites the first: its cleanup is lost and never runs. Give each effect its own name.`
                });
            }
        };
    }
};
const describeChainRoot = (expression)=>{
    let current = expression;
    let baseProperty;
    while('MemberExpression' === current.type){
        const member = current;
        baseProperty = member.computed || 'Identifier' !== member.property.type ? void 0 : member.property.name;
        current = member.object;
    }
    return {
        base: current,
        baseProperty
    };
};
const REACTIVE_ROOTS = [
    'props',
    'state'
];
const ANALYSABLE_BODIES = [
    'ArrowFunctionExpression',
    'FunctionExpression'
];
const findEnclosingEffect = (node)=>{
    let current = node.parent;
    while(current){
        if ('CallExpression' === current.type && 'useEffect' === getMemberCallName(current)) return current;
        current = current.parent;
    }
};
const requireEffectDeps = {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'List the props and state an effect reads in its dependency array.'
        },
        schema: []
    },
    create (context) {
        const dependenciesOf = (effect)=>{
            const deps = effect.arguments[2];
            if (!deps || 'ArrayExpression' !== deps.type) return [];
            const elements = deps.elements;
            return elements.flatMap((element)=>element ? [
                    context.sourceCode.getText(element)
                ] : []);
        };
        return {
            MemberExpression (node) {
                const member = node;
                if (node.parent && 'MemberExpression' === node.parent.type && node.parent.object.start === node.start) return;
                const { base, baseProperty } = describeChainRoot(member);
                if ('ThisExpression' !== base.type || !baseProperty || !REACTIVE_ROOTS.includes(baseProperty)) return;
                const effect = findEnclosingEffect(node);
                const body = effect && effect.arguments[0];
                if (!effect || !body || !isWithin(node, body)) return;
                if (!ANALYSABLE_BODIES.includes(body.type)) return;
                const text = context.sourceCode.getText(node);
                const covered = dependenciesOf(effect).some((dependency)=>text === dependency || text.startsWith(`${dependency}.`));
                if (covered) return;
                context.report({
                    node,
                    message: `${text} is read by this effect but is not in its dependencies, so the effect runs once with the first value and never again — it keeps whatever it set up for the old one. Add it to the dependency array, or keep the array empty deliberately and read the value some other way.`
                });
            }
        };
    }
};
const COMPUTED_FACTORIES = [
    'computed'
];
const findEnclosingComputedCall = (node)=>{
    let current = node.parent;
    while(current){
        if ('CallExpression' === current.type) {
            const call = current;
            const callee = call.callee;
            if ('Identifier' === callee.type && COMPUTED_FACTORIES.includes(callee.name)) return call;
        }
        current = current.parent;
    }
};
const getReaderName = (call)=>{
    const body = call.arguments[0];
    if (!body) return;
    const parameter = body.params?.[0];
    return parameter && 'Identifier' === parameter.type ? parameter.name : void 0;
};
const getCalleeObjectName = (node)=>{
    const callee = node.callee;
    const object = callee.object;
    return 'Identifier' === object.type ? object.name : void 0;
};
const noComputedGetInComputed = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Inside a computed, read sources through the reader it is given.'
        },
        schema: []
    },
    create (context) {
        return {
            CallExpression (node) {
                const name = getMemberCallName(node);
                if ('get' !== name && 'getData' !== name) return;
                if ('get' === name && 0 !== node.arguments.length) return;
                const computedCall = findEnclosingComputedCall(node);
                if (!computedCall) return;
                const objectName = getCalleeObjectName(node);
                if (objectName && objectName === getReaderName(computedCall)) return;
                context.report({
                    node,
                    message: `${name}() inside a computed body bypasses the reader it was given, so no dependency is registered and this computed will keep returning its first value forever. Read through the reader instead: computed(read => read(source)).`
                });
            }
        };
    }
};
const MEMBER_TYPES = [
    'MethodDefinition',
    'PropertyDefinition'
];
const SYNCHRONOUS_CALLBACKS = [
    'map',
    'flatMap',
    'filter',
    'forEach',
    'reduce',
    'reduceRight',
    'some',
    'every',
    'find',
    'findIndex',
    'findLast',
    'sort'
];
const isSynchronousCallback = (fn)=>{
    const call = fn.parent;
    if (!call || 'CallExpression' !== call.type) return false;
    const isArgument = call.arguments.some((argument)=>argument.start === fn.start && argument.end === fn.end);
    if (!isArgument) return false;
    const method = getMemberCallName(call);
    return Boolean(method && SYNCHRONOUS_CALLBACKS.includes(method));
};
const isInsideRender = (node, componentBases, renderMethods)=>{
    let current = node;
    while(current){
        const enclosing = findEnclosingFunction(current);
        if (!enclosing) break;
        const owner = enclosing.parent;
        if (owner && MEMBER_TYPES.includes(owner.type)) {
            const name = getPropertyKeyName(owner.key);
            if (!name || !renderMethods.includes(name)) return false;
            return Boolean(findEnclosingClassExtending(owner, componentBases));
        }
        if (!isSynchronousCallback(enclosing)) break;
        current = enclosing.parent;
    }
    return false;
};
const noComputedGetInRender = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Read a computed in render through useComputed, not through get().'
        },
        schema: ruleOptions.schema()
    },
    create (context) {
        const { componentBases, renderMethods } = ruleOptions.read(context);
        return {
            CallExpression (node) {
                if ('get' !== getMemberCallName(node)) return;
                if (0 !== node.arguments.length) return;
                if (!isInsideRender(node, componentBases, renderMethods)) return;
                context.report({
                    node,
                    message: "get() in render returns the derived value without subscribing to it, so this component will not re-render when it changes. Use this.useComputed(computed), which subscribes to the value rather than to its inputs."
                });
            }
        };
    }
};
const noEscapingTrackedData_isWithin = (node, container)=>node.start >= container.start && node.end <= container.end;
const isFieldOfThis = (target)=>{
    if ('MemberExpression' !== target.type) return false;
    return 'ThisExpression' === target.object.type;
};
const noEscapingTrackedData = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Use tracked data inside the render that read it.'
        },
        schema: ruleOptions.schema()
    },
    create (context) {
        const { componentBases, renderMethods } = ruleOptions.read(context);
        const tracked = new Map();
        const report = (node, detail)=>{
            context.report({
                node,
                message: `tracked data ${detail}. What useCarburetor returns is a proxy over the state during this render: outside it nothing is tracked, and it may point at a branch the store has since replaced. Read the values you need in render, or call getData() where you need them.`
            });
        };
        return {
            VariableDeclarator (node) {
                const declarator = node;
                const init = declarator.init;
                if (!init || 'CallExpression' !== init.type || 'useCarburetor' !== getMemberCallName(init)) return;
                if ('Identifier' !== declarator.id.type) return;
                if (!isInsideRender(node, componentBases, renderMethods)) return;
                const renderFunction = findEnclosingFunction(node);
                if (renderFunction) tracked.set(declarator.id.name, renderFunction);
            },
            AssignmentExpression (node) {
                const assignment = node;
                if ('Identifier' !== assignment.right.type) return;
                if (!tracked.has(assignment.right.name) || !isFieldOfThis(assignment.left)) return;
                report(node, 'is stored on the component and outlives the render that read it');
            },
            Identifier (node) {
                const owner = tracked.get(node.name);
                if (!owner || node.parent && 'VariableDeclarator' === node.parent.type) return;
                if (!noEscapingTrackedData_isWithin(node, owner)) return;
                if (isInsideRender(node, componentBases, renderMethods)) return;
                report(node, 'is captured by a function that runs after this render');
            }
        };
    }
};
const noGetDataInRender = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Read state in render through useCarburetor, not through getData().'
        },
        schema: ruleOptions.schema()
    },
    create (context) {
        const { componentBases, renderMethods } = ruleOptions.read(context);
        return {
            CallExpression (node) {
                if ('getData' !== getMemberCallName(node)) return;
                if (!isInsideRender(node, componentBases, renderMethods)) return;
                context.report({
                    node,
                    message: "getData() in render reads the state without subscribing to it, so this component will never re-render when the data changes. Read through this.useCarburetor(carburetor) instead, which subscribes to exactly the fields you read."
                });
            }
        };
    }
};
const noHandlerCreatedInRender_FUNCTION_TYPES = [
    'ArrowFunctionExpression',
    'FunctionExpression'
];
const getElementName = (attribute)=>{
    const opening = attribute.parent;
    if (!opening || 'JSXOpeningElement' !== opening.type) return;
    const name = opening.name;
    return 'JSXIdentifier' === name.type ? name.name : void 0;
};
const isFreshFunction = (value)=>{
    if (!value || 'JSXExpressionContainer' !== value.type) return false;
    const expression = value.expression;
    if (noHandlerCreatedInRender_FUNCTION_TYPES.includes(expression.type)) return true;
    return 'CallExpression' === expression.type && 'bind' === getMemberCallName(expression);
};
const noHandlerCreatedInRender = {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Pass a stable handler to a child component, bound once with @bind.'
        },
        schema: ruleOptions.schema({
            ignoreComponents: {
                type: 'array',
                items: {
                    type: 'string'
                }
            }
        })
    },
    create (context) {
        const { componentBases, renderMethods } = ruleOptions.read(context);
        const ignored = context.options[0]?.ignoreComponents || [];
        return {
            JSXAttribute (node) {
                const attribute = node;
                if (!isFreshFunction(attribute.value)) return;
                const element = getElementName(node);
                if (!element || element[0] !== element[0].toUpperCase() || ignored.includes(element)) return;
                if (!isInsideRender(node, componentBases, renderMethods)) return;
                context.report({
                    node,
                    message: `this prop is a new function on every render, so <${element}>'s props always compare as changed and the props gate stops bailing out — the cascade the engine exists to prevent comes back through the props. Declare the handler as a method with @bind and pass it by reference.`
                });
            }
        };
    }
};
const LIFECYCLE_NAMES = [
    'render',
    'componentDidMount',
    'componentDidUpdate',
    'componentWillUnmount',
    'shouldComponentUpdate',
    'componentDidCatch',
    'getSnapshotBeforeUpdate'
];
const noLifecycleClassProperty = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Declare lifecycle methods as methods, not as class properties.'
        },
        schema: ruleOptions.schema()
    },
    create (context) {
        const { componentBases } = ruleOptions.read(context);
        return {
            PropertyDefinition (node) {
                const property = node;
                const name = getPropertyKeyName(property.key);
                if (!name || !LIFECYCLE_NAMES.includes(name) || property.static) return;
                if (!findEnclosingClassExtending(node, componentBases)) return;
                context.report({
                    node,
                    message: `"${name}" is declared as a class property, which shadows the base implementation on the prototype: effects, subscription cleanup or the props gate will silently stop working. Declare it as a method and call super, or override useEffects/unUseEffects instead.`
                });
            }
        };
    }
};
const findEnclosingClassMember_MEMBER_TYPES = [
    'MethodDefinition',
    'PropertyDefinition'
];
const findEnclosingClassMember = (node)=>{
    let current = node.parent;
    while(current){
        if (findEnclosingClassMember_MEMBER_TYPES.includes(current.type)) return current;
        current = current.parent;
    }
};
const identify = (node)=>`${node.start}:${node.end}`;
const isBound = (member)=>{
    const decorators = member.decorators || [];
    return decorators.some((decorator)=>{
        const expression = decorator.expression;
        return 'Identifier' === expression.type && 'bind' === expression.name;
    });
};
const isPassedAsValue = (node)=>{
    const parent = node.parent;
    if (!parent) return false;
    if ('CallExpression' === parent.type) {
        const callee = parent.callee;
        if (callee.start === node.start && callee.end === node.end) return false;
    }
    if ('AssignmentExpression' === parent.type) {
        const target = parent.left;
        if (target.start === node.start && target.end === node.end) return false;
    }
    return 'MemberExpression' !== parent.type;
};
const requireBindForPassedMethod = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Bind a component method with @bind before passing it as a value.'
        },
        schema: ruleOptions.schema()
    },
    create (context) {
        const { componentBases } = ruleOptions.read(context);
        const methods = new Map();
        const references = [];
        const keyOf = (classNode, name)=>`${identify(classNode)}:${name}`;
        return {
            MethodDefinition (node) {
                const name = getPropertyKeyName(node.key);
                const classNode = findEnclosingClassExtending(node, componentBases);
                if (!name || !classNode) return;
                const key = keyOf(classNode, name);
                const known = methods.get(key);
                methods.set(key, {
                    bound: isBound(node),
                    usesThis: Boolean(known && known.usesThis)
                });
            },
            ThisExpression (node) {
                const member = findEnclosingClassMember(node);
                if (!member || 'MethodDefinition' !== member.type) return;
                const name = getPropertyKeyName(member.key);
                const classNode = findEnclosingClassExtending(member, componentBases);
                if (!name || !classNode) return;
                const key = keyOf(classNode, name);
                const known = methods.get(key);
                methods.set(key, {
                    bound: Boolean(known && known.bound),
                    usesThis: true
                });
            },
            MemberExpression (node) {
                const member = node;
                if ('ThisExpression' !== member.object.type || 'Identifier' !== member.property.type) return;
                if (!isPassedAsValue(node)) return;
                const classNode = findEnclosingClassExtending(node, componentBases);
                if (!classNode) return;
                const name = member.property.name;
                references.push({
                    node,
                    key: keyOf(classNode, name),
                    name
                });
            },
            'Program:exit' () {
                references.forEach((reference)=>{
                    const method = methods.get(reference.key);
                    if (!method || method.bound || !method.usesThis) return;
                    context.report({
                        node: reference.node,
                        message: `this.${reference.name} is a prototype method passed as a value, so \`this\` will be undefined when it runs. Decorate it with @bind, which binds once per instance — binding here instead would build a new function every render and defeat the props gate.`
                    });
                });
            }
        };
    }
};
const requireSuperInLifecycle_LIFECYCLE_NAMES = [
    'componentDidMount',
    'componentDidUpdate',
    'componentWillUnmount',
    'shouldComponentUpdate'
];
const ANSWERING_NAMES = [
    'shouldComponentUpdate'
];
const requireSuperInLifecycle_identify = (node)=>`${node.start}:${node.end}`;
const isResultUsed = (node)=>{
    let current = node.parent;
    while(current){
        if ('ReturnStatement' === current.type || 'VariableDeclarator' === current.type) return true;
        if ('MethodDefinition' === current.type || 'PropertyDefinition' === current.type) break;
        current = current.parent;
    }
    return false;
};
const requireSuperInLifecycle = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Call the base implementation when overriding a lifecycle method.'
        },
        schema: ruleOptions.schema()
    },
    create (context) {
        const { componentBases } = ruleOptions.read(context);
        const overrides = new Map();
        const calls = new Set();
        const answers = new Set();
        return {
            MethodDefinition (node) {
                const name = getPropertyKeyName(node.key);
                if (!name || !requireSuperInLifecycle_LIFECYCLE_NAMES.includes(name)) return;
                if (!findEnclosingClassExtending(node, componentBases)) return;
                overrides.set(requireSuperInLifecycle_identify(node), {
                    node,
                    name
                });
            },
            CallExpression (node) {
                const callee = node.callee;
                if ('MemberExpression' !== callee.type) return;
                const member = callee;
                if ('Super' !== member.object.type || 'Identifier' !== member.property.type) return;
                const owner = findEnclosingClassMember(node);
                if (!owner) return;
                const called = member.property.name;
                if (called !== getPropertyKeyName(owner.key)) return;
                calls.add(requireSuperInLifecycle_identify(owner));
                if (isResultUsed(node)) answers.add(requireSuperInLifecycle_identify(owner));
            },
            'Program:exit' () {
                overrides.forEach((override, key)=>{
                    if (!calls.has(key)) return void context.report({
                        node: override.node,
                        message: `${override.name} is overridden without calling super.${override.name}(), which is where the base class commits subscriptions, runs effects, releases them or gates a re-render. One of those silently stops working. Call super, or override useEffects/unUseEffects instead.`
                    });
                    if (ANSWERING_NAMES.includes(override.name) && !answers.has(key)) context.report({
                        node: override.node,
                        message: `${override.name} calls super but discards its answer, so the props gate no longer decides anything. Combine the two answers, for example \`return super.shouldComponentUpdate(p, s) || mine\`.`
                    });
                });
            }
        };
    }
};
const TRACKING_READS = [
    'useCarburetor',
    'useComputed'
];
const isCalledOnThis = (node)=>{
    const callee = node.callee;
    return 'ThisExpression' === callee.object.type;
};
const noUseCarburetorOutsideRender = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Call useCarburetor and useComputed in render only.'
        },
        schema: ruleOptions.schema()
    },
    create (context) {
        const { componentBases, renderMethods } = ruleOptions.read(context);
        return {
            CallExpression (node) {
                const name = getMemberCallName(node);
                if (!name || !TRACKING_READS.includes(name) || !isCalledOnThis(node)) return;
                if (isInsideRender(node, componentBases, renderMethods)) return;
                if (!findEnclosingClassExtending(node, componentBases)) return;
                context.report({
                    node,
                    message: `this.${name}() outside render does not establish a subscription: reads are collected per render and copied when the component commits, so this one is either ignored or discarded by the next render. Read in render, and use getData() where no subscription is wanted.`
                });
            }
        };
    }
};
const ARRAY_MUTATORS = [
    'push',
    'pop',
    'shift',
    'unshift',
    'splice',
    'sort',
    'reverse',
    'fill',
    'copyWithin'
];
const visitMutations = (onMutation)=>({
        AssignmentExpression (node) {
            onMutation(node.left, node);
        },
        UpdateExpression (node) {
            onMutation(node.argument, node);
        },
        UnaryExpression (node) {
            const unary = node;
            if ('delete' === unary.operator) onMutation(unary.argument, node);
        },
        CallExpression (node) {
            const method = getMemberCallName(node);
            if (!method || !ARRAY_MUTATORS.includes(method)) return;
            const callee = node.callee;
            onMutation(callee.object, node);
        }
    });
const noDirectDataWrite = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Write through draft, which records the changed paths.'
        },
        schema: ruleOptions.schema()
    },
    create (context) {
        const { carburetorBases } = ruleOptions.read(context);
        return visitMutations((target, node)=>{
            const { base, baseProperty } = describeChainRoot(target);
            if ('ThisExpression' !== base.type || 'data' !== baseProperty) return;
            if (!findEnclosingClassExtending(node, carburetorBases)) return;
            context.report({
                node,
                message: "writing to this.data records no path, so this update invalidates the whole store and re-renders every subscriber instead of the ones that read what changed. Write through this.draft, or this.update(draft => ...) to mutate and publish in one step."
            });
        });
    }
};
const STATE_READERS = [
    'getData',
    'getEntry'
];
const noExternalDataMutation = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Change state through a store method, not through getData().'
        },
        schema: []
    },
    create (context) {
        return visitMutations((target, node)=>{
            const { base } = describeChainRoot(target);
            const reader = 'CallExpression' === base.type ? getMemberCallName(base) : void 0;
            if (!reader || !STATE_READERS.includes(reader)) return;
            context.report({
                node,
                message: `mutating what ${reader}() returned changes the state without recording a path and without notifying anyone, so nothing re-renders and any snapshot taken earlier silently changes with it. Add a method to the carburetor and write through draft there.`
            });
        });
    }
};
const READ_METHODS = [
    'getData',
    'getVersion',
    'getUID',
    'getLastError',
    'snapshot',
    'toJSON',
    'read',
    'get',
    'suspend'
];
const noStoreWriteInRender_TRACKING_READS = [
    'useCarburetor',
    'useComputed'
];
const noStoreWriteInRender = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Do not change a store while rendering.'
        },
        schema: ruleOptions.schema({
            storeNames: {
                type: 'array',
                items: {
                    type: 'string'
                }
            }
        })
    },
    create (context) {
        const { componentBases, renderMethods } = ruleOptions.read(context);
        const stores = new Set(context.options[0]?.storeNames || []);
        const suspects = [];
        return {
            CallExpression (node) {
                const method = getMemberCallName(node);
                if (!method) return;
                const call = node;
                if (noStoreWriteInRender_TRACKING_READS.includes(method)) {
                    const source = call.arguments[0];
                    if (source) stores.add(context.sourceCode.getText(source));
                    return;
                }
                if (READ_METHODS.includes(method)) return;
                if (!isInsideRender(node, componentBases, renderMethods)) return;
                const receiver = call.callee.object;
                suspects.push({
                    node,
                    receiver: context.sourceCode.getText(receiver),
                    method
                });
            },
            'Program:exit' () {
                suspects.forEach((suspect)=>{
                    if (!stores.has(suspect.receiver)) return;
                    context.report({
                        node: suspect.node,
                        message: `${suspect.method}() changes a store while this component renders, which notifies subscribers mid-render: at best an extra pass, at worst an update loop React reports far from here. Write from useEffects, from an event handler, or from a resource load.`
                    });
                });
            }
        };
    }
};
const getBoundNames = (pattern)=>{
    if ('Identifier' === pattern.type) return [
        pattern.name
    ];
    if ('ObjectPattern' !== pattern.type) return [];
    const properties = pattern.properties;
    return properties.flatMap((property)=>{
        const value = property.value;
        return value && 'Identifier' === value.type ? [
            value.name
        ] : [];
    });
};
const noTrackedDataMutation = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Change state through a carburetor method, not through tracked data.'
        },
        schema: []
    },
    create (context) {
        const tracked = new Map();
        const mutations = visitMutations((target, node)=>{
            const { base } = describeChainRoot(target);
            if ('Identifier' !== base.type) return;
            const owner = tracked.get(base.name);
            if (!owner || !isWithin(node, owner)) return;
            context.report({
                node,
                message: "data read through useCarburetor is read-only: this write throws at runtime, and silently does nothing once a cast hides it from the compiler. Call a method on the carburetor, which writes through draft and knows which paths changed."
            });
        });
        return {
            ...mutations,
            VariableDeclarator (node) {
                const declarator = node;
                const init = declarator.init;
                if (!init || 'CallExpression' !== init.type || 'useCarburetor' !== getMemberCallName(init)) return;
                const callee = init.callee;
                if ('ThisExpression' !== callee.object.type) return;
                const scope = findEnclosingFunction(node);
                if (!scope) return;
                getBoundNames(declarator.id).forEach((name)=>{
                    tracked.set(name, scope);
                });
            }
        };
    }
};
const MUTATING_METHODS = [
    'set',
    'add',
    'delete',
    'clear',
    'setTime',
    'setDate',
    'setMonth',
    'setFullYear',
    'setHours',
    'setMinutes',
    'setSeconds',
    'setMilliseconds'
];
const getUpdateDraftName = (node)=>{
    let current = node.parent;
    while(current){
        if ('CallExpression' === current.type && 'update' === getMemberCallName(current)) {
            const body = current.arguments[0];
            const parameter = body && body.params?.[0];
            return parameter && 'Identifier' === parameter.type ? parameter.name : void 0;
        }
        current = current.parent;
    }
};
const noUntrackableDraftMutation = {
    meta: {
        type: 'suggestion',
        docs: {
            description: 'Replace an untrackable value instead of mutating it through draft.'
        },
        schema: ruleOptions.schema({
            mutatingMethods: {
                type: 'array',
                items: {
                    type: 'string'
                }
            }
        })
    },
    create (context) {
        const { carburetorBases } = ruleOptions.read(context);
        const methods = context.options[0]?.mutatingMethods || MUTATING_METHODS;
        return {
            CallExpression (node) {
                const method = getMemberCallName(node);
                if (!method || !methods.includes(method)) return;
                const callee = node.callee;
                const { base, baseProperty } = describeChainRoot(callee.object);
                const throughDraft = 'ThisExpression' === base.type && 'draft' === baseProperty;
                const throughUpdateDraft = 'Identifier' === base.type && base.name === getUpdateDraftName(node);
                if (!throughDraft && !throughUpdateDraft) return;
                if (!findEnclosingClassExtending(node, carburetorBases)) return;
                context.report({
                    node,
                    message: `${method}() changes a value the tracking proxies cannot wrap, so the change itself is invisible and the whole value is invalidated instead of the part that changed. Replace the value (draft.x = next) or keep plain objects and arrays in the store.`
                });
            }
        };
    }
};
const EMIT_METHODS = [
    'emitUpdate',
    'emitSoon',
    'emitByKey'
];
const PUBLISHING_CONTEXT = [
    'preEmit'
];
const requireEmitAfterDraftWrite_identify = (member)=>`${member.start}:${member.end}`;
const isInsideUpdateCall = (node)=>{
    let current = node.parent;
    while(current){
        if ('CallExpression' === current.type && 'update' === getMemberCallName(current)) return true;
        current = current.parent;
    }
    return false;
};
const requireEmitAfterDraftWrite = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Publish a draft write, ideally through update(draft => ...).'
        },
        schema: ruleOptions.schema({
            deferredEmitMethods: {
                type: 'array',
                items: {
                    type: 'string'
                }
            }
        })
    },
    create (context) {
        const { carburetorBases } = ruleOptions.read(context);
        const deferred = context.options[0]?.deferredEmitMethods || [];
        const writes = new Map();
        const publishes = new Set();
        const callsFrom = new Map();
        const collectExempt = ()=>{
            const exempt = new Set([
                ...PUBLISHING_CONTEXT,
                ...deferred
            ]);
            const queue = [
                ...exempt
            ];
            while(queue.length > 0){
                const name = queue.shift();
                const called = callsFrom.get(name);
                if (!called) continue;
                called.forEach((callee)=>{
                    if (exempt.has(callee)) return;
                    exempt.add(callee);
                    queue.push(callee);
                });
            }
            return exempt;
        };
        const mutations = visitMutations((target, node)=>{
            const { base, baseProperty } = describeChainRoot(target);
            if ('ThisExpression' !== base.type || 'draft' !== baseProperty) return;
            if (!findEnclosingClassExtending(node, carburetorBases) || isInsideUpdateCall(node)) return;
            const member = findEnclosingClassMember(node);
            if (!member) return;
            const key = requireEmitAfterDraftWrite_identify(member);
            if (!writes.has(key)) writes.set(key, {
                node,
                member: getPropertyKeyName(member.key)
            });
        });
        return {
            ...mutations,
            CallExpression (node) {
                if (mutations.CallExpression) mutations.CallExpression(node);
                const method = getMemberCallName(node);
                if (!method) return;
                const callee = node.callee;
                const receiver = callee.object;
                if ('ThisExpression' !== receiver.type) return;
                const member = findEnclosingClassMember(node);
                if (!member) return;
                if (EMIT_METHODS.includes(method)) return void publishes.add(requireEmitAfterDraftWrite_identify(member));
                const caller = getPropertyKeyName(member.key);
                if (!caller) return;
                const called = callsFrom.get(caller) || new Set();
                called.add(method);
                callsFrom.set(caller, called);
            },
            'Program:exit' () {
                const exempt = collectExempt();
                writes.forEach((write, key)=>{
                    if (publishes.has(key) || write.member && exempt.has(write.member)) return;
                    context.report({
                        node: write.node,
                        message: "this writes through draft but never publishes: the data changes while nobody is notified, so the interface keeps showing the previous value. Use this.update(draft => ...), which mutates and publishes in one step, or call this.emitUpdate() before returning."
                    });
                });
            }
        };
    }
};
const src_plugin = {
    meta: {
        name: 'carburetor'
    },
    rules: {
        'no-async-effect': noAsyncEffect,
        'no-async-transaction': noAsyncTransaction,
        'no-computed-get-in-computed': noComputedGetInComputed,
        'no-computed-get-in-render': noComputedGetInRender,
        'no-direct-data-write': noDirectDataWrite,
        'no-duplicate-effect-name': noDuplicateEffectName,
        'no-escaping-tracked-data': noEscapingTrackedData,
        'no-external-data-mutation': noExternalDataMutation,
        'no-get-data-in-render': noGetDataInRender,
        'no-handler-created-in-render': noHandlerCreatedInRender,
        'no-lifecycle-class-property': noLifecycleClassProperty,
        'no-module-level-store': noModuleLevelStore,
        'no-store-write-in-render': noStoreWriteInRender,
        'no-tracked-data-mutation': noTrackedDataMutation,
        'no-untrackable-draft-mutation': noUntrackableDraftMutation,
        'no-untrackable-store-data': noUntrackableStoreData,
        'no-use-carburetor-outside-render': noUseCarburetorOutsideRender,
        'require-bind-for-passed-method': requireBindForPassedMethod,
        'require-effect-deps': requireEffectDeps,
        'require-emit-after-draft-write': requireEmitAfterDraftWrite,
        "require-subscription-disposal": requireSubscriptionDisposal,
        'require-super-in-lifecycle': requireSuperInLifecycle
    }
};
src_plugin.configs = {
    recommended: {
        plugins: {
            carburetor: src_plugin
        },
        rules: RECOMMENDED
    }
};
const src = src_plugin;
export default src;
