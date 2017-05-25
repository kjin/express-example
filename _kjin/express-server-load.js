(async()=>{try{

const got = require('got')
// const got_ = require('got')
// const got = function(url) {
//   console.log(url);
//   return got_.apply(this, arguments);
// }
const fs = require('mz/fs')
const thenifyAll = require('thenify-all')
const googleApis = require('googleapis')
const cloudTrace = googleApis.cloudtrace('v1')

/* Client APIs */

class SequelizeExampleAPI {
  constructor(baseUrl) {
    this.baseUrl = baseUrl
    this.state = {}
  }

  async _updateState() {
    this.state = JSON.parse((await got(`${this.baseUrl}/?json=1`)).body)
  }

  _handleStatusCode(e) {
    return e.statusCode < 400 ? Promise.resolve() : (console.log(e.statusCode)||Promise.reject())
  }

  async clear() {
    await this._updateState()
    await Promise.all(this.state.map(a => a.username).filter(a => true).map(deleteUser))
  }

  async getState() {
    await this._updateState()
    return this.state
  }

  async addUser(username) {
    await this._updateState()
    await got(`${this.baseUrl}/users/create`, {
      body: { username },
      followRedirect: false
    }).catch(this._handleStatusCode)
  }

  async addTask(username, title) {
    await this._updateState()
    const ids = this.state.filter(a => a.username === username).map(a => a.id)
    await Promise.all(ids.map(id =>
      got(`${this.baseUrl}/users/${id}/tasks/create`, {
        body: { title },
        followRedirect: false
      }).catch(this._handleStatusCode)))
  }

  async deleteUser(username) {
    await this._updateState()
    const ids = this.state.filter(a => a.username === username).map(a => a.id)
    await Promise.all(ids.map(id => got(`${this.baseUrl}/users/${id}/destroy`, {
      followRedirect: false
    }).catch(this._handleStatusCode)))
  }

  async deleteTask(username, title) {
    await this._updateState()
    const ids = Array.prototype.concat.apply([],
      this.state.filter(a => a.username === username).map(a =>
        a.Tasks.filter(b => b.title === title).map(b => ({ uid: a.id, tid: b.id }))))
    await Promise.all(ids.map(id => got(`${this.baseUrl}/users/${id.uid}/tasks/${id.tid}/destroy`, {
      followRedirect: false
    }).catch(this._handleStatusCode)))
  }
}

class TraceAPI {
  constructor(projectId) {
    this.authClient = null
    this.projectId = projectId || process.env.GCLOUD_PROJECT
  }

  async _authenticate() {
    if (!this.authClient) {
      this.authClient = await new Promise((resolve, reject) => {
        googleApis.auth.getApplicationDefault((err, authClient, projectId) => {
          if (err) {
            reject(err)
          } else {
            resolve(authClient)
          }
        })
      })
    }
  }

  async listTraces(options) {
    await this._authenticate()
    let pageToken = null
    let result = []
    do {
      const [request] = await thenifyAll(cloudTrace.projects.traces).list(Object.assign({}, {
        projectId: this.projectId,
        auth: this.authClient,
        pageToken
      }, options))
      const { traces, nextPageToken } = request
      result = result.concat(traces)
      pageToken = nextPageToken
    } while (pageToken)
    return result
  }
}

/* Helper methods */

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const nowPlus = minutes => new Date(Date.now() + Math.round((minutes || 0) * 60 * 1000)).toISOString()
const randomHexString = n => new Array(n).fill('').map(a => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')

/* Main */

const [bin_, script_, numUsers, numTasksPerUser] = process.argv

// Build a client that submits requests to this target
const sequelizeClient = new SequelizeExampleAPI('localhost:3000')
// Get the time now so we know what range of time to obtain traces
const startTime = nowPlus()
// Keep track of promises so we can wait for them to all finish
const ops = []
// Add some users
for (let i = 0; i < Number(numUsers); i++) { // Yes Number(str) is probably bad
  // Generate random username
  let username = randomHexString(64)
  // Add user with this username, but without blocking the next user to add
  ops.push(sequelizeClient.addUser(username)
    .then(() => {
      // Add some tasks
      for (let j = 0; j < Number(numTasksPerUser); j++) {
        // Ranadom task title
        let task = randomHexString(64)
        // Do the same as with users but with tasks
        ops.push(sequelizeClient.addTask(username, task).then(() => {
          // Delete that task with 0% probability
          if (Math.random() < 0) {
            ops.push(sequelizeClient.deleteTask(username, task))
          }
        }))
      }
    }).then(() => {
      // Delete this user with 0% probability
      if (Math.random() < 0) {
        ops.push(sequelizeClient.deleteUser(username))
      }
    }))
}
// Wait for all operations to complete
// In probably some of the worst code ever
let opsLength = 0
do {
  console.log(`done: ${opsLength} / ${ops.length}`)
  opsLength = ops.length
  await Promise.all(ops)
} while (opsLength !== ops.length)
console.log(`done: ${opsLength} / ${ops.length}`)

// Wait ten seconds (or whatever) for traces to propagate
await wait(10000)
const endTime = nowPlus()

// Build a client that gets traces from the Trace API
const traceClient = new TraceAPI()
// List all of the traces with complete information
const traces = await traceClient.listTraces({
  startTime,
  endTime,
  view: 'COMPLETE'
})
await fs.writeFile('traces_.json', JSON.stringify(traces, null, 2))
// This function just pretty prints the number of traces that satisfy a condition
const printNum = (name, condition) => console.log(`${name}: ${traces.filter(condition).length}`)
printNum('traces', () => true)
printNum('traces with queries', t => t.spans.filter(s => s.kind === 'RPC_CLIENT').length > 0)

}catch(e){console.error(e)}})()