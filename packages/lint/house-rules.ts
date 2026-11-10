import * as Path from "node:path"
import { Predicate } from "effect"

type Loc = { readonly start: { readonly line: number }; readonly end: { readonly line: number } }

type Node = { readonly type: string; readonly loc: Loc; readonly parent?: Node | null }

type Report = { readonly node: Node; readonly message: string }

type Context = {
  readonly filename: string
  readonly report: (report: Report) => void
  readonly sourceCode: { readonly getAllComments: () => ReadonlyArray<Node> }
}

type Visitor = Readonly<Record<string, (node: Node) => void>>

type Rule = { readonly meta: { readonly type: "problem" }; readonly create: (context: Context) => Visitor }

const isNode = (value: unknown): value is Node => Predicate.hasProperty(value, "type") && Predicate.isString(value.type)

const field = (node: unknown, key: string): unknown => (Predicate.hasProperty(node, key) ? node[key] : undefined)

const nameOf = (node: unknown): string | undefined => {
  const name = field(node, "name")

  return Predicate.isString(name) ? name : undefined
}

const stringValue = (node: unknown): string | undefined => {
  const value = field(node, "value")

  return Predicate.isString(value) ? value : undefined
}

const memberParts = (
  node: unknown
): { readonly object: string | undefined; readonly property: string | undefined } => ({
  object: nameOf(field(node, "object")),
  property: nameOf(field(node, "property"))
})

const isFunction = (node: Node): boolean =>
  ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(node.type)

const rule = (create: (context: Context) => Visitor): Rule => ({ meta: { type: "problem" }, create })

const reportAll =
  (context: Context, message: string) =>
  (node: Node): void =>
    context.report({ node, message })

const posix = (file: string): string => file.split(Path.sep).join("/")

const packageSource = /^.*\/packages\/([^/]+)\/(.+)$/

export type Place = { readonly pkg: string; readonly path: string }

export const placeOf = (file: string): Place | undefined => {
  const found = packageSource.exec(posix(Path.resolve(file)))
  if (found === null) return undefined

  return { pkg: found[1] ?? "", path: found[2] ?? "" }
}

const isTestFile = (path: string): boolean => /\.(test|stories|testing)\.ts$/.test(path)

export const isEntryPoint = (place: Place | undefined): boolean => {
  if (place === undefined) return false
  if (place.path.startsWith("tools/")) return true
  if (isTestFile(place.path)) return true
  if (place.pkg === "server" && place.path === "src/main.ts") return true

  return place.pkg === "web" && place.path === "src/main.ts"
}

export const ownsMarkup = (place: Place | undefined): boolean => {
  if (place?.pkg !== "web") return true
  if (place.path.startsWith("src/components/")) return true
  if (place.path.startsWith("src/theme/")) return true
  if (place.path.startsWith(".storybook/")) return true

  return isTestFile(place.path)
}

export const ownsProcesses = (place: Place | undefined): boolean => {
  if (place === undefined) return true
  if (place.pkg !== "server") return place.pkg === "lint"

  return place.path === "src/platform/Shell.ts" || isTestFile(place.path)
}

export const ownsTransports = (place: Place | undefined): boolean => {
  if (place === undefined) return true

  return place.pkg === "contract" && place.path === "src/Contract.ts"
}

const ownsSql = (place: Place | undefined): boolean => {
  if (place === undefined) return true
  if (place.path.endsWith("Repo.ts")) return true
  if (place.path.endsWith("/migrations.ts")) return true
  if (place.path.endsWith("/Database.ts")) return true

  return isTestFile(place.path)
}

const layers: Readonly<Record<string, ReadonlyArray<string>>> = {
  contract: ["contract"],
  domain: ["contract", "domain"],
  web: ["contract", "domain", "web"],
  server: ["contract", "domain", "server"]
}

const workspacePackage = /^@review-desk\/([^/]+)/

const serviceBuilders = new Set(["Context", "Layer"])

export const boundaryViolation = (
  place: Place | undefined,
  specifier: string,
  names: ReadonlyArray<string>
): string | undefined => {
  const target = workspacePackage.exec(specifier)?.[1]
  const allowed = place === undefined ? undefined : layers[place.pkg]

  if (target !== undefined && allowed !== undefined && !allowed.includes(target))
    return `packages/${place?.pkg} must not import @review-desk/${target}`
  if (specifier === "effect/process" && !ownsProcesses(place))
    return "only server/src/platform/Shell.ts starts processes"
  if (specifier.startsWith("effect/sql") && !ownsSql(place))
    return "only *Repo.ts, Database.ts and migrations.ts use SQL"
  if (place?.pkg === "domain" && specifier === "effect" && names.some((name) => serviceBuilders.has(name)))
    return "domain holds pure functions and schemas; services and layers belong in the server"
  if (place?.pkg === "web" && /^(bun|@effect\/platform-bun|node:)/.test(specifier))
    return `the web client must not import ${specifier}`

  return undefined
}

const importedNames = (node: Node): ReadonlyArray<string> => {
  const specifiers = field(node, "specifiers")
  if (!Array.isArray(specifiers)) return []

  return specifiers.flatMap((specifier: unknown) => {
    const name = nameOf(field(specifier, "imported"))

    return name === undefined ? [] : [name]
  })
}

const checkSource = (context: Context) => (node: Node) => {
  const specifier = stringValue(field(node, "source"))
  if (specifier === undefined) return

  const message = boundaryViolation(placeOf(context.filename), specifier, importedNames(node))
  if (message === undefined) return

  context.report({ node, message })
}

const mutatingMethods = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"])

const isModuleName = (name: string | undefined): boolean => name !== undefined && /^[A-Z]/.test(name)

const freshValueTypes = new Set([
  "ObjectExpression",
  "ArrayExpression",
  "ArrowFunctionExpression",
  "FunctionExpression"
])

const isFreshValue = (node: unknown): boolean => isNode(node) && freshValueTypes.has(node.type)

const nestedInIf = (node: Node): boolean => {
  const parent: unknown = node.parent
  if (!isNode(parent)) return false
  if (isFunction(parent)) return false
  if (parent.type === "IfStatement" && field(parent, "alternate") === node) return nestedInIf(parent)
  if (parent.type === "IfStatement") return true

  return nestedInIf(parent)
}

const isEffectGenCall = (node: unknown): boolean => {
  if (!isNode(node) || node.type !== "CallExpression") return false

  const callee = memberParts(field(node, "callee"))

  return callee.object === "Effect" && callee.property === "gen"
}

const returnsOnlyEffectGen = (body: unknown): boolean => {
  if (isEffectGenCall(body)) return true
  if (!isNode(body) || body.type !== "BlockStatement") return false

  const statements = field(body, "body")
  if (!Array.isArray(statements) || statements.length !== 1) return false

  return isEffectGenCall(field(statements[0], "argument"))
}

const isThunkArgument = (node: Node): boolean => {
  const params = field(node, "params")
  if (!Array.isArray(params) || params.length > 0) return false

  return node.parent?.type === "CallExpression"
}

const isAsConst = (node: Node): boolean => nameOf(field(field(node, "typeAnnotation"), "typeName")) === "const"

const runtimes = new Set(["Effect", "BunRuntime", "NodeRuntime"])

const nondeterministic = new Set(["Date.now", "Math.random", "crypto.randomUUID"])

const styleMethods = new Set(["create", "keyframes", "defineVars", "createTheme"])

const transportBuilders = new Set(["Rpc.make", "RpcGroup.make", "Tool.make", "Toolkit.make"])

const rules: Readonly<Record<string, Rule>> = {
  "no-loops": rule((context) => {
    const report = reportAll(context, "no loops; use Array methods, Effect.forEach or recursion")

    return {
      ForStatement: report,
      ForInStatement: report,
      ForOfStatement: report,
      WhileStatement: report,
      DoWhileStatement: report
    }
  }),

  "no-let": rule((context) => ({
    VariableDeclaration: (node) => {
      const kind = field(node, "kind")
      if (kind !== "let" && kind !== "var") return

      context.report({ node, message: "const only; no let or var" })
    }
  })),

  "no-mutation": rule((context) => ({
    CallExpression: (node) => {
      const parts = memberParts(field(node, "callee"))
      const args = field(node, "arguments")
      const first = Array.isArray(args) ? args[0] : undefined

      if (parts.object === "Object" && parts.property === "assign" && !isFreshValue(first))
        return context.report({ node, message: "Object.assign onto an existing value mutates it; spread instead" })
      if (parts.property === undefined || !mutatingMethods.has(parts.property)) return
      if (isModuleName(parts.object)) return

      context.report({
        node,
        message: `${parts.property}() mutates in place; use a non-mutating alternative (toSorted, toReversed, spread)`
      })
    },
    AssignmentExpression: (node) => {
      if (field(field(node, "left"), "type") !== "MemberExpression") return

      context.report({ node, message: "no property assignment; build a new value" })
    },
    UpdateExpression: reportAll(context, "no ++ or --; build a new value")
  })),

  "no-comments": rule((context) => ({
    Program: () =>
      context.sourceCode.getAllComments().forEach(reportAll(context, "no comments; rationale goes in the commit"))
  })),

  "no-nested-if": rule((context) => ({
    IfStatement: (node) => {
      if (!nestedInIf(node)) return

      context.report({ node, message: "no nested if; use guard clauses or a named helper" })
    }
  })),

  "no-multiline-logical": rule((context) => ({
    LogicalExpression: (node) => {
      if (node.parent?.type === "LogicalExpression") return
      if (field(node, "operator") === "??") return
      if (node.loc.start.line === node.loc.end.line) return

      context.report({ node, message: "no multi-line && / || chains; use a named helper of guard clauses" })
    }
  })),

  "no-casts": rule((context) => ({
    TSAsExpression: (node) => {
      if (isAsConst(node)) return

      context.report({ node, message: "no casts; restructure until it typechecks" })
    },
    TSTypeAssertion: reportAll(context, "no casts; restructure until it typechecks")
  })),

  deterministic: rule((context) => ({
    NewExpression: (node) => {
      if (nameOf(field(node, "callee")) !== "Date") return

      context.report({ node, message: "use DateTime and Clock, never Date" })
    },
    MemberExpression: (node) => {
      const parts = memberParts(node)
      if (!nondeterministic.has(`${parts.object}.${parts.property}`)) return

      context.report({ node, message: "use the Clock and Crypto services so time and randomness stay deterministic" })
    }
  })),

  "run-at-entry-only": rule((context) => ({
    MemberExpression: (node) => {
      const parts = memberParts(node)
      if (parts.object === undefined || !runtimes.has(parts.object)) return
      if (parts.property === undefined || !parts.property.startsWith("run")) return
      if (isEntryPoint(placeOf(context.filename))) return

      context.report({ node, message: "Effect.run* and runMain belong only in src/main.ts and tools/" })
    }
  })),

  "no-gen-wrapper": rule((context) => {
    const check = (node: Node) => {
      if (isThunkArgument(node)) return
      if (!returnsOnlyEffectGen(field(node, "body"))) return

      context.report({
        node,
        message: "a function that only returns Effect.gen should be Effect.fn or Effect.fnUntraced"
      })
    }

    return { FunctionDeclaration: check, FunctionExpression: check, ArrowFunctionExpression: check }
  }),

  "markup-in-components": rule((context) => ({
    CallExpression: (node) => {
      if (ownsMarkup(placeOf(context.filename))) return
      const callee = memberParts(field(node, "callee"))
      if (callee.object === "h")
        return context.report({ node, message: "HTML belongs in src/components; pages compose components" })
      if (callee.object !== "stylex" || !styleMethods.has(callee.property ?? "")) return

      context.report({ node, message: "styles belong in src/components and src/theme" })
    }
  })),

  "transports-from-contract": rule((context) => ({
    CallExpression: (node) => {
      const callee = memberParts(field(node, "callee"))
      if (!transportBuilders.has(`${callee.object}.${callee.property}`)) return
      if (ownsTransports(placeOf(context.filename))) return

      context.report({ node, message: "RPC procedures are declared once, in packages/contract/src/Contract.ts" })
    }
  })),

  boundaries: rule((context) => {
    const check = checkSource(context)

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check
    }
  })
}

export default { meta: { name: "house" }, rules }
