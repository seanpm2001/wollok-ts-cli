import chalk from 'chalk'
import fs, { Dirent } from 'fs'
import { readFile } from 'fs/promises'
import { globby } from 'globby'
import logger from 'loglevel'
import path, { join } from 'path'
import { Entity, Environment, Field, Name, Node, Parameter, Problem, RuntimeObject, Sentence, Variable, WOLLOK_EXTRA_STACK_TRACE_HEADER, buildEnvironment } from 'wollok-ts'
import { List } from 'wollok-ts/dist/extensions'
import { LocalScope } from 'wollok-ts/dist/linker'
import { replNode } from './commands/repl'

const { time, timeEnd } = console


// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// FILE / PATH HANDLING
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export function relativeFilePath(project: string, filePath: string): string {
  return path.relative(project, filePath).split('.')[0]
}

export function getFQN(project: string, filePath: string): string {
  return relativeFilePath(project, filePath).replaceAll(path.sep, '.')
}

export type FileContent = {
  name: string,
  content: string,
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT CREATION
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export async function buildEnvironmentForProject(project: string, files: string[] = []): Promise<Environment> {
  const debug = logger.getLevel() <= logger.levels.DEBUG

  const paths = files.length ? files : await globby('**/*.@(wlk|wtest|wpgm)', { cwd: project })

  if(debug) time('Reading project files')
  const environmentFiles = await Promise.all(paths.map(async name =>
    ({ name, content: await readFile(join(project, name), 'utf8') })
  ))
  if (debug) timeEnd('Reading project files')

  if(debug) time('Building environment')
  try { return buildEnvironment(environmentFiles) }
  finally { if(debug) timeEnd('Building environment' ) }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PRINTING
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export const valueDescription = (val: any): string => chalk.italic(chalk.blue(val))

export const successDescription = (description: string): string =>
  chalk.green(`${chalk.bold('✓')} ${description}`)

export const failureDescription = (description: string, e?: Error): string => {
  const indexOfTsStack = e?.stack?.indexOf(WOLLOK_EXTRA_STACK_TRACE_HEADER)
  const fullStack = e?.stack?.slice(0, indexOfTsStack ?? -1) ?? ''

  const stack = fullStack
    .replaceAll('\t', '  ')
    .replaceAll('     ', '  ')
    .replaceAll('    ', '  ')
    .split('\n').join('\n  ')

  return chalk.red(`${chalk.bold('✗')} ${description}${stack ? '\n  ' + stack : ''}`)
}

export const problemDescription = (problem: Problem): string => {
  const color = problem.level === 'warning' ? chalk.yellowBright : chalk.red
  const header = chalk.bold(`[${problem.level.toUpperCase()}]`)
  return color(`${header}: ${problem.code} at ${problem.node?.sourceInfo ?? 'unknown'}`)
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// RESOURCES
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export const publicPath = (...paths: string[]): string => {
  return path.join(__dirname, '..', 'public', ...paths)
}

export const readPackageProperties = (pathProject: string): any | undefined => {
  const packagePath = path.join(pathProject, 'package.json')
  if (!fs.existsSync(packagePath)) return undefined
  return JSON.parse(fs.readFileSync(packagePath, { encoding: 'utf-8' }))
}

const imageExtensions = ['png', 'jpg']
export const isImageFile = (file: Dirent): boolean => imageExtensions.some(ext => file.name.endsWith(ext))

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// WOLLOK AST
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════


export function isConstant(obj: RuntimeObject, localName: string): boolean {
  return obj.module.lookupField(localName)?.isConstant ?? false
}

export function isREPLConstant(environment: Environment, localName: string): boolean {
  return replNode(environment).scope.resolve<Variable>(localName)?.isConstant ?? false
}

// This is a fake linking, TS should give us a better API
export function linkSentence<S extends Sentence>(newSentence: S, environment: Environment): void {
  const { scope } = replNode(environment)
  scope.register(...scopeContribution(newSentence))
  newSentence.reduce((parentScope, node) => {
    const localScope = new LocalScope(parentScope, ...scopeContribution(node))
    Object.assign(node, { scope: localScope, environment })
    return localScope
  }, scope)
}
// Duplicated from TS
const scopeContribution = (contributor: Node): List<[Name, Node]> => {
  if (canBeReferenced(contributor))
    return contributor.name ? [[contributor.name, contributor]] : []
  return []
}

const canBeReferenced = (node: Node): node is Entity | Field | Parameter => node.is(Entity) || node.is(Field) || node.is(Parameter)