import { blue, bold, green, italic, red, yellow, yellowBright } from 'chalk'
import fs, { Dirent, existsSync, mkdirSync } from 'fs'
import { readFile } from 'fs/promises'
import globby from 'globby'
import logger from 'loglevel'
import path, { join } from 'path'
import { Entity, Environment, Field, Name, Node, Parameter, Problem, RuntimeObject, Sentence, Variable, WOLLOK_EXTRA_STACK_TRACE_HEADER, buildEnvironment, validate } from 'wollok-ts'
import { List } from 'wollok-ts/dist/extensions'
import { LocalScope } from 'wollok-ts/dist/linker'
import { replNode } from './commands/repl'

const { time, timeEnd } = console

export const ENTER = '\n'

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

export const createFolderIfNotExists = (folder: string): void => {
  if (!existsSync(folder)) {
    mkdirSync(folder)
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT CREATION
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
export async function buildEnvironmentForProject(project: string, files: string[] = []): Promise<Environment> {
  const debug = logger.getLevel() <= logger.levels.DEBUG

  const paths = files.length ? files : await globby('**/*.@(wlk|wtest|wpgm)', { cwd: project })

  if (debug) time('Reading project files')
  const environmentFiles = await Promise.all(paths.map(async name =>
    ({ name, content: await readFile(join(project, name), 'utf8') })
  ))
  if (debug) timeEnd('Reading project files')

  if (debug) time('Building environment')
  try { return buildEnvironment(environmentFiles) }
  finally { if (debug) timeEnd('Building environment') }
}

export const validateEnvironment = (environment: Environment, skipValidations: boolean = false): void => {
  if (!skipValidations) {
    try {
      const problems = validate(environment)
      problems.forEach(problem => logger.info(problemDescription(problem)))
      if(!problems.length) {
        logger.info(successDescription('No problems found building the environment!'))
      }
      else if(problems.some(_ => _.level === 'error')) {
        throw new Error('Aborting run due to validation errors!')
      }
    } catch (error: any) {
      logger.debug(error)
      throw new Error(`Fatal error while running validations. ${error.message}`)
    }
  }
}

export const handleError = (error: any): void => {
  logger.error(red(bold('💥 Uh-oh... Unexpected Error!')))
  logger.error(red(error.message))
  logger.debug(failureDescription('ℹ️ Stack trace:', error))
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PRINTING
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export const valueDescription = (val: any): string => italic(blue(val))

export const successDescription = (description: string): string =>
  green(`${bold('✓')} ${description}`)

export const failureDescription = (description: string, e?: Error): string => {
  const indexOfTsStack = e?.stack?.indexOf(WOLLOK_EXTRA_STACK_TRACE_HEADER)
  const fullStack = e?.stack?.slice(0, indexOfTsStack ?? -1) ?? ''

  const stack = fullStack
    .replaceAll('\t', '  ')
    .replaceAll('     ', '  ')
    .replaceAll('    ', '  ')
    .split('\n').join('\n  ')

  return red(`${bold('✗')} ${description}${stack ? '\n  ' + stack : ''}`)
}

export const problemDescription = (problem: Problem): string => {
  const color = problem.level === 'warning' ? yellowBright : red
  const header = bold(`[${problem.level.toUpperCase()}]`)
  return color(`${header}: ${problem.code} at ${problem.node?.sourceInfo ?? 'unknown'}`)
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// RESOURCES
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export const publicPath = (...paths: string[]): string =>
  path.join(__dirname, '..', 'public', ...paths)

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

// TODO: migrate to wollok-ts (could it be in RuntimeObject? Or at least in a helper function)
export function isConstant(obj: RuntimeObject, localName: string): boolean {
  return obj.module.lookupField(localName)?.isConstant ?? false
}

// TODO: migrate to wollok-ts
export function isREPLConstant(environment: Environment, localName: string): boolean {
  return replNode(environment).scope.resolve<Variable>(localName)?.isConstant ?? false
}

// TODO: migrate to wollok-ts
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

// TODO: migrate to wollok-ts
// Duplicated from TS
const scopeContribution = (contributor: Node): List<[Name, Node]> => {
  if (canBeReferenced(contributor))
    return contributor.name ? [[contributor.name, contributor]] : []
  return []
}
const canBeReferenced = (node: Node): node is Entity | Field | Parameter => node.is(Entity) || node.is(Field) || node.is(Parameter)

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// HTTP SERVER
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export const serverError = ({ port, code }: { port: string, code: string }): void => {
  logger.info('')
  if (code === 'EADDRINUSE') {
    logger.info(yellow(bold(`⚡ We couldn't start dynamic diagram at port ${port}, because it is already in use. ⚡`)))
    // eslint-disable-next-line @typescript-eslint/quotes
    logger.info(yellow(`Please make sure you don't have another REPL session running in another terminal. \nIf you want to start another instance, you can use "--port xxxx" option, where xxxx should be any available port.`))
  } else {
    logger.info(yellow(bold(`⚡ REPL couldn't be started at port ${port}, error code ["${code}]. ⚡`)))
  }
  process.exit(13)
}