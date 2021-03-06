import fs from 'fs'
import path from 'path'
import EventEmitter from 'events'
import { HyperReadings } from 'hyper-readings'
import swarm from 'hyperdiscovery'

import { readdir, stat, rimraf } from './fs-as-promised'
import networkSpeed from './hyperdb-network-speed'

const defaultHrOpts = { swarm }

function isDirectoryDB (dir) {
  return !dir.match(/\.db$/)
}

function createHyperReadings (folder, key) {
  return new Promise((resolve, reject) => {
    console.log('opening', folder)
    const hr = HyperReadings(folder, key, defaultHrOpts)
    hr.on('ready', () => resolve(hr))
    hr.on('error', reject)
  })
}

async function getHyperReadingFolders (dir) {
  const validFolders = []
  console.log('tying', dir)
  const files = await readdir(dir)
  // console.log('tying', dir)
  for (const file of files) {
    if (!isDirectoryDB(file)) continue
    const resolved = path.join(dir, file)
    const s = await stat(resolved)
    // this is crude and treats any folder as a db
    // should check if folder also contains feed etc
    if (s.isDirectory()) validFolders.push(resolved)
  }
  return validFolders
}

class Manager extends EventEmitter {
  constructor (folder) {
    super()
    const stat = fs.statSync(folder)
    if (!stat.isDirectory()) {
      this.emit('error', new Error(`Folder ${folder} does not exist`))
      return
    }
    this.dir = folder
    this.readinglists = {}
    console.log('loading')
    this._load()
      .then(() => this.emit('ready'))
      .catch((err) => this.emit('error', err))
  }

  /** load existing hyperreadings */
  async _load () {
    const folders = await getHyperReadingFolders(this.dir)
    console.log('folders', folders)
    return Promise.all(folders.map((folder) => this.openFolder(folder)))
  }

  async openFolder (folder, key) {
    const hr = await createHyperReadings(folder, key)
    console.log('key key', hr.key())
    if (!key) {
      key = hr.key()
    }
    // const key = hr.key()
    if (this.readinglists[key]) {
      console.log(key, 'is already loaded')
      return this.readinglists[key]
    }
    console.log('created reading list with key', key)
    console.log('join network')
    hr.joinNetwork()
    hr.network.on('connection', function (peer, type) {
      // console.log('got', peer, type)
      console.log('connected to', hr.network.connections.length, 'peers')
      peer.on('close', function () {
        console.log('peer disconnected')
      })
    })
    this.readinglists[key] = {
      key,
      hr,
      folder,
      speed: networkSpeed(hr.graph.db)
    }
    return this.readinglists[key]
  }

  async new (name) {
    console.log('making new', name)
    const folder = path.join(this.dir, `${name}.db`)
    const hr = await this.openFolder(folder)
    return hr
  }

  async import (key, name) {
    if (!key) throw new Error('Requires Key to import hyper-reading')
    if (this.readinglists[key]) return this.readinglists[key]
    const filename = name || key
    const folder = path.join(this.dir, `${filename}.db`)
    console.log('importing', key)
    const hr = await this.openFolder(folder, key)
    return hr
  }

  async importFile (file) {
    throw Error('Needs to be implemented')
  }

  async fork () {
    throw Error('Needs to be implemented')
  }

  async remove (key) {
    const readinglist = this.readinglists[key]
    if (!readinglist) {
      console.log(key, 'does not exist!')
      return
    }
    if (readinglist.hr.network) {
      readinglist.hr.leaveNetwork()
    }
    const folder = readinglist.folder
    // confirm that folder is .db before recursive deletion
    if (!isDirectoryDB(folder)) {
      throw Error('Folder is not a valid db')
    }
    delete readinglist[key]
    return rimraf(folder)
  }

  list () {
    // get basic information about the current hrs
    return Object.keys(this.readinglists).map(key => this.readinglists[key])
  }
}

export default Manager
