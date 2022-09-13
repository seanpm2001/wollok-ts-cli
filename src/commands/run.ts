import { Entity, Evaluation, Import, InnerValue, Name, Reference, RuntimeObject, validate } from 'wollok-ts'
import interpret, { Interpreter } from 'wollok-ts/dist/interpreter/interpreter'
import natives from 'wollok-ts/dist/wre/wre.natives'
import { buildEnvironmentForProject, failureDescription, problemDescription, successDescription, valueDescription } from '../utils'
import  logger  from  'loglevel'
import { Server } from 'socket.io'
import express from 'express'
import http from 'http'
import { app as client, BrowserWindow } from 'electron'
import path from 'path'


const { time, timeEnd, log } = console

type Options = {
  project: string
  skipValidations: boolean
}
let interp: Interpreter
let projectPath : string

export default async function (programFQN: Name, { project, skipValidations }: Options): Promise<void> {
  logger.info(`Running ${valueDescription(programFQN)} on ${valueDescription(project)}`)
  
  const environment = await buildEnvironmentForProject(project)
  projectPath = project
  if(!skipValidations) {
    const problems = validate(environment)
    problems.forEach(problem => logger.info(problemDescription(problem)))
    if(!problems.length) logger.info(successDescription('No problems found building the environment!'))
    else if(problems.some(_ => _.level === 'error')) return logger.error(failureDescription('Aborting run due to validation errors!'))
  }

  logger.info(`Running ${valueDescription(programFQN)}...\n`)

  try {
    const debug = logger.getLevel() <= logger.levels.DEBUG
    if(debug) time(successDescription('Run finalized successfully'))

    interp = interpret(environment, natives)
    interp.run(programFQN)

    if(debug) timeEnd(successDescription('Run finalized successfully'))
  } catch (error: any) {
    logger.error(failureDescription('Uh-oh... An error occurred during the run!', error))
  }

  const game = interp?.object('wollok.game.game')
  const title = 'Wollok Game'
  const width = interp?.send('width', game!)?.innerNumber
  const height = interp?.send('height', game!)?.innerNumber

  log()

  const server = http.createServer(express())
  const io = new Server(server)
  const url = require('url');

  await client.whenReady()
  const win = new BrowserWindow({
        width: width ? width*50 : 800,
        height: height ? height*50 : 600,
        icon: __dirname + 'wollok.ico',
        title: title,
        webPreferences: { 
            nodeIntegration: true,
            contextIsolation: false
            }
    })

    win.removeMenu()
    win.webContents.openDevTools()
    win.loadFile('./public/indexGame.html')
}

